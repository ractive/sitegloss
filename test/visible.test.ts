/**
 * What of the window an element is seen through, read from a page
 * (DEC-075): happy-dom lays nothing out and has no hit test, so each
 * element's box and the page's answer at a point are given here.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { COVER_MS, SETTLE_MS, Visibility } from "../src/content/visible.ts";
import type { Rect } from "../src/lib/case.ts";

let doc: Document;
let clock = 0;
/** What the page says is at a point, topmost first. */
let hitsAt: (x: number, y: number) => Element[];
let visibility: Visibility;

const box = (x: number, y: number, width: number, height: number): Rect => ({
	x,
	y,
	width,
	height,
});

/** Give an element a box (and, for a scroller, its client box: no borders, no scrollbars). */
function place(el: Element, r: Rect): void {
	Object.defineProperty(el, "getBoundingClientRect", {
		configurable: true,
		value: () => ({
			...r,
			top: r.y,
			left: r.x,
			right: r.x + r.width,
			bottom: r.y + r.height,
		}),
	});
	for (const [name, value] of [
		["clientWidth", r.width],
		["clientHeight", r.height],
		["offsetWidth", r.width],
		["offsetHeight", r.height],
		["clientLeft", 0],
		["clientTop", 0],
	] as const)
		Object.defineProperty(el, name, { configurable: true, get: () => value });
}

const $ = (id: string) => doc.getElementById(id) as Element;
const within = (p: { x: number; y: number }, r: Rect) =>
	p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

beforeEach(() => {
	const window = new Window({ url: "https://www.example.com/" });
	doc = window.document as unknown as Document;
	clock = 1000;
	hitsAt = () => [];
	Object.defineProperty(doc, "elementsFromPoint", {
		configurable: true,
		value: (x: number, y: number) => hitsAt(x, y),
	});
	visibility = new Visibility(doc, doc.createElement("div"), {
		now: () => clock,
	});
});

/** The view of `el` at its box `r`, in a pass of its own. */
function viewOf(el: Element, r: Rect, changes = 0): Rect | null {
	visibility.begin();
	return visibility.viewOf(el, r, r, changes);
}

describe("the ancestors that clip an element", () => {
	test("a scroller around it cuts it; an absolute element escapes one that is not its containing block", () => {
		doc.body.innerHTML = `
			<div id="pane" style="overflow-x: hidden; overflow-y: auto">
				<div id="inflow">a</div>
				<div id="menu" style="position: absolute">b</div>
			</div>`;
		place($("pane"), box(0, 100, 500, 300));
		// Both below the pane's box.
		const below = box(10, 450, 100, 30);
		expect(viewOf($("inflow"), below)).toBeNull();
		expect(viewOf($("menu"), below)).toEqual(box(0, 0, 1024, 768));
	});

	test("the body's overflow is the window's while the root's is visible", () => {
		doc.documentElement.setAttribute("style", "");
		doc.body.setAttribute("style", "overflow-x: hidden; overflow-y: hidden");
		doc.body.innerHTML = `<div id="el">a</div>`;
		place(doc.body, box(0, 0, 100, 100));
		const r = box(300, 300, 50, 20);
		expect(viewOf($("el"), r)).toEqual(box(0, 0, 1024, 768));
		// The root clips too: the body is a scroller of its own.
		doc.documentElement.setAttribute(
			"style",
			"overflow-x: hidden; overflow-y: hidden",
		);
		expect(viewOf($("el"), r, 1)).toBeNull();
	});

	test("a wrapper with display: contents has no box to cut with", () => {
		doc.body.innerHTML = `<div id="w" style="display: contents; overflow-x: hidden; overflow-y: hidden"><div id="el">a</div></div>`;
		expect(viewOf($("el"), box(300, 300, 50, 20))).toEqual(
			box(0, 0, 1024, 768),
		);
	});

	test("only inside one of the open modal dialogs is anything seen", () => {
		doc.body.innerHTML = `<div id="page">a</div><dialog id="d1" open><p id="in1">b</p></dialog><dialog id="d2" open><p id="in2">c</p></dialog>`;
		for (const id of ["d1", "d2"])
			Object.defineProperty($(id), "matches", {
				value: (s: string) => s === ":modal",
			});
		const r = box(10, 10, 50, 20);
		expect(viewOf($("page"), r)).toBeNull();
		expect(viewOf($("in1"), r)).not.toBeNull();
		expect(viewOf($("in2"), r)).not.toBeNull();
	});
});

