/**
 * What of the window a page element can be seen through (DEC-075): the
 * window (its visual viewport), the boxes of the ancestors that clip it
 * (scrolling panes), less what is fixed or sticky over it (a head in its
 * pane, a cookie banner) and anything outside an open modal dialog. Read
 * from the page in one pass per frame; the geometry is `src/lib/clip.ts`.
 */

import type { Rect } from "../lib/case.ts";
import { intersect, intersectAll, uncovered } from "../lib/clip.ts";
import { parentOf } from "../lib/shadow.ts";

/** How an ancestor bears on what it holds (its computed style). */
interface Holder {
	position: string;
	/** It is the containing block of fixed (and absolute) descendants. */
	holdsFixed: boolean;
	/** It cuts what it holds on that axis (overflow, `contain: paint`). */
	cutX: boolean;
	cutY: boolean;
}

/** An ancestor that cuts an element, and on which axes. */
interface Clipper {
	el: Element;
	x: boolean;
	y: boolean;
}

/**
 * How long an element's clipping ancestors are taken as read while the DOM
 * does not change: a style that makes a pane scroll without a DOM change (a
 * class) is seen within this.
 */
export const CHAIN_MS = 2000;

/** Far enough to be no edge on an axis that is not cut. */
const FAR = 1e7;

/** The view of an element no pane cuts, wholly outside the window: drawn uncut. */
export const UNCUT: Rect = Object.freeze({
	x: -FAR,
	y: -FAR,
	width: 2 * FAR,
	height: 2 * FAR,
});

/** Overflow that cuts: anything but `visible` (`clip`, `hidden`, `auto`, `scroll`). */
const cuts = (overflow: string) => overflow !== "" && overflow !== "visible";

/** `contain` values that cut to the padding box, and make a containing block. */
const PAINTS = /\b(paint|strict|content)\b/;
const LAYOUT = /\b(layout|paint|strict|content)\b/;

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

export class Visibility {
	readonly #doc: Document;
	readonly #host: Element;
	/** Each element's clipping ancestors, read again on a DOM change or after `CHAIN_MS`. */
	#chains = new WeakMap<
		Element,
		{ changes: number; at: number; clippers: Clipper[] }
	>();
	/** Read once a pass: the ancestors shared by several marks. */
	#holders = new Map<Element, Holder>();
	#positions = new Map<Element, string>();
	#boxes = new Map<Element, Rect | null>();
	/** The page's modal dialog or fullscreen element this pass. */
	#top: Element | null = null;
	/** The hit tests, kept while the element, its view and the page stay as they were. */
	#covered = new WeakMap<
		Element,
		{ key: string; changes: number; view: Rect | null }
	>();

	readonly #dialogs: HTMLCollectionOf<Element>;

	constructor(doc: Document, host: Element) {
		this.#doc = doc;
		this.#host = host;
		this.#dialogs = doc.getElementsByTagName("dialog");
	}

	/** A new pass (a frame): the page's boxes are read again. */
	begin(): void {
		this.#holders.clear();
		this.#positions.clear();
		this.#boxes.clear();
		this.#top = this.#doc.fullscreenElement ?? this.#modal();
	}

	/**
	 * The box of the window `el` (whose box is `rect`) is seen through, or
	 * `null` when nothing of it shows. `changes` counts the page's DOM
	 * changes: its clipping ancestors and its covers are looked for again
	 * when the DOM, or the element's place, changed.
	 *
	 * The window alone hides nothing: an element wholly outside it, but not
	 * cut away by its panes, is seen through its panes' box (its mark stays
	 * where it is, out of sight, as before). Only a pane or a cover can leave
	 * a mark in sight where its element is not.
	 */
	viewOf(el: Element, rect: Rect, changes: number): Rect | null {
		// A modal dialog or a fullscreen element covers everything outside it.
		if (this.#top !== null && !within(el, this.#top)) return null;
		const panes: Rect[] = [];
		for (const c of this.#clippersOf(el, changes)) {
			const box = this.#box(c);
			if (box !== null) panes.push(box);
		}
		const inPanes = panes.length === 0 ? UNCUT : intersectAll(panes);
		if (inPanes === null || intersect(rect, inPanes) === null) return null;
		const view = intersect(inPanes, this.#viewport());
		if (view === null || intersect(rect, view) === null) return inPanes;
		return this.#uncovered(el, rect, view, changes);
	}

	/**
	 * The open modal dialog, if any: among the page's dialogs (a live list,
	 * not a search of the whole page each frame).
	 */
	#modal(): Element | null {
		for (const d of this.#dialogs)
			try {
				if ((d as HTMLDialogElement).open && d.matches(":modal")) return d;
			} catch {
				return null; // The selector is not known here.
			}
		return null;
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
			p = this.#style(el)?.position ?? "static";
			this.#positions.set(el, p);
		}
		return p;
	}

	#holder(el: Element): Holder {
		const known = this.#holders.get(el);
		if (known !== undefined) return known;
		const s = this.#style(el);
		const contain = s?.contain ?? "";
		const set = (v: string | undefined) =>
			v !== undefined && v !== "" && v !== "none";
		const paints = PAINTS.test(contain);
		const holder = {
			position: s?.position ?? "static",
			holdsFixed:
				set(s?.transform) ||
				set(s?.perspective) ||
				set(s?.filter) ||
				LAYOUT.test(contain) ||
				/\b(transform|perspective|filter)\b/.test(s?.willChange ?? ""),
			cutX: paints || cuts(s?.overflowX ?? ""),
			cutY: paints || cuts(s?.overflowY ?? ""),
		};
		this.#holders.set(el, holder);
		this.#positions.set(el, holder.position);
		return holder;
	}

