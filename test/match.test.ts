import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Window } from "happy-dom";
import type { ElementDetails } from "../src/lib/case.ts";
import {
	createContext,
	describeElement,
	legacyHeading,
} from "../src/lib/element.ts";
import { classify, rank, score, textSimilarity } from "../src/lib/match.ts";

async function load(page: string): Promise<Document> {
	const html = await Bun.file(join(import.meta.dir, "e2e/pages", page)).text();
	const window = new Window({ url: "https://www.example.com/kk" });
	const doc = window.document as unknown as Document;
	doc.write(html);
	return doc;
}

function details(doc: Document): {
	elements: Element[];
	all: ElementDetails[];
} {
	const context = createContext(doc);
	const elements = [...doc.body.querySelectorAll("*")];
	return { elements, all: elements.map((e) => describeElement(e, context)) };
}

describe("textSimilarity", () => {
	test("is 1 for the same text and lower for changed text", () => {
		expect(textSimilarity("Prämien  berechnen", "prämien berechnen")).toBe(1);
		const changed = textSimilarity(
			"Prämien berechnen",
			"Prämien jetzt berechnen",
		);
		expect(changed).toBeGreaterThan(0.7);
		expect(changed).toBeLessThan(1);
		expect(textSimilarity("Kontakt", "Hypotheken")).toBeLessThan(0.3);
		expect(textSimilarity("", "a")).toBe(0);
	});
});

describe("matching v1 marks on v2", () => {
	test.each([
		["submit", "the button whose text the fix changed"],
		["tip", "the tip that moved above the form"],
		["contact", "the contact paragraph next to a new one"],
	])("%s: %s", async (truth) => {
		const v1 = await load("v1.html");
		const v2 = await load("v2.html");
		const stored = describeElement(
			v1.querySelector(`[data-truth=${truth}]`) as Element,
		);
		const { elements, all } = details(v2);
		const ranked = rank(stored, all);
		const best = ranked[0];
		expect(best).toBeDefined();
		expect(elements[best?.index ?? -1]?.getAttribute("data-truth")).toBe(truth);
		expect(classify(ranked)).not.toBe("lost");
		expect(classify(ranked)).not.toBe("ambiguous");
	});

	test("an element that is gone is lost", async () => {
		const v1 = await load("v1.html");
		const stored = describeElement(v1.querySelector("footer") as Element);
		const v2 = await load("v2.html");
		v2.querySelector("footer")?.remove();
		const ranked = rank(stored, details(v2).all);
		expect(classify(ranked)).toBe("lost");
	});

	test.each([
		[
			"a paragraph",
			`<main><h2>Prices</h2><p data-gone>Prices rise by 3% in 2027.</p><p>Compare them with last year to see the change.</p></main>`,
			"p[data-gone]",
		],
		[
			"a list item",
			`<main><ul><li data-gone>Free cancellation</li><li>Online support around the clock</li></ul></main>`,
			"li[data-gone]",
		],
		[
			"a button",
			`<main><form><button data-gone type="button">Delete account</button><button type="button">Edit profile</button></form></main>`,
			"button[data-gone]",
		],
	])("%s removed by the fix is lost, not its sibling", (_name, html, gone) => {
		const window = new Window({ url: "https://www.example.com/kk" });
		const v1 = window.document as unknown as Document;
		v1.body.innerHTML = html;
		const stored = describeElement(v1.querySelector(gone) as Element);
		v1.querySelector(gone)?.remove();
		expect(classify(rank(stored, details(v1).all))).toBe("lost");
	});

	test("two identical elements are a tie", () => {
		const base: ElementDetails = {
			tag: "p",
			text: "Hallo",
			classes: [],
			attributes: {},
			ancestors: ["main"],
			rect: { x: 0, y: 0, width: 0, height: 0 },
			page: { width: 0, height: 0 },
			selector: "p",
		};
		const ranked = rank(base, [base, { ...base }]);
		expect(ranked[0]?.score).toBe(1);
		expect(classify(ranked)).toBe("ambiguous");
	});

	test("a test id outweighs changed text and classes", () => {
		const stored: ElementDetails = {
			tag: "button",
			testId: "calc",
			text: "Berechnen",
			classes: ["Button_primary"],
			attributes: { type: "submit" },
			ancestors: ["form"],
			rect: { x: 0, y: 0, width: 0, height: 0 },
			page: { width: 0, height: 0 },
			selector: '[data-testid="calc"]',
		};
		const moved = {
			...stored,
			text: "Jetzt rechnen",
			classes: ["Cta_root"],
			ancestors: ["div", "form"],
		};
		const other = { ...stored, testId: "reset", text: "Berechnen" };
		expect(score(stored, moved)).toBeGreaterThan(score(stored, other));
	});
});

