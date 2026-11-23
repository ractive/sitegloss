import { describe, expect, test } from "bun:test";
import {
	clipMark,
	clippingAncestors,
	cutByCovers,
	type Holder,
	intersect,
	intersectAll,
	probePoints,
} from "../src/lib/clip.ts";

/** A window 1000 × 800 with a fixed head of 60 px, and a pane under it. */
const WINDOW = { x: 0, y: 0, width: 1000, height: 800 };
const PANE = { x: 0, y: 60, width: 1000, height: 740 };
const VIEW = intersectAll([WINDOW, PANE]);
const R = 10;

const box = (x: number, y: number, width: number, height: number) => ({
	x,
	y,
	width,
	height,
});

describe("the view an element is seen through", () => {
	test("is what its clips share, nothing when they share nothing", () => {
		expect(VIEW).toEqual(PANE);
		expect(intersect(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBeNull();
		expect(intersectAll([WINDOW, box(2000, 0, 10, 10)])).toBeNull();
		expect(intersectAll([])).toBeNull();
	});
});

describe("which ancestors cut an element", () => {
	const holder = (h: Partial<Holder> = {}): Holder => ({
		position: "static",
		holdsFixed: false,
		cutX: false,
		cutY: false,
		noBox: false,
		isWindow: false,
		...h,
	});
	const scroller = (h: Partial<Holder> = {}) =>
		holder({ cutX: true, cutY: true, ...h });

	test("an element in flow: every scroller around it", () => {
		expect(
			clippingAncestors("static", [holder(), scroller(), holder(), scroller()]),
		).toEqual([1, 3]);
	});

	test("an absolute element escapes a scroller that is not its containing block", () => {
		// Its parent scrolls but is static; the positioned one above it holds it.
		expect(
			clippingAncestors("absolute", [
				scroller(),
				holder(),
				scroller({ position: "relative" }),
			]),
		).toEqual([2]);
	});

	test("a fixed element escapes all but a transformed ancestor, and what holds that", () => {
		expect(clippingAncestors("fixed", [scroller(), scroller()])).toEqual([]);
		expect(
			clippingAncestors("fixed", [
				scroller(),
				scroller({ holdsFixed: true }),
				scroller(),
			]),
		).toEqual([1, 2]);
	});

	test("the body whose overflow is the window's, and a box-less wrapper, cut nothing", () => {
		expect(
			clippingAncestors("static", [
				scroller({ noBox: true }),
				scroller({ isWindow: true }),
			]),
		).toEqual([]);
		// A box-less wrapper holds nothing either: the absolute element looks past it.
		expect(
			clippingAncestors("absolute", [
				scroller({ noBox: true, position: "relative" }),
				scroller({ position: "relative" }),
			]),
		).toEqual([1]);
	});

	test("one axis is enough to count", () => {
		expect(clippingAncestors("static", [holder({ cutX: true })])).toEqual([0]);
	});
});

describe("where the page is asked what covers an element", () => {
	test("inside its corners, and just past the top and bottom its mark reaches", () => {
		const element = box(100, 200, 300, 100);
		const reach = box(89, 189, 311, 111);
		const p = probePoints(element, WINDOW, reach);
		expect(p.tl).toEqual({ x: 102, y: 202 });
		expect(p.br).toEqual({ x: 398, y: 298 });
		expect(p.aboveL).toEqual({ x: 91, y: 188 });
		expect(p.aboveR).toEqual({ x: 398, y: 188 });
		expect(p.belowL).toEqual({ x: 91, y: 301 });
	});

	test("not past the view, which cuts there already", () => {
		const p = probePoints(box(100, 50, 300, 100), PANE, box(89, 39, 311, 111));
		expect(p.tl?.y).toBe(62);
		expect(p.aboveL).toBeUndefined();
		expect(
			probePoints(box(100, -300, 300, 100), PANE, box(100, -300, 300, 100)),
		).toEqual({});
	});
});

describe("the view less the covers", () => {
	const element = box(40, 80, 600, 300);
	/** A cover: one element (`id`) with its box. */
	const cover = (id: string, r: ReturnType<typeof box>) => ({ id, box: r });
	const head = cover("head", box(0, 60, 1000, 50));

	test("one head bar at both top corners takes the top off, at its bottom", () => {
		expect(cutByCovers(PANE, element, { tl: head, tr: head })).toEqual(
			box(0, 110, 1000, 690),
		);
	});

	test("a head just above the element, at both reach points: the view stops at its bottom", () => {
		const fixedHead = cover("head", box(0, 0, 1000, 75));
		const view = cutByCovers(WINDOW, element, {
			aboveL: fixedHead,
			aboveR: fixedHead,
		});
		expect(view?.y).toBe(75);
		expect(intersect(element, view ?? WINDOW)).toEqual(element);
	});

	test("a head bar at the top and a foot bar at the bottom both cut", () => {
		const foot = cover("foot", box(0, 300, 1000, 500));
		expect(
			cutByCovers(PANE, element, { tl: head, tr: head, bl: foot, br: foot }),
		).toEqual(box(0, 110, 1000, 190));
	});

	test("two different things at the two corners of an end cut nothing: the mark stays whole", () => {
		// A chat launcher and a consent button, or the two halves of a head.
		const launcher = cover("launcher", box(600, 330, 60, 60));
		const consent = cover("consent", box(20, 330, 60, 60));
		expect(cutByCovers(PANE, element, { bl: consent, br: launcher })).toEqual(
			PANE,
		);
		const left = cover("left half", box(0, 60, 500, 50));
		const right = cover("right half", box(500, 60, 500, 50));
		expect(cutByCovers(PANE, element, { tl: left, tr: right })).toEqual(PANE);
	});

	test("two full-height rails at the sides, at every corner and past the ends: nothing is cut", () => {
		const nav = cover("nav", box(0, 0, 60, 800));
		const rail = cover("rail", box(620, 0, 60, 800));
		expect(
			cutByCovers(PANE, element, {
				tl: nav,
				bl: nav,
				tr: rail,
				br: rail,
				aboveL: nav,
				aboveR: rail,
			}),
		).toEqual(PANE);
	});

	test("one thing over all five points hides the mark; over the four corners only, it is drawn", () => {
		const overlay = cover("overlay", box(0, 0, 1000, 800));
		const all = { tl: overlay, tr: overlay, bl: overlay, br: overlay };
		expect(cutByCovers(PANE, element, { ...all, mid: overlay })).toBeNull();
		expect(cutByCovers(PANE, element, all)).toEqual(PANE);
	});

	test("one corner covered (a button, a badge) changes nothing", () => {
		const button = cover("button", box(20, 60, 56, 56));
		expect(cutByCovers(PANE, element, { tl: button, tr: null })).toEqual(PANE);
		expect(cutByCovers(PANE, element, {})).toEqual(PANE);
	});
});

describe("a mark on an element, drawn where the element shows", () => {
	test("cut exactly at the view; a whole element's pin stays where it is", () => {
		const element = box(40, 200, 600, 300);
		const out = clipMark({
			element,
			bounds: element,
			pin: { x: 40, y: 200 },
			radius: R,
			view: VIEW,
		});
		expect(out?.pin).toEqual({ x: 40, y: 200 });
		expect(out?.clip).toEqual(PANE);
	});

	test("an element under the head is cut at the pane's top, and its pin stays whole under it", () => {
		const element = box(40, 20, 600, 300);
		const out = clipMark({
			element,
			bounds: element,
			pin: { x: 40, y: 20 },
			radius: R,
			view: VIEW,
		});
		expect(out?.clip.y).toBe(60);
		expect(out?.pin).toEqual({ x: 40, y: 60 + R + 1 });
	});

	test("an element wholly under the head, out of its pane, or with no view, is not drawn", () => {
		for (const element of [box(40, -400, 600, 300), box(40, 800, 600, 50)])
			expect(
				clipMark({
					element,
					bounds: element,
					pin: { x: element.x, y: element.y },
					radius: R,
					view: VIEW,
				}),
			).toBeNull();
		expect(
			clipMark({
				element: box(0, 0, 10, 10),
				bounds: box(0, 0, 10, 10),
				pin: { x: 0, y: 0 },
				radius: R,
				view: null,
			}),
		).toBeNull();
	});

	test("an element whose top shows at the pane's top keeps its pin inside the pane", () => {
		const out = clipMark({
			element: box(40, 62, 600, 300),
			bounds: box(40, 62, 600, 300),
			pin: { x: 40, y: 62 },
			radius: R,
			view: VIEW,
		});
		expect(out?.pin).toEqual({ x: 40, y: 60 + R + 1 });
	});

	test("a pin cut away on both axes goes to the corner of what shows", () => {
		const view = box(300, 200, 500, 400);
		const out = clipMark({
			element: box(100, 100, 400, 300),
			bounds: box(100, 100, 400, 300),
			pin: { x: 100, y: 100 },
			radius: R,
			view,
		});
		expect(out?.pin).toEqual({ x: 300 + R + 1, y: 200 + R + 1 });
	});

	test("a pin cut away on one axis goes along the part that shows", () => {
		const view = box(300, 60, 700, 740);
		const out = clipMark({
			element: box(200, 300, 400, 100),
			bounds: box(100, 250, 400, 120),
			pin: { x: 100, y: 250 },
			radius: R,
			view,
		});
		expect(out?.pin).toEqual({ x: 300 + R + 1, y: 250 });
	});

	test("a view too small for a pin leaves it on what shows, cut with the rest", () => {
		const out = clipMark({
			element: box(40, 30, 600, 40),
			bounds: box(40, 30, 600, 40),
			pin: { x: 40, y: 30 },
			radius: R,
			view: box(0, 60, 1000, 12),
		});
		expect(out?.pin).toEqual({ x: 40, y: 60 });
	});

	test("a highlight's pin left of its text stays where it is", () => {
		const out = clipMark({
			element: box(40, 200, 600, 100),
			bounds: box(80, 210, 200, 20),
			pin: { x: 69, y: 220 },
			radius: R,
			view: VIEW,
		});
		expect(out?.pin).toEqual({ x: 69, y: 220 });
	});
});
