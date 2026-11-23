/**
 * Nothing jumps (DEC-060): what a click acts on in the open case (a mark's
 * Verify, Resolve's or Reopen's Save, Delete mark, an image's Remove, a
 * filter chip) stays where it was on screen while the panel draws the
 * result. The list is drawn anew for a change, its pictures load after it,
 * a chip row may wrap: all of that moved the acted row by a screen's part,
 * and the browser's own scroll anchoring cannot hold a row that is replaced.
 * So the panel holds it: for a moment after the click, every frame, the
 * page is scrolled by however far the acted element (or, when it went, the
 * mark that takes its place) moved from where it was clicked. Any scroll
 * not its own (the person's wheel, touch, keys or scrollbar, a script's, a
 * focus that brings a field into view) and a press elsewhere end it; while
 * it holds, the browser's own scroll anchoring is off.
 */

/** How long after a click the acted element is held: the save, the redraw, the pictures. */
export const HOLD_MS = 2500;

/**
 * The elements to hold, best first: the acted mark's row, then the marks
 * after it, then the ones before (one of them takes its place when it goes:
 * deleted, or left out by a filter).
 */
export function markAnchorKeys(
	order: readonly string[],
	acted: string,
): string[] {
	const at = order.indexOf(acted);
	if (at < 0) return [acted];
	return [acted, ...order.slice(at + 1), ...order.slice(0, at).reverse()];
}

/**
 * How far to scroll so the first of `keys` still there is back at `top`,
 * the acted element's place when it was clicked; none when none is there.
 * Half a pixel or less is no move.
 */
export function anchorShift(
	keys: readonly string[],
	top: number,
	topOf: (key: string) => number | undefined,
): number | undefined {
	for (const key of keys) {
		const now = topOf(key);
		if (now === undefined) continue;
		const delta = now - top;
		return Math.abs(delta) <= 0.5 ? 0 : delta;
	}
	return undefined;
}

const quoted = (s: string) => s.replace(/["\\]/g, "\\$&");

/**
 * Hold what a click in `root` acts on (see above). Marks are `li.mark` with
 * `data-mark`; chips carry `data-group` or `data-page-filter`. Returns what
 * lets it go, for a scroll of the panel's own (a pin picked on the page).
 */
export function holdClickedInPlace(root: HTMLElement): () => void {
	const doc = root.ownerDocument;
	const win = doc.defaultView;
	if (win === null) return () => {};
	let held: { keys: string[]; top: number; until: number } | undefined;
	let frame = 0;
	/**
	 * Where the page is scrolled to as far as the hold knows: any other
	 * scroll (the person's, a script's, a focus that scrolls a field into
	 * view) ends the hold, or the two pull against each other.
	 */
	let expected = 0;
	const html = doc.documentElement;
	/** While held, the browser's own anchoring is off: only the hold moves the page. */
	const hold = (on: boolean) => {
		html.style.overflowAnchor = on ? "none" : "";
	};
	/**
	 * Room lent below the list while held: a row that closes (Verify) or goes
	 * near the list's end would make the page shorter, and the browser would
	 * scroll it back by itself. Taken back at the person's next own scroll
	 * or press, not when the hold ends: then it would move what it kept.
	 */
	let lent = false;
	/**
	 * Lent above a tool bar sticky at the bottom (`data-room-before`), so
	 * the bar stays at the window's bottom with the room above it; below
	 * the root where there is none.
	 */
	let lentTo: HTMLElement | undefined;
	const lend = (on: boolean) => {
		if (on === lent) return;
		lent = on;
		if (on) {
			const bar = root.querySelector<HTMLElement>("[data-room-before]");
			lentTo = bar ?? root;
			if (bar) bar.style.marginTop = `${html.clientHeight}px`;
			else root.style.marginBottom = `${html.clientHeight}px`;
		} else if (lentTo !== undefined) {
			lentTo.style.marginTop = "";
			lentTo.style.marginBottom = "";
			lentTo = undefined;
		}
	};
	const elementOf = (key: string) =>
		key.startsWith("chip:")
			? root.querySelector<HTMLElement>(key.slice(5))
			: root.querySelector<HTMLElement>(`li.mark[data-mark="${quoted(key)}"]`);
	const step = () => {
		frame = 0;
		if (held === undefined) return;
		// Over, or scrolled by someone else since the last frame: let go.
		if (Date.now() > held.until || Math.abs(win.scrollY - expected) > 1) {
			release();
			return;
		}
		const delta = anchorShift(held.keys, held.top, (key) => {
			const e = elementOf(key);
			return e && e.getClientRects().length > 0
				? e.getBoundingClientRect().top
				: undefined;
		});
		if (delta) {
			win.scrollBy(0, delta);
			expected = win.scrollY;
		}
		frame = win.requestAnimationFrame(step);
	};
	root.addEventListener(
		"click",
		(e) => {
			const target = e.target as HTMLElement | null;
			const button = target?.closest("button");
			if (!button || !root.contains(button)) return;
			const chip = button.closest<HTMLElement>(
				"[data-group].chip, [data-page-filter]",
			);
			const row = button.closest<HTMLElement>("li.mark[data-mark]");
			let keys: string[];
			let element: HTMLElement;
			if (chip) {
				const group = chip.dataset["group"];
				const sel =
					group !== undefined
						? `#case-status .chip[data-group="${quoted(group)}"]`
						: `[data-page-filter="${quoted(chip.dataset["pageFilter"] ?? "")}"]`;
				keys = [`chip:${sel}`];
				element = chip;
			} else if (row) {
				const order = [...root.querySelectorAll<HTMLElement>("li.mark")].map(
					(li) => li.dataset["mark"] ?? "",
				);
				keys = markAnchorKeys(order, row.dataset["mark"] ?? "");
				element = row;
			} else return;
			lend(true);
			expected = win.scrollY;
			hold(true);
			held = {
				keys,
				top: element.getBoundingClientRect().top,
				until: Date.now() + HOLD_MS,
			};
			if (frame === 0) frame = win.requestAnimationFrame(step);
		},
		true,
	);
	// The person scrolls, or acts elsewhere: no longer held.
	function release(): void {
		held = undefined;
		hold(false);
	}
	win.addEventListener(
		"scroll",
		() => {
			if (held !== undefined && Math.abs(win.scrollY - expected) > 1) release();
		},
		{ passive: true },
	);
	/** The person's own scroll or press: no longer held, and the room goes back. */
	const theirs = () => {
		release();
		lend(false);
	};
	// A press comes before its click: it ends the hold of the click before.
	for (const type of ["wheel", "touchstart", "pointerdown"] as const)
		doc.addEventListener(type, theirs, { passive: true, capture: true });
	doc.addEventListener("keydown", (e) => {
		if (
			[
				"PageUp",
				"PageDown",
				"Home",
				"End",
				"ArrowUp",
				"ArrowDown",
				// The focus moves on, and the page scrolls to it.
				"Tab",
			].includes(e.key) ||
			(e.key === " " && !(e.target as HTMLElement | null)?.closest("button"))
		)
			theirs();
	});
	return release;
}
