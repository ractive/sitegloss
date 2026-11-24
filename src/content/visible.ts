/**
 * What of the window a page element can be seen through (DEC-075): the
 * window (its visual viewport), the boxes of the ancestors that clip it
 * (scrolling panes), less what is fixed or sticky over it (a head in its
 * pane, a cookie banner) and anything outside an open modal dialog. Read
 * from the page in one pass per frame; the geometry is `src/lib/clip.ts`.
 *
 * The covers are found by hit tests, which cost: a mark is tested when it
 * first shows, when the page's DOM changed, when it has stood still for
 * `SETTLE_MS` after moving (a head that slides away or in after the
 * scroll), and, while something covers it, every `COVER_MS`. A pass spends
 * `TEST_MS` on them at most (one mark at least); the rest wait for the next
 * frames (`pending`). Meanwhile (a scroll) the covers found lately on the
 * page are taken at their boxes of the moment.
 */

import type { Point, Rect } from "../lib/case.ts";
import {
	type CoverAt,
	clippingAncestors,
	cutByCovers,
	type Holder,
	intersect,
	intersectAll,
	type Probe,
	probePoints,
} from "../lib/clip.ts";
import { parseColor } from "../lib/colour.ts";
import { parentOf, shadowOf } from "../lib/shadow.ts";
import { pageElementsAt } from "./anchor.ts";

/** Far enough to be no edge on an axis that is not cut. */
const FAR = 1e7;

/**
 * How long an element's clipping ancestors are taken as read while the DOM
 * does not change: a style that makes a pane scroll without a DOM change (a
 * class) is seen within this.
 */
export const CHAIN_MS = 2000;
/** How long a mark's covers are taken as found while nothing moves. */
export const COVER_MS = 2000;
/** A mark that stood still this long after moving is tested again. */
export const SETTLE_MS = 350;
/** How long a pass may spend on hit tests (each mark at up to 8 points). */
export const TEST_MS = 2;
/** A cover not found again for this long is no longer assumed. */
const KNOWN_MS = 5000;

/** Overflow that cuts: anything but `visible` (`clip`, `hidden`, `auto`, `scroll`). */
const cuts = (overflow: string) => overflow !== "" && overflow !== "visible";

/** `contain` values that cut to the padding box, and make a containing block. */
const PAINTS = /\b(paint|strict|content)\b/;
const LAYOUT = /\b(layout|paint|strict|content)\b/;
/** Displays without a box `overflow` applies to. */
const NO_BOX = new Set([
	"contents",
	"none",
	"table-row",
	"table-row-group",
	"table-header-group",
	"table-footer-group",
]);

/** In the flat tree (a slotted element is laid out in its slot). */
const layoutParent = (el: Element): Element | null =>
	(el as Element & { assignedSlot?: Element | null }).assignedSlot ??
	parentOf(el);

/** Whether `inner` is `outer` or inside it, across shadow roots. */
function within(inner: Element, outer: Element): boolean {
	for (let at: Element | null = inner; at !== null; at = parentOf(at))
		if (at === outer) return true;
	return false;
}

/**
 * Something fixed or sticky over an element, that paints: the fixed or
 * sticky box (`root`), and the outermost part of it the hit test saw
 * (`part`: a `pointer-events: none` layer is not seen, its button is). The
 * part is which element covers (one bar at both points of an end, or two
 * things); its box is the two's common part.
 */
interface Cover {
	root: Element;
	part: Element;
}

interface Tested {
	/** The element's place and view when last looked at. */
	key: string;
	changes: number;
	/** When it was last hit-tested; `-Infinity` when never. */
	tested: number;
	/** When its place last changed. */
	moved: number;
	/** It was due for a hit test that no pass had time for yet. */
	owed: boolean;
	/** The covers found at its probes then. */
	covers: Partial<Record<Probe, Cover | null>>;
	view: Rect | null;
}

