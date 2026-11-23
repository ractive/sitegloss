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
 * scroll), and every `COVER_MS` at most; never more than `TESTS_A_PASS`
 * marks a pass, the rest in the passes after. Meanwhile (a scroll) the
 * covers found lately on the page are taken at their boxes of the moment.
 */

import type { Point, Rect } from "../lib/case.ts";
import {
	clippingAncestors,
	cutByCovers,
	type Holder,
	intersect,
	intersectAll,
	type Probe,
	probePoints,
} from "../lib/clip.ts";
import { parentOf } from "../lib/shadow.ts";

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
/** At most this many marks are hit-tested a pass (each at up to 8 points). */
export const TESTS_A_PASS = 6;
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
 * Something fixed or sticky over an element: the fixed or sticky box
 * (`root`), and the outermost part of it the hit test saw (`part`: a
 * `pointer-events: none` layer is not seen, its button is). Its box is the
 * two's common part.
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
	/** The covers found lately on the page, by their root: assumed during a scroll. */
	#known = new Map<Element, { cover: Cover; at: number }>();
	/** Read once a pass. */
	#holders = new Map<Element, Holder>();
	#positions = new Map<Element, string>();
	#boxes = new Map<Element, Rect | null>();
	#coverBoxes = new Map<Cover, Rect | null>();
	/** The open modal dialogs, or the fullscreen element, this pass. */
	#tops: Element[] = [];
	/** Hit tests left this pass. */
	#budget = TESTS_A_PASS;
	/** For a measurement: marks hit-tested, and points asked. */
	readonly counts = { marks: 0, points: 0 };

	constructor(
		doc: Document,
		host: Element,
		options: { now?: () => number } = {},
	) {
		this.#doc = doc;
		this.#host = host;
		this.#now = options.now ?? (() => performance.now());
		this.#dialogs = doc.getElementsByTagName("dialog");
	}

	/** A new pass (a frame): the page's boxes are read again. */
	begin(): void {
		this.#holders.clear();
		this.#positions.clear();
		this.#boxes.clear();
		this.#coverBoxes.clear();
		this.#budget = TESTS_A_PASS;
		const full = this.#doc.fullscreenElement;
		this.#tops = full ? [full] : this.#modals();
		const now = this.#now();
		for (const [root, k] of this.#known)
			if (now - k.at > KNOWN_MS || !root.isConnected) this.#known.delete(root);
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
		const due =
			last === undefined ||
			last.changes !== changes ||
			now - last.tested >= COVER_MS ||
			(still && last.tested < last.moved && now - last.moved >= SETTLE_MS);
		if (!due && still) return last.view;
		const probes = probePoints(rect, view, reach);
		let covers: Partial<Record<Probe, Cover | null>>;
		let tested = last?.tested ?? Number.NEGATIVE_INFINITY;
		if (
			due &&
			this.#budget > 0 &&
			typeof this.#doc.elementsFromPoint === "function"
		) {
			this.#budget--;
			this.counts.marks++;
			covers = {};
			for (const [name, p] of Object.entries(probes) as [Probe, Point][]) {
				this.counts.points++;
				const cover = this.#coverAt(el, p);
				covers[name] = cover;
				if (cover !== null) this.#known.set(cover.root, { cover, at: now });
			}
			tested = now;
		} else covers = this.#assumed(el, probes, last?.covers ?? {});
		const boxes: Partial<Record<Probe, Rect | null>> = {};
		for (const [name, c] of Object.entries(covers) as [Probe, Cover | null][]) {
			const box = c === null ? null : this.#coverBox(c);
			// A cover's box must still hold its point.
			const p = probes[name];
			boxes[name] =
				box !== null && p !== undefined && holds(box, p) ? box : null;
		}
		const out = cutByCovers(view, rect, boxes);
		this.#tested.set(el, { key, changes, tested, moved, covers, view: out });
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
	 * page's topmost element there is neither `el`, nor inside it, nor around
	 * it, and it is or sits in something fixed or sticky outside `el`'s
	 * ancestors. An element the hit test does not see (`pointer-events:
	 * none`) counts as showing: the mark stays rather than going wrongly.
	 */
	#coverAt(el: Element, p: Point): Cover | null {
		const hits = this.#doc
			.elementsFromPoint(p.x, p.y)
			.filter((h) => h !== this.#host);
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
		return { root, part };
	}
}

/** An ancestor that cuts an element, and on which axes. */
interface Clipper {
	el: Element;
	x: boolean;
	y: boolean;
}

const holds = (r: Rect, p: Point) =>
	p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