	/**
	 * The ancestors that clip `el`: those in its chain of containing blocks
	 * (a fixed element escapes them all but a transformed one; an absolute
	 * one, those up to its positioned ancestor). The root's and, when it
	 * hands it on, the body's overflow are the window's.
	 */
	#clippersOf(el: Element, changes: number): Clipper[] {
		const now = performance.now();
		const known = this.#chains.get(el);
		if (
			known !== undefined &&
			known.changes === changes &&
			now - known.at < CHAIN_MS
		)
			return known.clippers;
		const doc = this.#doc;
		const root = doc.documentElement;
		const body = doc.body;
		const rootHolder = root === null ? undefined : this.#holder(root);
		const bodyIsWindow =
			rootHolder === undefined || (!rootHolder.cutX && !rootHolder.cutY);
		const clippers: Clipper[] = [];
		let mode = this.#position(el);
		for (let at = layoutParent(el); at !== null; at = layoutParent(at)) {
			if (at === root) break;
			const h = this.#holder(at);
			const holds =
				mode === "fixed"
					? h.holdsFixed
					: mode === "absolute"
						? h.position !== "static" || h.holdsFixed
						: true;
			if (!holds) continue;
			if ((h.cutX || h.cutY) && !(at === body && bodyIsWindow))
				clippers.push({ el: at, x: h.cutX, y: h.cutY });
			mode = h.position;
		}
		this.#chains.set(el, { changes, at: now, clippers });
		return clippers;
	}

	/** The box a clipping ancestor cuts to: its padding box, without the scrollbars. */
	#box(c: Clipper): Rect | null {
		if (this.#boxes.has(c.el)) return this.#boxes.get(c.el) ?? null;
		const r = c.el.getBoundingClientRect();
		const html = c.el as HTMLElement;
		// An inline box has no client box (overflow does not apply to it).
		const measurable =
			html.clientWidth > 0 ||
			html.clientHeight > 0 ||
			r.width === 0 ||
			r.height === 0;
		let box: Rect | null = null;
		if (measurable) {
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
		this.#boxes.set(c.el, box);
		return box;
	}

	/**
	 * `view` less the fixed or sticky things over `el`: the page is asked
	 * what is topmost at five points of what shows of it (its middle and
	 * corners, 2 px in). Asked again only when the element, its view or the
	 * page's DOM changed.
	 */
	#uncovered(
		el: Element,
		rect: Rect,
		view: Rect,
		changes: number,
	): Rect | null {
		const seen = intersectAll([rect, view]);
		if (seen === null) return null;
		const key = [
			rect.x,
			rect.y,
			rect.width,
			rect.height,
			view.x,
			view.y,
			view.width,
			view.height,
		]
			.map((n) => Math.round(n))
			.join(",");
		const known = this.#covered.get(el);
		if (known !== undefined && known.key === key && known.changes === changes) {
			return known.view;
		}
		let out: Rect | null = view;
		for (const cover of this.#covers(el, seen)) {
			out = uncovered(out, rect, cover);
			if (out === null) break;
		}
		this.#covered.set(el, { key, changes, view: out });
		return out;
	}

	#covers(el: Element, seen: Rect): Rect[] {
		const doc = this.#doc;
		if (typeof doc.elementsFromPoint !== "function") return [];
		const inset = Math.min(2, seen.width / 2, seen.height / 2);
		const l = seen.x + inset;
		const t = seen.y + inset;
		const r = seen.x + seen.width - inset;
		const b = seen.y + seen.height - inset;
		const points = [
			[seen.x + seen.width / 2, seen.y + seen.height / 2],
			[l, t],
			[r, t],
			[l, b],
			[r, b],
		] as const;
		const found = new Set<Element>();
		const out: Rect[] = [];
		for (const [x, y] of points) {
			const cover = this.#coverAt(el, x, y);
			if (cover === null || found.has(cover)) continue;
			found.add(cover);
			out.push(cover.getBoundingClientRect());
		}
		return out;
	}

	/**
	 * The fixed or sticky thing topmost at a point over `el`, if one is: the
	 * page's topmost element there is neither `el`, nor inside it, nor around
	 * it, and it is or sits in something fixed or sticky outside `el`'s
	 * ancestors. An element the hit test does not see (`pointer-events:
	 * none`) counts as showing: the mark stays rather than going wrongly.
	 */
	#coverAt(el: Element, x: number, y: number): Element | null {
		for (const hit of this.#doc.elementsFromPoint(x, y)) {
			if (hit === this.#host) continue;
			if (within(hit, el) || within(el, hit)) return null;
			for (let at: Element | null = hit; at !== null; at = parentOf(at)) {
				if (within(el, at)) return null;
				const p = this.#position(at);
				if (p === "fixed" || p === "sticky") {
					const r = at.getBoundingClientRect();
					const inside =
						x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
					return inside ? at : null;
				}
			}
			return null;
		}
		return null;
	}
}
