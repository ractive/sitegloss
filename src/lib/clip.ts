/**
 * Where a loaded mark may be drawn (DEC-075): only where its element can be
 * seen. The element is clipped by the scrolling ancestors around it and by
 * the window, and may be covered by something fixed or sticky over it. A
 * mark of an element that nothing of shows is not drawn; one that shows in
 * part is cut where the element is cut, and its pin stays whole on the part
 * that shows. When it is not sure, the mark is drawn: a mark that vanishes
 * while its element is plainly visible is worse than one drawn over a cover.
 * Pure: the page's boxes come in, the clip and the pin go out.
 */

import type { Point, Rect } from "./case.ts";

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

/** The part two boxes share; `null` when they share nothing (touching is nothing). */
export function intersect(a: Rect, b: Rect): Rect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const w = Math.min(right(a), right(b)) - x;
	const h = Math.min(bottom(a), bottom(b)) - y;
	return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

/** The part all the boxes share (the clips around an element); `null` when none. */
export function intersectAll(rects: readonly Rect[]): Rect | null {
	let at: Rect | null = rects[0] ?? null;
	for (const r of rects.slice(1)) {
		if (at === null) return null;
		at = intersect(at, r);
	}
	return at;
}

/** The box around both. */
export function union(a: Rect, b: Rect): Rect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(right(a), right(b)) - x,
		height: Math.max(bottom(a), bottom(b)) - y,
	};
}

/** How an ancestor bears on what it holds, read from its computed style. */
export interface Holder {
	position: string;
	/** It is the containing block of fixed (and absolute) descendants (a transform, `contain`). */
	holdsFixed: boolean;
	/** It cuts what it holds on that axis (`overflow` not `visible`, `contain: paint`). */
	cutX: boolean;
	cutY: boolean;
	/**
	 * It has no box of its own to cut with (`display: contents`, a table row
	 * or row group, where `overflow` does not apply): skipped.
	 */
	noBox: boolean;
	/** It is the body, whose overflow is handed on to the window. */
	isWindow: boolean;
}

/**
 * Which of an element's ancestors (`chain`, nearest first) cut it: those in
 * its chain of containing blocks. A fixed element escapes them all but one
 * that holds fixed descendants (a transform); an absolute one, those up to
 * its positioned ancestor. `position` is the element's own.
 */
export function clippingAncestors(
	position: string,
	chain: readonly Holder[],
): number[] {
	const out: number[] = [];
	let mode = position;
	chain.forEach((h, i) => {
		if (h.noBox) return;
		const holds =
			mode === "fixed"
				? h.holdsFixed
				: mode === "absolute"
					? h.position !== "static" || h.holdsFixed
					: true;
		if (!holds) return;
		if ((h.cutX || h.cutY) && !h.isWindow) out.push(i);
		mode = h.position;
	});
	return out;
}

/**
 * Where the page is asked what lies over an element: inside what shows of
 * it, at its corners (2 px in), and just past the top and the bottom of
 * what its mark reaches (`reach`: the drawing, its pin, the element), where
 * a fixed head that does not overlap the element would have the pin's half
 * or a padded box over it. A point past the view is not asked: the view
 * cuts there already.
 */
export type Probe =
	| "tl"
	| "tr"
	| "bl"
	| "br"
	| "aboveL"
	| "aboveR"
	| "belowL"
	| "belowR";

export function probePoints(
	element: Rect,
	view: Rect,
	reach: Rect,
): Partial<Record<Probe, Point>> {
	const seen = intersect(element, view);
	if (seen === null) return {};
	const inset = Math.min(2, seen.width / 2, seen.height / 2);
	const l = seen.x + inset;
	const r = right(seen) - inset;
	const t = seen.y + inset;
	const b = bottom(seen) - inset;
	const out: Partial<Record<Probe, Point>> = {
		tl: { x: l, y: t },
		tr: { x: r, y: t },
		bl: { x: l, y: b },
		br: { x: r, y: b },
	};
	const wide = intersect(
		{ x: reach.x, y: view.y, width: reach.width, height: view.height },
		view,
	);
	if (wide === null) return out;
	const wl = wide.x + 2;
	const wr = right(wide) - 2;
	const above = reach.y - 1;
	const below = bottom(reach) + 1;
	if (above < seen.y && above > view.y) {
		out.aboveL = { x: wl, y: above };
		out.aboveR = { x: wr, y: above };
	}
	if (below > bottom(seen) && below < bottom(view)) {
		out.belowL = { x: wl, y: below };
		out.belowR = { x: wr, y: below };
	}
	return out;
}

