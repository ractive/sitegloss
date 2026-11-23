import { describe, expect, test } from "bun:test";
import {
	CLIP_MARGIN,
	clipMark,
	intersect,
	intersectAll,
	uncovered,
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

	test("a sticky head across the element's top takes the top off the view", () => {
		const head = box(0, 60, 1000, 50);
		expect(uncovered(PANE, box(40, 80, 600, 300), head)).toEqual(
			box(0, 110, 1000, 690),
		);
	});

	test("a banner across its bottom takes the bottom off", () => {
		const banner = box(0, 700, 1000, 100);
		expect(uncovered(PANE, box(40, 500, 600, 300), banner)).toEqual(
			box(0, 60, 1000, 640),
		);
	});

	test("a cover over all of what shows leaves nothing", () => {
		expect(
			uncovered(PANE, box(40, 80, 200, 20), box(0, 60, 1000, 50)),
		).toBeNull();
	});

	test("a cover in its middle or over one corner changes nothing", () => {
		expect(uncovered(PANE, box(40, 80, 600, 300), box(100, 200, 50, 50))).toBe(
			PANE,
		);
		expect(uncovered(PANE, box(40, 80, 600, 300), box(0, 60, 100, 40))).toBe(
			PANE,
		);
	});

	test("a cover that does not reach the element changes nothing", () => {
		expect(uncovered(PANE, box(40, 400, 600, 100), box(0, 60, 1000, 50))).toBe(
			PANE,
		);
	});
});

describe("a mark on an element, drawn where the element shows", () => {
	test("an element that shows whole is drawn as before, a margin past the view", () => {
		const element = box(40, 200, 600, 300);
		const out = clipMark({
			element,
			bounds: element,
			pin: { x: 40, y: 200 },
			radius: R,
			view: VIEW,
		});
		expect(out?.pin).toEqual({ x: 40, y: 200 });
		expect(out?.clip).toEqual(
			box(
				-CLIP_MARGIN,
				60 - CLIP_MARGIN,
				1000 + 2 * CLIP_MARGIN,
				740 + 2 * CLIP_MARGIN,
			),
		);
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
		// Exact at the top, where the element is cut; a margin elsewhere.
		expect(out?.clip.y).toBe(60);
		expect(out?.clip.x).toBe(-CLIP_MARGIN);
		// The pin at the visible part's top left, whole: nothing of it above 60.
		expect(out?.pin).toEqual({ x: 40, y: 60 + R + 1 });
		expect((out?.pin.y ?? 0) - R).toBeGreaterThan(60);
	});

	test("an element wholly under the head, or scrolled out of its pane, is not drawn", () => {
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
		const element = box(40, 62, 600, 300);
		const out = clipMark({
			element,
			bounds: element,
			pin: { x: 40, y: 62 },
			radius: R,
			view: VIEW,
		});
		expect(out?.pin).toEqual({ x: 40, y: 60 + R + 1 });
	});

	test("a pin whose place is cut away on one axis goes along the part that shows", () => {
		// An arrow from far left (its pin at its start) to an element in a
		// pane that is cut on the left.
		const view = box(300, 60, 700, 740);
		const out = clipMark({
			element: box(200, 300, 400, 100),
			bounds: box(100, 250, 400, 120),
			pin: { x: 100, y: 250 },
			radius: R,
			view,
		});
		expect(out?.pin).toEqual({ x: 300 + R + 1, y: 250 });
		expect(out?.clip.x).toBe(300);
	});

	test("a view too small for a pin leaves it on what shows, cut with the rest", () => {
		const view = box(0, 60, 1000, 12);
		const out = clipMark({
			element: box(40, 30, 600, 40),
			bounds: box(40, 30, 600, 40),
			pin: { x: 40, y: 30 },
			radius: R,
			view,
		});
		expect(out?.pin).toEqual({ x: 40, y: 60 });
	});

	test("a highlight's pin left of its text stays where it is", () => {
		const element = box(40, 200, 600, 100);
		const out = clipMark({
			element,
			bounds: box(80, 210, 200, 20),
			pin: { x: 69, y: 220 },
			radius: R,
			view: VIEW,
		});
		expect(out?.pin).toEqual({ x: 69, y: 220 });
	});
});
