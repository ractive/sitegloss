/**
 * A highlight's text looked for around its element when it is not in it
 * (DEC-083): the area (a few levels up, not past the nearest section), the
 * same text in another element there, new text in the old place, and the
 * place a lost element's selector names. The decisions are
 * test/highlight.test.ts's; this gives them a page.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	AREA_NODES,
	findNearby,
	findText,
	nearbyAreas,
	placeOf,
} from "../src/content/text-range.ts";

let doc: Document;

beforeEach(() => {
	const window = new Window({ url: "https://sitegloss.dev/" });
	doc = window.document as unknown as Document;
});

const $ = (s: string) => doc.querySelector(s) as Element;

describe("a highlight's text around its element", () => {
	test("the same text in another element of its card", () => {
		doc.body.innerHTML = `<main><section><div class="card">
			<h1><span id="was">Mark it, then fix it</span></h1>
			<p>Open the case on <code>localhost</code> to fix it.</p>
		</div></section></main>`;
		const h = { text: "localhost" };
		expect(findText($("#was"), h)).toBe("gone");
		const near = findNearby($("#was"), h);
		expect(near?.how).toBe("nearby");
		expect(near?.holder).toBe($("code"));
		expect(near?.range.toString()).toBe("localhost");
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
		const near = findNearby($("#p"), h);
		expect(near?.how).toBe("reworded");
		expect(near?.now).toBe("localhost");
		expect(near?.range.toString()).toBe("localhost");
	});

	test("not past the nearest section: the same text in the next section is not taken", () => {
		doc.body.innerHTML = `<main>
			<section><div><p id="p">Install the extension.</p></div></section>
			<section><p>Open it on localhost.</p></section>
		</main>`;
		expect(nearbyAreas($("#p")).map((e) => e.localName)).toEqual([
			"section",
			"div",
			"p",
		]);
		expect(findNearby($("#p"), { text: "localhost" })).toBeUndefined();
	});

	test("a few levels up at most, where no section is near", () => {
		doc.body.innerHTML = `<div id="far">localhost<div><div><div><div><div><span id="s">Here</span></div></div></div></div></div></div>`;
		expect(nearbyAreas($("#s"))).toHaveLength(5);
		expect(findNearby($("#s"), { text: "localhost" })).toBeUndefined();
	});

	test("an area with too much text gives way to the largest one under it that is read", () => {
		const many = Array.from(
			{ length: AREA_NODES + 10 },
			(_, i) => `<p>Line ${i}</p>`,
		).join("");
		doc.body.innerHTML = `<article>${many}<div><p id="p">Old words</p><p>Open it on localhost.</p></div></article>`;
		// Measured once here: 69 ms in happy-dom (DEC-083).
		const near = findNearby($("#p"), { text: "localhost" });
		expect(near?.how).toBe("nearby");
		expect(near?.range.toString()).toBe("localhost");
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
});