describe("a link's fragment (DEC-047)", () => {
	test("a mark stored before links kept their fragment matches the link that now has one", () => {
		const window = new Window({ url: "https://shop.example/demo/" });
		const doc = window.document as unknown as Document;
		doc.write(
			`<section id="bikes"><a class="pp-btn" href="#book">Book</a><a class="pp-btn" href="#bikes">Bikes</a></section><section id="book"></section>`,
		);
		const { all } = details(doc);
		const book = all.find((d) => d.attributes["href"]?.endsWith("#book"));
		expect(book).toBeDefined();
		const old = {
			...(book as ElementDetails),
			attributes: { href: "/demo/" },
		};
		const now = rank(old, all, 3);
		expect(all[now[0]?.index ?? -1]?.attributes["href"]).toBe("/demo/#book");
		expect(score(old, book as ElementDetails)).toBe(
			score(book as ElementDetails, book as ElementDetails),
		);
	});
});

describe("a mark stored before the heading rule changed (DEC-047)", () => {
	test("on a badge in repeated cards, it is found on its own card, not the one before", () => {
		const window = new Window({ url: "https://shop.example/bikes/" });
		const doc = window.document as unknown as Document;
		doc.write(
			`<main><h2>Our bikes</h2>${["Lakeside", "Mountain", "Harbour"]
				.map(
					(title, i) =>
						`<article class="card" id="card-${i}"><span class="badge">New</span><h3>${title}</h3><a class="btn" href="/book">Book</a></article>`,
				)
				.join("")}</main>`,
		);
		// Laid out side by side: each card 300 px wide.
		for (const [i, card] of [...doc.querySelectorAll("article")].entries())
			for (const el of [card, ...card.querySelectorAll("*")])
				el.getBoundingClientRect = () =>
					({ x: i * 300 + 10, y: 100, width: 80, height: 20 }) as DOMRect;
		const badges = [...doc.querySelectorAll(".badge")];
		const second = badges[1] as Element;
		// What 0.3.0 stored for the second card's badge: the heading before it
		// in document order, the first card's title.
		// happy-dom has no page size: the one a browser would give.
		const page = { width: 1000, height: 800 };
		const old = {
			...describeElement(second),
			page,
			heading: legacyHeading(second, [...doc.querySelectorAll("h2, h3")]),
		};
		expect(old.heading).toBe("Lakeside");
		const context = createContext(doc);
		const all = badges.map((b) => ({
			...describeElement(b, context, { selector: false }),
			page,
		}));
		expect(all[1]?.heading).toBe("Mountain");
		expect(all[1]?.headingBefore).toBe("Lakeside");
		const [best] = rank(old as ElementDetails, all, 3);
		expect(best?.index).toBe(1);
	});
});

describe("a fragment on one side only (DEC-047)", () => {
	const link = (href: string): ElementDetails => ({
		tag: "a",
		classes: ["pp-btn"],
		attributes: { href },
		ancestors: [],
		rect: { x: 10, y: 10, width: 80, height: 20 },
		page: { width: 1000, height: 800 },
		selector: "",
		text: "Book",
	});
	test("stored with it, described without (the target not rendered yet), and the reverse, are the same link", () => {
		const full = score(link("/demo/"), link("/demo/"));
		expect(score(link("/demo/#book"), link("/demo/"))).toBe(full);
		expect(score(link("/demo/"), link("/demo/#book"))).toBe(full);
		// Two fragments still tell two links apart.
		expect(score(link("/demo/#book"), link("/demo/#bikes"))).toBeLessThan(full);
		// Another path is another link, fragment or not.
		expect(score(link("/demo/#book"), link("/faq/"))).toBeLessThan(full);
	});
});

describe("two buttons named Edit in one card (mark 47, DEC-063)", () => {
	// The web app's case page: the mark's text with its Edit, and under it a
	// comment with its own Edit. Both read "Edit"; only the accessible
	// names differ.
	const card = (comment: boolean) => {
		const window = new Window({ url: "https://www.example.com/case" });
		const doc = window.document as unknown as Document;
		doc.write(`<main><h2>Mark 47</h2><article class="card">
			<div class="row"><p>The button is too small</p>
			<button class="Button_ghost Button_sm" aria-label="Edit the text of mark 47">Edit</button></div>
			${
				comment
					? `<ol><li><p>Done in the fix</p><div class="row">
			<button class="Button_ghost Button_sm" aria-label="Edit the comment by Dana Developer via Claude Code">Edit</button>
			<button class="Button_ghost Button_sm" aria-label="Delete the comment by Dana Developer via Claude Code">Delete</button>
			</div></li></ol>`
					: ""
			}
		</article></main>`);
		return doc;
	};
	const stored = describeElement(
		card(true).querySelector('[aria-label^="Edit the comment"]') as Element,
	);

	test("both on the page: the comment's Edit, found", () => {
		const { elements, all } = details(card(true));
		const ranked = rank(stored, all);
		expect(
			elements[ranked[0]?.index ?? -1]?.getAttribute("aria-label") ===
				"Edit the comment by Dana Developer via Claude Code",
		).toBe(true);
		expect(classify(ranked)).toBe("found");
	});

	test("the comment not (yet) there: the other Edit is not said found", () => {
		const { all } = details(card(false));
		expect(classify(rank(stored, all))).not.toBe("found");
	});

	test("its Edit gone, the comment's Delete beside it is not said found", () => {
		const doc = card(true);
		doc.querySelector('[aria-label^="Edit the comment"]')?.remove();
		const { all } = details(doc);
		expect(classify(rank(stored, all))).not.toBe("found");
	});
});