export class Visibility {
	readonly #doc: Document;
	readonly #host: Element;
	readonly #now: () => number;
	readonly #dialogs: HTMLCollectionOf<Element>;
	/** Each element's clipping ancestors, read again on a DOM change or after `CHAIN_MS`. */
	#chains = new WeakMap<
		Element,
		{ changes: number; at: number; clippers: Clipper[] }
	>();
	#tested = new WeakMap<Element, Tested>();
	/** The covers found lately on the page, by their part: assumed during a scroll. */
	#known = new Map<Element, { cover: Cover; at: number }>();
	/** Read once a pass. */
	#holders = new Map<Element, Holder>();
	#positions = new Map<Element, string>();
	#boxes = new Map<Element, Rect | null>();
	#coverBoxes = new Map<Cover, Rect | null>();
	/** The open modal dialogs, or the fullscreen element, this pass. */
	#tops: Element[] = [];
	/** Until when this pass may hit-test, from its first hit test on. */
	#until: number | undefined;
	readonly #testMs: number;
	/** Marks were due for a hit test that this pass had no time for. */
	pending = false;

	constructor(
		doc: Document,
		host: Element,
		options: { now?: () => number; testMs?: number } = {},
	) {
		this.#doc = doc;
		this.#host = host;
		this.#now = options.now ?? (() => performance.now());
		this.#testMs = options.testMs ?? TEST_MS;
		this.#dialogs = doc.getElementsByTagName("dialog");
	}

	/** A new pass (a frame): the page's boxes are read again. */
	begin(): void {
		this.#holders.clear();
		this.#positions.clear();
		this.#boxes.clear();
		this.#coverBoxes.clear();
		this.#until = undefined;
		this.pending = false;
		const full = this.#doc.fullscreenElement;
		this.#tops = full ? [full] : this.#modals();
		const now = this.#now();
		for (const [part, k] of this.#known)
			if (now - k.at > KNOWN_MS || !part.isConnected) this.#known.delete(part);
	}

	/**
	 * The marks' elements in the order a pass should take them: those owed a
	 * hit test first, then the longest untested, so the time of a pass goes
	 * round and no mark waits for ever.
	 */
	byTurn<T extends { el: Element }>(marks: readonly T[]): T[] {
		const rank = (m: T) => {
			const t = this.#tested.get(m.el);
			return t === undefined
				? [0, Number.NEGATIVE_INFINITY]
				: [t.owed ? 0 : 1, t.tested];
		};
		return marks
			.map((m) => ({ m, r: rank(m) }))
			.sort(
				(a, b) =>
					(a.r[0] as number) - (b.r[0] as number) ||
					(a.r[1] as number) - (b.r[1] as number),
			)
			.map((x) => x.m);
	}

	/**
	 * The box of the window `el` (whose box is `rect`) is seen through, or
	 * `null` when nothing of it shows. `reach` is what its mark covers (the
	 * drawing, its pin, the element). `changes` counts the page's DOM
	 * changes: its clipping ancestors and its covers are looked for again
	 * when the DOM changed.
	 */
	viewOf(el: Element, rect: Rect, reach: Rect, changes: number): Rect | null {
		// An open modal dialog or a fullscreen element covers everything outside it.
		if (this.#tops.length > 0 && !this.#tops.some((t) => within(el, t)))
			return null;
		const clips: Rect[] = [this.#viewport()];
		for (const c of this.#clippersOf(el, changes)) {
			const box = this.#box(c);
			if (box !== null) clips.push(box);
		}
		const view = intersectAll(clips);
		if (view === null || intersect(rect, view) === null) return null;
		return this.#uncovered(el, rect, reach, view, changes);
	}

	/** The open modal dialogs: any of them, not only the one in front, shows what is inside it. */
	#modals(): Element[] {
		const out: Element[] = [];
		for (const d of this.#dialogs)
			try {
				if ((d as HTMLDialogElement).open && d.matches(":modal")) out.push(d);
			} catch {
				return []; // The selector is not known here.
			}
		return out;
	}

	/** The visual viewport, in the window's coordinates (those of `getBoundingClientRect`). */
	#viewport(): Rect {
		const win = this.#doc.defaultView;
		const vv = win?.visualViewport;
		if (vv != null && vv.width > 0 && vv.height > 0)
			return {
				x: vv.offsetLeft,
				y: vv.offsetTop,
				width: vv.width,
				height: vv.height,
			};
		return {
			x: 0,
			y: 0,
			width: win?.innerWidth ?? FAR,
			height: win?.innerHeight ?? FAR,
		};
	}

	#style(el: Element): CSSStyleDeclaration | undefined {
		return this.#doc.defaultView?.getComputedStyle(el);
	}

	#position(el: Element): string {
		let p = this.#positions.get(el);
		if (p === undefined) {
			p = this.#style(el)?.position || "static";
			this.#positions.set(el, p);
		}
		return p;
	}