describe("what covers an element", () => {
	const element = box(100, 200, 400, 100);

	beforeEach(() => {
		doc.body.innerHTML = `
			<header id="head" style="position: sticky"><span id="logo">S</span></header>
			<div id="layer" style="position: fixed"><button id="fab">+</button></div>
			<div id="el">marked</div>`;
		place($("layer"), box(0, 0, 1024, 768));
		place($("fab"), box(80, 180, 56, 56));
	});

	test("a small button in a fixed layer the pointer passes through covers only its corner: the mark stays", () => {
		// The layer itself takes no pointer: the hit test sees its button only.
		hitsAt = (x, y) =>
			within({ x, y }, box(80, 180, 56, 56))
				? [$("fab"), $("el"), doc.body]
				: [$("el"), doc.body];
		expect(viewOf($("el"), element)).toEqual(box(0, 0, 1024, 768));
	});

	test("a sticky head across the element's top takes the top off, by the head's box", () => {
		place($("head"), box(0, 180, 1024, 50));
		place($("logo"), box(10, 190, 20, 20));
		hitsAt = (_x, y) =>
			y <= 230 ? [$("logo"), $("head"), doc.body] : [$("el"), doc.body];
		expect(viewOf($("el"), element)?.y).toBe(230);
	});

	test("found covers are kept a while, and asked again once old", () => {
		place($("head"), box(0, 180, 1024, 50));
		hitsAt = (_x, y) => (y <= 230 ? [$("head")] : [$("el")]);
		expect(viewOf($("el"), element)?.y).toBe(230);
		// The head slid away (a class, no DOM change, nothing else moved).
		place($("head"), box(0, -50, 1024, 50));
		hitsAt = () => [$("el")];
		clock += COVER_MS - 1;
		expect(viewOf($("el"), element)?.y).toBe(230);
		clock += 1;
		expect(viewOf($("el"), element)?.y).toBe(0);
	});

	test("a mark nothing covers is not asked again while the page stands still", () => {
		let asked = 0;
		hitsAt = () => {
			asked++;
			return [$("el")];
		};
		expect(viewOf($("el"), element)?.y).toBe(0);
		const first = asked;
		expect(first).toBeGreaterThan(0);
		clock += 3 * COVER_MS;
		expect(viewOf($("el"), element)?.y).toBe(0);
		expect(asked).toBe(first);
		// A change of the DOM: asked again.
		expect(viewOf($("el"), element, 1)?.y).toBe(0);
		expect(asked).toBeGreaterThan(first);
	});

	test("while it moves, the covers found are taken at their boxes; once still, the page is asked again", () => {
		place($("head"), box(0, 0, 1024, 60));
		hitsAt = (_x, y) => (y <= 60 ? [$("head")] : [$("el")]);
		const at = (y: number) => box(100, y, 400, 100);
		// Found once, under the head.
		expect(viewOf($("el"), at(40))?.y).toBe(60);
		// A scroll: no hit test, the head's box of the moment.
		let asked = 0;
		hitsAt = (_x, y) => {
			asked++;
			return y <= 60 ? [$("head")] : [$("el")];
		};
		clock += 16;
		expect(viewOf($("el"), at(30))?.y).toBe(60);
		expect(asked).toBe(0);
		// Still, and the head slides in further.
		place($("head"), box(0, 0, 1024, 80));
		hitsAt = (_x, y) => (y <= 80 ? [$("head")] : [$("el")]);
		clock += SETTLE_MS;
		expect(viewOf($("el"), at(30))?.y).toBe(80);
	});
});
