/**
 * A highlight's text looked for around its element when it is not in it
 * (DEC-083): the areas nearest first (not past the nearest section, not
 * over 2,000 text nodes), a way taken only where it has exactly one place
 * that shows, and the place a lost element's selector names. The ways'
 * places are test/highlight.test.ts's; this gives them a page.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	AREA_NODES,
	findNearby,
	findText,
	nearbyAreas,
	placeOf,
	showsOnPage,
} from "../src/content/text-range.ts";
import { type NearWay, nearWays } from "../src/lib/highlight.ts";

let doc: Document;
let window: Window;

beforeEach(() => {
	window = new Window({ url: "https://sitegloss.dev/" });
	doc = window.document as unknown as Document;
});

const $ = (s: string) => doc.querySelector(s) as Element;

/** happy-dom lays nothing out: text shows unless it is for screen readers only. */
const shows = (r: Range) =>
	r.startContainer.parentElement?.closest(".sr-only") == null;

/** An element found for sure (`nearWays("found", 1)`): every way. */
const ALL = nearWays("found", 1);

const near = (
	el: Element,
	h: { text: string; before?: string; after?: string },
	ways: readonly NearWay[] = ALL,
) => findNearby(el, h, { ways, shows });

describe("a highlight's text around its element", () => {
	test("a span that held only the word, its word now the only one in the card", () => {
		doc.body.innerHTML = `<main><section><div class="card">
			<h1><span id="was">Mark it, then fix it</span></h1>
			<p>Open the case on <code>localhost</code> to fix it.</p>
		</div></section></main>`;
		const h = { text: "localhost" };
		expect(findText($("#was"), h)).toBe("gone");
		const found = near($("#was"), h);
		expect(found?.how).toBe("nearby");
		expect(found?.holder).toBe($("code"));
		expect(found?.range.toString()).toBe("localhost");
	});

	test("new text between the same text before and after it, in the element itself", () => {
		doc.body.innerHTML = `<main><section>
			<p id="p">The developer finds the case in the mail, opens it on <code>localhost</code> and fixes it.</p>
		</section></main>`;
		const h = {
			text: "localhost:3000",
			before: "the mail, opens it on ",
			after: " and fixes it.",
		};
		expect(findText($("#p"), h)).toBe("gone");
		const found = near($("#p"), h);
		expect(found?.how).toBe("reworded");
		expect(found?.now).toBe("localhost");
	});

	test("no evidence, nothing: a digit, a word inside a longer one, a deleted short word", () => {
		doc.body.innerHTML = `<main>
			<table><tr><td id="cell">4</td><td>2023</td></tr></table>
			<form><button id="button">Submit</button> <a href="/d">Saved drafts</a></form>
			<section><h2>About the team</h2><p id="p">We are small team.</p></section>
		</main>`;
		expect(near($("#cell"), { text: "3" })).toBeUndefined();
		expect(near($("#button"), { text: "Save" })).toBeUndefined();
		// "the" was taken out by the fix: nothing is between the text around it.
		expect(
			near($("#p"), { text: "the", before: "We are ", after: " small team." }),
		).toBeUndefined();
	});

	test("rows with the same text around it: none of them, unless the row is the element", () => {
		doc.body.innerHTML = `<main><ul>
			<li>Delete invoice 1040 from the list.</li>
			<li>Delete invoice 1041 from the list.</li>
			<li id="row">Delete invoice INV-42 from the list.</li>
		</ul></main>`;
		const h = {
			text: "1042",
			before: "Delete invoice ",
			after: " from the list.",
		};
		expect(near($("ul"), h)).toBeUndefined();
		expect(near($("#row"), h)?.now).toBe("INV-42");
		// The first row, only probable (the third row deleted by the fix): its
		// place is not trusted, so nothing; nor where the match was unsure.
		const first = $("li");
		expect(near(first, h, ALL)?.now).toBe("1040");
		expect(near(first, h, nearWays("probable", 1))).toBeUndefined();
		expect(nearWays("ambiguous", 1)).toEqual([]);
		expect(nearWays("found", 2)).toEqual([]);
	});

	test("a copy that does not show is no second place, and none that shows is no place", () => {
		doc.body.innerHTML = `<main><section>
			<p id="p">Mark it</p><p>Run it on <code>localhost</code>.</p>
			<span class="sr-only">localhost</span>
		</section></main>`;
		expect(near($("#p"), { text: "localhost" })?.holder).toBe($("code"));
		// Both shown: two places, none taken.
		expect(
			findNearby(
				$("#p"),
				{ text: "localhost" },
				{ ways: ALL, shows: () => true },
			),
		).toBeUndefined();
	});

	test("not past the nearest section, nearest area first", () => {
		doc.body.innerHTML = `<main>
			<section><div><p id="p">Install the extension.</p></div></section>
			<section><p>Open it on localhost.</p></section>
		</main>`;
		expect(nearbyAreas($("#p")).map((e) => e.localName)).toEqual([
			"p",
			"div",
			"section",
		]);
		expect(near($("#p"), { text: "localhost" })).toBeUndefined();
	});

	test("an area over 2,000 text nodes is not read, nor any above it", () => {
		const many = Array.from(
			{ length: AREA_NODES + 10 },
			(_, i) => `<p>Line ${i}</p>`,
		).join("");
		doc.body.innerHTML = `<article><p>Open it on localhost.</p>${many}<div><p id="p">Old words</p></div></article>`;
		// Measured once (DEC-083): reading it, about 4 ms in happy-dom (71 ms the first time).
		expect(near($("#p"), { text: "localhost" })).toBeUndefined();
	});

	test("a lost element's selector: the element it names, else its nearest ancestor on the page once", () => {
		doc.body.innerHTML = `<main><section class="hero"><div class="card"><h1>Mark it on localhost</h1></div></section></main>`;
		const place = placeOf(doc, "main > section > div > h1 > span");
		expect(place?.element).toBe($("h1"));
		expect(place?.levels).toBe(3);
		expect(placeOf(doc, "main > section > div > h1")?.levels).toBe(4);
		expect(placeOf(doc, "aside > p")).toBeUndefined();
		expect(placeOf(doc, "")).toBeUndefined();
	});

	test("a lost element's place is never a page's main or an app's root, and needs the text around it", () => {
		doc.body.innerHTML = `<div id="root"><main>
			<div class="features"><p>Mark what is wrong.</p></div>
			<div class="footer-cta"><p>Try it on <b>localhost</b> today, for free.</p></div>
		</main></div>`;
		expect(placeOf(doc, "main > section > div > h1 > span")).toBeUndefined();
		expect(placeOf(doc, "div > div > h1")).toBeUndefined();
		// A place found: the word alone is not enough for a lost mark.
		const placed = nearWays("lost", 0, true);
		expect(
			near($(".footer-cta"), { text: "localhost" }, placed),
		).toBeUndefined();
		expect(
			near(
				$(".footer-cta"),
				{
					text: "localhost:3000",
					before: "Try it on ",
					after: " today, for free.",
				},
				placed,
			)?.now,
		).toBe("localhost");
	});
});