	#holder(el: Element, bodyIsWindow: boolean): Holder {
		const known = this.#holders.get(el);
		if (known !== undefined) return known;
		const s = this.#style(el);
		const contain = s?.contain ?? "";
		const set = (v: string | undefined) =>
			v !== undefined && v !== "" && v !== "none";
		const paints = PAINTS.test(contain);
		const holder: Holder = {
			position: s?.position || "static",
			holdsFixed:
				set(s?.transform) ||
				set(s?.perspective) ||
				set(s?.filter) ||
				LAYOUT.test(contain) ||
				/\b(transform|perspective|filter)\b/.test(s?.willChange ?? ""),
			cutX: paints || cuts(s?.overflowX ?? ""),
			cutY: paints || cuts(s?.overflowY ?? ""),
			noBox: NO_BOX.has(s?.display ?? ""),
			isWindow: el === this.#doc.body && bodyIsWindow,
		};
		this.#holders.set(el, holder);
		this.#positions.set(el, holder.position);
		return holder;
	}

	/**
	 * The ancestors that clip `el` (`clippingAncestors`). The root's and,
	 * when it hands it on, the body's overflow are the window's.
	 */
	#clippersOf(el: Element, changes: number): Clipper[] {
		const now = this.#now();
		const known = this.#chains.get(el);
		if (
			known !== undefined &&
			known.changes === changes &&
			now - known.at < CHAIN_MS
		)
			return known.clippers;
		const root = this.#doc.documentElement;
		const rootStyle = root === null ? undefined : this.#style(root);
		const bodyIsWindow =
			rootStyle === undefined ||
			(!cuts(rootStyle.overflowX) && !cuts(rootStyle.overflowY));
		const chain: Element[] = [];
		for (
			let at = layoutParent(el);
			at !== null && at !== root;
			at = layoutParent(at)
		)
			chain.push(at);
		const holders = chain.map((a) => this.#holder(a, bodyIsWindow));
		const clippers = clippingAncestors(this.#position(el), holders).map(
			(i) => ({
				el: chain[i] as Element,
				x: (holders[i] as Holder).cutX,
				y: (holders[i] as Holder).cutY,
			}),
		);
		this.#chains.set(el, { changes, at: now, clippers });
		return clippers;
	}

	/** The box a clipping ancestor cuts to: its padding box, without the scrollbars. */
	#box(c: Clipper): Rect | null {
		if (this.#boxes.has(c.el)) return this.#boxes.get(c.el) ?? null;
		const r = c.el.getBoundingClientRect();
		const html = c.el as HTMLElement;
		let box: Rect | null = null;
		const sized = html.clientWidth > 0 || html.clientHeight > 0;
		// A box of no size cuts all away, if it is a box at all.
		if (r.width === 0 || r.height === 0) {
			if (c.el.getClientRects().length > 0)
				box = { x: r.x, y: r.y, width: 0, height: 0 };
		} else if (sized) {
			// A scaled pane: client sizes are in its own pixels.
			const sx = html.offsetWidth > 0 ? r.width / html.offsetWidth : 1;
			const sy = html.offsetHeight > 0 ? r.height / html.offsetHeight : 1;
			box = {
				x: c.x ? r.x + html.clientLeft * sx : -FAR,
				y: c.y ? r.y + html.clientTop * sy : -FAR,
				width: c.x ? html.clientWidth * sx : 2 * FAR,
				height: c.y ? html.clientHeight * sy : 2 * FAR,
			};
		}
		// Otherwise an inline box, which overflow does not apply to.
		this.#boxes.set(c.el, box);
		return box;
	}

	/**
	 * `view` less the fixed or sticky things over `el` (`cutByCovers`): hit
	 * tests at its probes (`probePoints`) when due and in the budget;
	 * otherwise the covers it had, and the ones found lately on the page, at
	 * their boxes of the moment.
	 */
	#uncovered(
		el: Element,
		rect: Rect,
		reach: Rect,
		view: Rect,
		changes: number,
	): Rect | null {
		const now = this.#now();
		const key = [rect, view, reach]
			.flatMap((r) => [r.x, r.y, r.width, r.height])
			.map((n) => Math.round(n))
			.join(",");
		const last = this.#tested.get(el);
		const still = last !== undefined && last.key === key;
		const moved = still ? last.moved : now;
		// A page that cannot be hit-tested has no covers.
		const due =
			typeof this.#doc.elementsFromPoint === "function" &&
			(last === undefined ||
				last.owed ||
				last.changes !== changes ||
				// Only a mark something covers is asked again by age: a cover gone
				// would leave it wrongly hidden; one come without a move or a DOM
				// change leaves a mark drawn over it, the lesser wrong.
				(now - last.tested >= COVER_MS &&
					Object.values(last.covers).some((c) => c != null)) ||
				(still && last.tested < last.moved && now - last.moved >= SETTLE_MS));
		if (!due && still) return last.view;
		const probes = probePoints(rect, view, reach);
		// The clock of a pass starts at its first hit test (a layout the page
		// forced before is not its time).
		const time = this.#until === undefined || performance.now() < this.#until;
		let covers: Partial<Record<Probe, Cover | null>>;
		let record: Pick<Tested, "changes" | "tested" | "owed">;
		if (due && time) {
			this.#until ??= performance.now() + this.#testMs;
			covers = {};
			for (const [name, p] of Object.entries(probes) as [Probe, Point][]) {
				const cover = this.#coverAt(el, p);
				covers[name] = cover;
				if (cover !== null) this.#known.set(cover.part, { cover, at: now });
			}
			record = { changes, tested: now, owed: false };
		} else {
			covers = this.#assumed(el, probes, last?.covers ?? {});
			// Due and no time: it stays owed, nothing it was due for is forgotten.
			if (due) this.pending = true;
			record = due
				? {
						changes: last?.changes ?? -1,
						tested: last?.tested ?? Number.NEGATIVE_INFINITY,
						owed: true,
					}
				: {
						changes,
						tested: last?.tested ?? Number.NEGATIVE_INFINITY,
						owed: false,
					};
		}
		const at: Partial<Record<Probe, CoverAt | null>> = {};
		for (const [name, c] of Object.entries(covers) as [Probe, Cover | null][]) {
			const box = c === null ? null : this.#coverBox(c);
			// A cover's box must still hold its point.
			const p = probes[name];
			at[name] =
				c !== null && box !== null && p !== undefined && holds(box, p)
					? { id: c.part, box }
					: null;
		}
		const out = cutByCovers(view, rect, at);
		this.#tested.set(el, { key, moved, covers, view: out, ...record });
		return out;
	}

	/**
	 * Without a hit test (a scroll, or no budget left): at each probe, the
	 * cover it had there, or one found lately on the page, whose box holds
	 * the point now.
	 */
	#assumed(
		el: Element,
		probes: Partial<Record<Probe, Point>>,
		had: Partial<Record<Probe, Cover | null>>,
	): Partial<Record<Probe, Cover | null>> {
		const candidates = new Set<Cover>();
		for (const c of Object.values(had)) if (c != null) candidates.add(c);
		for (const { cover } of this.#known.values()) candidates.add(cover);
		const out: Partial<Record<Probe, Cover | null>> = {};
		for (const [name, p] of Object.entries(probes) as [Probe, Point][]) {
			out[name] = null;
			for (const c of candidates) {
				if (within(el, c.root) || within(c.root, el)) continue;
				const box = this.#coverBox(c);
				if (box !== null && holds(box, p)) {
					out[name] = c;
					break;
				}
			}
		}
		return out;
	}

	#coverBox(c: Cover): Rect | null {
		if (this.#coverBoxes.has(c)) return this.#coverBoxes.get(c) ?? null;
		const box =
			c.root.isConnected && c.part.isConnected
				? intersect(
						c.part.getBoundingClientRect(),
						c.root.getBoundingClientRect(),
					)
				: null;
		this.#coverBoxes.set(c, box);
		return box;
	}

	/**
	 * The fixed or sticky thing topmost at a point, if it is over `el`: the
	 * page's topmost element there (inside shadow roots too) is neither `el`,
	 * nor inside it, nor around it; it is or sits in something fixed or
	 * sticky outside `el`'s ancestors; and it paints (`paints`): a layer that
	 * paints nothing (the click-catcher behind an open menu) covers nothing.
	 * An element the hit test does not see (`pointer-events: none`) counts as
	 * showing: the mark stays rather than going wrongly.
	 */
	#coverAt(el: Element, p: Point): Cover | null {
		const doc = this.#doc;
		// The topmost alone first: mostly it is the element, and the list of
		// all costs more. A shadow host may hold a bar over it: then the list.
		const top =
			typeof doc.elementFromPoint === "function"
				? doc.elementFromPoint(p.x, p.y)
				: null;
		if (
			top !== null &&
			top !== this.#host &&
			shadowOf(top) === null &&
			(within(top, el) || within(el, top))
		)
			return null;
		const hits = pageElementsAt(p.x, p.y, this.#host, doc);
		const hit = hits[0];
		if (hit === undefined) return null;
		if (within(hit, el) || within(el, hit)) return null;
		let root: Element | null = null;
		for (let at: Element | null = hit; at !== null; at = parentOf(at)) {
			if (within(el, at)) return null;
			const position = this.#position(at);
			if (position === "fixed" || position === "sticky") {
				root = at;
				break;
			}
		}
		if (root === null) return null;
		// The outermost part of it that was hit: what takes the pointer there.
		let part = hit;
		for (const h of hits) if (within(part, h) && within(h, root)) part = h;
		// Something of it on the way from the hit up to that part paints.
		for (let at: Element | null = hit; at !== null; at = parentOf(at)) {
			if (this.#paints(at)) return { root, part };
			if (at === part) break;
		}
		return null;
	}

	/**
	 * Whether an element paints a ground: a background colour that is not
	 * transparent, a background image, a backdrop filter, or a dialog or
	 * popover in the top layer.
	 */
	#paints(el: Element): boolean {
		const s = this.#style(el);
		if (s === undefined) return false;
		if (el.localName === "dialog") return true;
		try {
			if (el.matches(":popover-open")) return true;
		} catch {
			// The selector is not known here.
		}
		const set = (v: string | undefined) =>
			v !== undefined && v !== "" && v !== "none";
		return (
			opaque(s.backgroundColor) ||
			set(s.backgroundImage) ||
			set((s as { backdropFilter?: string }).backdropFilter)
		);
	}
}

/** A computed colour with some alpha; a form this cannot read counts as painting. */
function opaque(colour: string | undefined): boolean {
	if (colour === undefined || colour === "") return false;
	const c = parseColor(colour);
	if (c !== undefined) return c.a > 0;
	if (colour.trim().toLowerCase() === "transparent") return false;
	const alpha = /\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(colour);
	return alpha === null || Number(alpha[1]) > 0;
}

/** An ancestor that cuts an element, and on which axes. */
interface Clipper {
	el: Element;
	x: boolean;
	y: boolean;
}

const holds = (r: Rect, p: Point) =>
	p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