/**
 * The view less the covers found at the probes (`probePoints`; a cover's
 * box, or nothing). An end of the view is cut only where both of its points
 * are covered: the top at the nearer of the two covers' bottoms (one cover
 * across, or the cells of a sticky table head: covers in one row), the
 * bottom likewise, a side where one cover holds both its inside corners. One point covered (a button at a corner, a
 * badge in the middle) changes nothing: the mark is drawn. `null` when
 * nothing of the element is left in the view.
 */
export function cutByCovers(
	view: Rect,
	element: Rect,
	covers: Partial<Record<Probe, Rect | null>>,
): Rect | null {
	/**
	 * Both points of an end covered, by covers in one row (an end) or by one
	 * cover (a side): the edge picked of the two.
	 */
	const pair = (
		a: Probe,
		b: Probe,
		edge: (r: Rect) => number,
		pick: (p: number, q: number) => number,
		together: (p: Rect, q: Rect) => boolean,
	): number | undefined => {
		const p = covers[a];
		const q = covers[b];
		return p == null || q == null || !together(p, q)
			? undefined
			: pick(edge(p), edge(q));
	};
	const row = (p: Rect, q: Rect) => p.y < bottom(q) && q.y < bottom(p);
	const same = (p: Rect, q: Rect) =>
		p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;
	const most = (
		vs: (number | undefined)[],
		pick: (...n: number[]) => number,
	) => {
		const known = vs.filter((v): v is number => v !== undefined);
		return known.length === 0 ? undefined : pick(...known);
	};
	const top = most(
		[
			pair("tl", "tr", bottom, Math.min, row),
			pair("aboveL", "aboveR", bottom, Math.min, row),
		],
		Math.max,
	);
	const end = most(
		[
			pair("bl", "br", (r) => r.y, Math.max, row),
			pair("belowL", "belowR", (r) => r.y, Math.max, row),
		],
		Math.min,
	);
	const left = pair("tl", "bl", right, Math.min, same);
	const rightCut = pair("tr", "br", (r) => r.x, Math.max, same);
	const x = Math.max(view.x, left ?? view.x);
	const y = Math.max(view.y, top ?? view.y);
	const r = Math.min(right(view), rightCut ?? right(view));
	const b = Math.min(bottom(view), end ?? bottom(view));
	if (r <= x || b <= y) return null;
	const out = { x, y, width: r - x, height: b - y };
	return intersect(element, out) === null ? null : out;
}

/** A loaded mark, drawn where its element shows. */
export interface ClippedMark {
	/** The window's box the mark's drawing (shape, strokes, pin) is cut to. */
	clip: Rect;
	/** Where its pin goes. */
	pin: Point;
}

/**
 * Where a mark on an element is drawn, or `null` when nothing of its
 * element shows (it is then not drawn at all, nor its pin).
 *
 * - `view`: what of the window the element can be seen through (the window
 *   and its scrolling ancestors' boxes, `intersectAll`, less its covers,
 *   `cutByCovers`). The drawing is cut exactly at it: past a pane's or a
 *   cover's edge lies the head the mark must not reach over, and past the
 *   window's nothing is seen.
 * - The pin is the box's (`pin`, of radius `radius`): when the place it
 *   belongs to is cut away on an axis, it goes to the nearest place on that
 *   axis of what shows of the mark (`bounds`, else the element); and it
 *   always stays whole inside the view where the view has room for it.
 */
export function clipMark(input: {
	element: Rect;
	/** The mark's drawing's bounds in the window. */
	bounds: Rect;
	pin: Point;
	radius: number;
	view: Rect | null;
}): ClippedMark | null {
	const { element, bounds, pin, radius, view } = input;
	if (view === null) return null;
	const seen = intersect(element, view);
	if (seen === null) return null;
	// What shows of the drawing; a flat or empty one (a note) is the element's.
	const shown =
		intersect(
			{
				x: bounds.x,
				y: bounds.y,
				width: Math.max(1, bounds.width),
				height: Math.max(1, bounds.height),
			},
			view,
		) ?? seen;
	const axis = (
		at: number,
		lo: number,
		hi: number,
		showsLo: number,
		showsHi: number,
	): number => {
		let p = at < lo || at > hi ? clamp(at, showsLo, showsHi) : at;
		// Whole inside the view, where it has room for the pin.
		if (hi - lo >= 2 * radius + 2)
			p = clamp(p, lo + radius + 1, hi - radius - 1);
		return p;
	};
	return {
		clip: view,
		pin: {
			x: axis(pin.x, view.x, right(view), shown.x, right(shown)),
			y: axis(pin.y, view.y, bottom(view), shown.y, bottom(shown)),
		},
	};
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(Math.max(v, lo), hi);