describe("whether a place's text shows", () => {
	/** Puts happy-dom's own layout back. */
	let restore: () => void = () => undefined;

	/** Lines at `x`, and elements' boxes: 0 high for `.closed`, else 100 by 20. */
	function layout(x: number): void {
		const range = window.Range.prototype;
		const element = window.Element.prototype;
		const rects = range.getClientRects;
		const box = element.getBoundingClientRect;
		range.getClientRects = () => [{ x, y: 10, width: 50, height: 16 }] as never;
		element.getBoundingClientRect = function (this: Element) {
			return {
				x: 0,
				y: 0,
				width: 100,
				height: this.classList.contains("closed") ? 0 : 20,
			} as never;
		};
		restore = () => {
			range.getClientRects = rects;
			element.getBoundingClientRect = box;
		};
	}

	afterEach(() => restore());

	function rangeOn(b: Element): Range {
		const r = doc.createRange();
		r.selectNodeContents(b);
		return r;
	}

	test("not inside a collapsed part, however far up in the area", () => {
		doc.body.innerHTML = `<section><div id="part" style="overflow: hidden"><div><div><div><div><p><b>localhost</b></p></div></div></div></div></div></section>`;
		layout(10);
		expect(showsOnPage(rangeOn($("b")), $("section"))).toBe(true);
		$("#part").classList.add("closed");
		expect(showsOnPage(rangeOn($("b")), $("section"))).toBe(false);
	});

	test("not put off the page to the left, as text for screen readers is", () => {
		doc.body.innerHTML = `<section><p><b>localhost</b></p></section>`;
		layout(-10_000);
		expect(showsOnPage(rangeOn($("b")), $("section"))).toBe(false);
	});
});
