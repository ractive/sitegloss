/**
 * Where a loaded mark may be drawn (DEC-075): only where its element can be
 * seen. The element is clipped by the scrolling ancestors around it and by
 * the window, and may be covered by something fixed or sticky over it. A
 * mark of an element that nothing of shows is not drawn; one that shows in
 * part is cut where the element is cut, and its pin stays whole on the part
 * that shows. Pure: the page's boxes come in, the clip and the pin go out.
 */

import type { Point, Rect } from "./case.ts";

/**
 * How far a mark may reach past the edge of what shows on a side where its
 * element is not cut: the stroke's casing, a focused element's outline and
 * the pin's half (radius 10 to 12) stay whole as before.
 */
export const CLIP_MARGIN = 14;

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

/**
 * The view an element is seen through, less a cover over it (a sticky head
 * in its scroller, a fixed banner): a cover across the whole visible part of
 * the element at one of its ends takes that end off the view; one that
 * covers all of it leaves nothing (`null`); one in the middle, or over a
 * corner only, changes nothing (the mark is drawn over it, as before).
 */
export function uncovered(view: Rect, element: Rect, cover: Rect): Rect | null {
	const seen = intersect(element, view);
	if (seen === null) return null;
	if (intersect(seen, cover) === null) return view;
	const acrossX = cover.x <= seen.x && right(cover) >= right(seen);
	const acrossY = cover.y <= seen.y && bottom(cover) >= bottom(seen);
	if (acrossX && acrossY) return null;
	let { x, y } = view;
	let r = right(view);
	let b = bottom(view);
	if (acrossX && cover.y <= seen.y) y = Math.max(y, bottom(cover));
	else if (acrossX && bottom(cover) >= bottom(seen)) b = Math.min(b, cover.y);
	else if (acrossY && cover.x <= seen.x) x = Math.max(x, right(cover));
	else if (acrossY && right(cover) >= right(seen)) r = Math.min(r, cover.x);
	else return view;
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
 *   `uncovered`).
 * - The drawing is cut exactly at the view's edge on each side where the
 *   element is cut; on a side where it is whole, it may reach `CLIP_MARGIN`
 *   past, so a mark whose element shows whole looks as it did.
 * - The pin is the box's (`pin`, of radius `radius`): when the place it
 *   belongs to is cut away on an axis, it goes to the nearest place on that
 *   axis of what shows of the mark (`bounds`, else the element); and it
 *   always stays whole inside the view where the view has room for it, so no
 *   pin pokes over the head of a page whose panes scroll.
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
	const m = CLIP_MARGIN;
	const x = element.x < view.x ? view.x : view.x - m;
	const y = element.y < view.y ? view.y : view.y - m;
	const r = right(element) > right(view) ? right(view) : right(view) + m;
	const b = bottom(element) > bottom(view) ? bottom(view) : bottom(view) + m;
	const clip = { x, y, width: r - x, height: b - y };
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
		clip,
		pin: {
			x: axis(pin.x, view.x, right(view), shown.x, right(shown)),
			y: axis(pin.y, view.y, bottom(view), shown.y, bottom(shown)),
		},
	};
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(Math.max(v, lo), hi);
