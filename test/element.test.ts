import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { type ElementDetails, validateCase } from "../src/lib/case.ts";
import {
	accessibleName,
	cssSelector,
	describeElement,
	headingAbove,
	landmarkOf,
	roleOf,
	summarize,
	withinLimits,
} from "../src/lib/element.ts";
import { sampleCase } from "./fixtures.ts";

let doc: Document;

const PAGE = `
<header class="Header_root__a1B2c">
	<nav aria-label="Hauptmenü">
		<a class="Nav_link__x9Y8z" href="/versicherungen">Versicherungen</a>
		<a class="Nav_link__x9Y8z" href="https://example.com/login?x=1">Anmelden</a>
	</nav>
</header>
<main>
	<h1 class="Hero_title__Q7r2s">Krankenkassen vergleichen</h1>
	<form id=":r3:" class="Form_root__k3L9m">
		<label>Postleitzahl <input name="zip" placeholder="z.B. 8000" value="8001" /></label>
		<input id="year" name="year" aria-label="Jahrgang" />
		<button class="Button_primary__p4T6u sc-bdVaJa" type="submit">Prämien   berechnen</button>
		<button data-testid="reset" type="reset">Zurücksetzen</button>
	</form>
	<section aria-label="Tipps">
		<h2>Tipps zum Sparen</h2>
		<p>Mit einer höheren Franchise sparen Sie.</p>
		<p>Mit einer höheren Franchise sparen Sie.</p>
		<img src="/img/tip.png?v=2" alt="Sparschwein" />
	</section>
</main>`;

beforeEach(() => {
	const window = new Window({ url: "https://www.example.com/kk" });
	doc = window.document as unknown as Document;
	doc.body.innerHTML = PAGE;
});

const $ = (s: string) => doc.querySelector(s) as Element;

describe("roles and names", () => {
	test("implicit roles", () => {
		expect(roleOf($("nav"))).toBe("navigation");
		expect(roleOf($("header"))).toBe("banner");
		expect(roleOf($("a"))).toBe("link");
		expect(roleOf($("button"))).toBe("button");
		expect(roleOf($("input[name=zip]"))).toBe("textbox");
		expect(roleOf($("h1"))).toBe("heading");
		expect(roleOf($("section"))).toBe("region");
	});

	test("accessible names, never a typed value", () => {
		expect(accessibleName($("input[name=zip]"))).toBe("Postleitzahl");
		expect(accessibleName($("#year"))).toBe("Jahrgang");
		expect(accessibleName($("button"))).toBe("Prämien berechnen");
		expect(accessibleName($("img"))).toBe("Sparschwein");
		expect(accessibleName($("nav"))).toBe("Hauptmenü");
	});

	test("landmarks and headings", () => {
		expect(landmarkOf($("a"))).toBe("navigation: Hauptmenü");
		expect(landmarkOf($("button"))).toBe("form");
		const headings = [...doc.querySelectorAll("h1, h2")];
		expect(headingAbove($("button"), headings)).toBe(
			"Krankenkassen vergleichen",
		);
		expect(headingAbove($("section p"), headings)).toBe("Tipps zum Sparen");
		expect(headingAbove($("h1"), headings)).toBeUndefined();
		expect(headingAbove($("h2"), headings)).toBe("Krankenkassen vergleichen");
	});
});

describe("describeElement", () => {
	test("records readable classes, attributes and ancestors", () => {
		const d = describeElement($("form button"));
		expect(d.tag).toBe("button");
		expect(d.role).toBe("button");
		expect(d.name).toBe("Prämien berechnen");
		expect(d.text).toBe("Prämien berechnen");
		expect(d.classes).toEqual(["Button_primary"]);
		expect(d.attributes).toEqual({ type: "submit" });
		expect(d.heading).toBe("Krankenkassen vergleichen");
		expect(d.ancestors).toEqual(["form.Form_root", "main"]);
		expect(d.id).toBeUndefined();
		expect(d.testId).toBeUndefined();
	});

	test("keeps hand-written ids and test ids, drops generated ids", () => {
		expect(describeElement($("#year")).id).toBe("year");
		expect(describeElement($("form")).id).toBeUndefined();
		expect(describeElement($("[data-testid=reset]")).testId).toBe("reset");
	});

	test("shortens links and images", () => {
		expect(describeElement($("nav a")).attributes["href"]).toBe(
			"/versicherungen",
		);
		expect(describeElement($("nav a:nth-of-type(2)")).attributes["href"]).toBe(
			"example.com/login",
		);
		expect(describeElement($("img")).attributes["src"]).toBe("tip.png");
	});

	test("a link to a part of the same page keeps its fragment, as the demo page's Book buttons (DEC-047)", () => {
		// The demo page (ractive.ch/sitegloss/demo/): "Book" goes to #book,
		// "Bikes" to #bikes, on the same page.
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<nav><a id="to-bikes" href="#bikes">Bikes</a></nav>
			<section id="bikes"><a id="to-book" class="pp-btn" href="#book">Book</a></section>
			<section id="book"></section>
			<a id="to-route" href="#/cart?coupon=x">Cart</a>
			<a id="to-token" href="#access_token=abc">Back</a>
			<a id="to-nothing" href="#nowhere">Nowhere</a>
			<a id="to-other" href="/faq#shipping">FAQ</a>
			<a id="to-site" href="https://other.example/app#/account/settings">Other app</a>`,
		);
		const href = (id: string) =>
			describeElement($(`#${id}`)).attributes["href"];
		const path = new URL(doc.baseURI).pathname;
		expect(href("to-book")).toBe(`${path}#book`);
		expect(href("to-bikes")).toBe(`${path}#bikes`);
		// A hash route names a page: kept up to its parameters.
		expect(href("to-route")).toBe(`${path}#/cart`);
		// What names no element of the page can carry anything: dropped.
		expect(href("to-token")).toBe(path);
		expect(href("to-nothing")).toBe(path);
		// Another page's fragment cannot be checked from here: dropped.
		expect(href("to-other")).toBe("/faq");
		// Another site's route names no place of this page.
		expect(href("to-site")).toBe("other.example/app");
	});

	test("keeps data URLs and long URLs short", () => {
		const svg = `data:image/svg+xml,${encodeURIComponent(`<svg>${"<rect/>".repeat(800)}</svg>`)}`;
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<img id="inline" src="${svg}" alt="x" /><a id="far" href="https://other.example/${"a".repeat(5000)}">x</a>`,
		);
		expect(describeElement($("#inline")).attributes["src"]).toBe(
			"data:image/svg+xml",
		);
		const href = describeElement($("#far")).attributes["href"] ?? "";
		expect(href.length).toBe(300);
		expect(href.startsWith("other.example/aaa")).toBe(true);
	});

	test("never records what was typed into an editor", () => {
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<div id="editor" contenteditable="true" aria-label="Message"><h3>Private heading</h3><p id="typed">Secret draft text</p></div>
			<div id="custom" role="textbox" title="Notes">typed notes</div>
			<p id="after">After the editor</p>`,
		);
		const editor = describeElement($("#editor"));
		expect(editor.text).toBeUndefined();
		expect(editor.name).toBe("Message");
		const typed = describeElement($("#typed"));
		expect(typed.text).toBeUndefined();
		expect(typed.name).toBeUndefined();
		const custom = describeElement($("#custom"));
		expect(custom.text).toBeUndefined();
		expect(custom.name).toBe("Notes");
		expect(describeElement($("#after")).heading).toBe("Tipps zum Sparen");
	});

	test("never records typed text through an element around an editor", () => {
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<div id="box" class="comment-box"><div class="toolbar">B I U</div><div contenteditable>my unsent private reply</div></div>
			<label id="wrap" role="button">Reply <textarea>typed answer</textarea> <input value="typed value" /></label>
			<h4 id="heading">Title <span contenteditable="true">typed heading</span></h4>
			<p id="below">Below</p>
			<div id="scripted">Visible<script>var secret = 1;</script><style>.x{}</style></div>`,
		);
		const textarea = doc.querySelector("#wrap textarea") as HTMLTextAreaElement;
		// React sets the value through defaultValue, which becomes the text.
		textarea.defaultValue = "typed through React";
		const box = describeElement($("#box"));
		expect(box.text).toBe("B I U");
		expect(JSON.stringify(box)).not.toContain("private reply");
		const wrap = describeElement($("#wrap"));
		expect(wrap.name).toBe("Reply");
		expect(JSON.stringify(wrap)).not.toContain("typed");
		const area = describeElement(textarea);
		expect(area.text).toBeUndefined();
		expect(JSON.stringify(area)).not.toContain("React");
		expect(describeElement($("#below")).heading).toBe("Title");
		expect(describeElement($("#scripted")).text).toBe("Visible");
	});

	test.each([
		[
			"Monaco",
			`<div class="monaco-editor"><textarea></textarea><div class="view-lines"><div class="view-line" id="typed"><span>const secret = 1;</span></div></div></div>`,
		],
		[
			"CodeMirror 5",
			`<div class="CodeMirror"><div><textarea></textarea></div><div class="CodeMirror-code"><pre class="CodeMirror-line" id="typed"><span>const secret = 1;</span></pre></div></div>`,
		],
		[
			"Ace",
			`<div class="ace_editor"><textarea></textarea><div class="ace_content"><div class="ace_line" id="typed">const secret = 1;</div></div></div>`,
		],
	])("never records what was typed into %s", (_name, editor) => {
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<section id="around"><h3 id="title">Script</h3>${editor}</section><p id="below">Below</p>`,
		);
		for (const id of ["typed", "around"])
			expect(JSON.stringify(describeElement($(`#${id}`)))).not.toContain(
				"secret",
			);
		expect(describeElement($("#around")).text).toBe("Script");
		const root = $("#typed").closest(
			".monaco-editor, .CodeMirror, .ace_editor",
		);
		expect(JSON.stringify(describeElement(root as Element))).not.toContain(
			"secret",
		);
		expect(describeElement($("#below")).heading).toBe("Script");
	});

	test("records the allow-listed details and nothing else", () => {
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<a id="link" href="/konto?token=secret-token&email=a%40b.ch#private" data-foo="secret-data" onclick="secret()" aria-describedby="x" style="color: red" title="Konto">Mein Konto</a>
			<input id="field" name="email" type="email" value="secret-value" placeholder="E-Mail" />
			<a id="mail" href="mailto:a@b.ch?subject=secret">Mail</a>`,
		);
		(doc.getElementById("field") as HTMLInputElement).value = "typed-secret";
		const allowed = new Set([
			"tag",
			"id",
			"testId",
			"role",
			"name",
			"text",
			"classes",
			"attributes",
			"heading",
			"landmark",
			"ancestors",
			"rect",
			"page",
			"selector",
		]);
		for (const id of ["link", "field", "mail"]) {
			const d = describeElement($(`#${id}`));
			for (const key of Object.keys(d)) expect(allowed.has(key)).toBe(true);
			for (const key of Object.keys(d.attributes))
				expect([
					"name",
					"type",
					"href",
					"src",
					"placeholder",
					"alt",
					"title",
				]).toContain(key);
			expect(JSON.stringify(d)).not.toContain("secret");
		}
		expect(describeElement($("#link")).attributes["href"]).toBe("/konto");
		expect(describeElement($("#mail")).attributes["href"]).toBe("mailto:");
		expect(describeElement($("#field")).attributes).toEqual({
			name: "email",
			type: "email",
			placeholder: "E-Mail",
		});
	});

	test("summary", () => {
		expect(summarize(describeElement($("form button")))).toBe(
			'button "Prämien berechnen" · Button_primary · under "Krankenkassen vergleichen"',
		);
	});
});

describe("limits", () => {
	/** A case that holds the element's details, as saving builds it. */
	const accepted = (element: ElementDetails) =>
		validateCase({
			...sampleCase(),
			shots: [
				{
					id: "s1",
					image: "shots/s1.webp",
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 1 },
					capturedAt: "2026-11-04T10:00:00Z",
				},
			],
			marks: [
				{
					id: "a1",
					number: 1,
					author: "user",
					comment: "",
					shot: "s1",
					crop: "crops/a1.webp",
					shape: { kind: "note", at: { x: 0, y: 0 } },
					element,
				},
			],
		});

	test.each([
		["its own test id", 350, `<p id="at" data-testid="%">x</p>`],
		[
			"its own test id over the selector's limit",
			2100,
			`<p id="at" data-testid="%">x</p>`,
		],
		["a test id around it", 320, `<div data-testid="%"><p id="at">x</p></div>`],
		[
			"a long test id around it",
			2100,
			`<div data-testid="%"><p id="at">x</p></div>`,
		],
		["a role", 2100, `<p id="at" role="%">x</p>`],
		[
			"a landmark's role",
			2100,
			`<section aria-label="x" role="%"><p id="at">x</p></section>`,
		],
	])("%s of %d characters can be saved", (_name, length, html) => {
		doc.body.innerHTML = html.replace("%", "t".repeat(length));
		const d = describeElement($("#at"));
		expect(() => accepted(d)).not.toThrow();
	});

	test("a long element name can be saved", () => {
		const tag = `app-${"x".repeat(70)}`;
		doc.body.innerHTML = `<${tag} id="at">x</${tag}><p id="in"></p>`;
		$("#in").remove();
		const d = describeElement($("#at"));
		expect(d.tag.length).toBe(64);
		expect(() => accepted(d)).not.toThrow();
	});

	test("every field keeps to the table", () => {
		const t = "t".repeat(400);
		doc.body.innerHTML = `<section aria-label="${t}" role="${t}"><div data-testid="${t}"><p id="at" data-testid="${t}" role="${t}">x</p></div></section>`;
		const d = describeElement($("#at"));
		expect(d.testId).toBe(t.slice(0, 300));
		expect(d.role?.length).toBe(64);
		expect(d.ancestors[0]?.length).toBe(300);
		expect(d.landmark?.length).toBe(200);
	});

	test("cutting twice changes nothing, and short values stay", () => {
		const d = describeElement($("form button"));
		expect(withinLimits(d)).toEqual(d);
		doc.body.innerHTML = `<p data-testid="${"t".repeat(350)}">x</p>`;
		const long = describeElement($("p"));
		expect(withinLimits(long)).toEqual(long);
	});
});

describe("shadow roots", () => {
	let root: ShadowRoot;

	beforeEach(() => {
		doc.body.innerHTML = `<header><h2>Vor dem Bauteil</h2></header>
			<nav aria-label="Hauptmenü"><div class="Shell_root"><app-card data-testid="card"></app-card></div></nav>
			<h2>Nach dem Bauteil</h2>`;
		root = $("app-card").attachShadow({ mode: "open" });
		root.innerHTML = `<style>.x { color: red }</style>
			<span id="label">Beschriftet</span>
			<section><button id="named" aria-labelledby="label"></button>
			<button id="plain">Speichern</button></section>`;
	});

	const inner = (s: string) => root.querySelector(s) as Element;

	test("ancestors, landmark and heading go on outside the root", () => {
		const d = describeElement(inner("#plain"));
		expect(d.ancestors).toEqual([
			"section",
			"app-card[card]",
			"div.Shell_root",
			"nav",
		]);
		expect(d.landmark).toBe("navigation: Hauptmenü");
		expect(d.heading).toBe("Vor dem Bauteil");
	});

	test("a label is looked for in the element's own root", () => {
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<span id="label">Ein anderes Element</span>`,
		);
		expect(accessibleName(inner("#named"))).toBe("Beschriftet");
	});

	test("the text of a slot is what is slotted into it", () => {
		doc.body.innerHTML = `<app-button>Offerte senden</app-button>`;
		const shadow = $("app-button").attachShadow({ mode: "open" });
		shadow.innerHTML = `<button><slot></slot></button>`;
		const button = shadow.querySelector("button") as Element;
		expect(describeElement(button).text).toBe("Offerte senden");
		expect(describeElement(button).name).toBe("Offerte senden");
	});

	test("slotted fields stay unread", () => {
		doc.body.innerHTML = `<app-box>Betreff<textarea>typed secret</textarea></app-box>`;
		const shadow = $("app-box").attachShadow({ mode: "open" });
		shadow.innerHTML = `<div><slot></slot></div>`;
		const d = describeElement(shadow.querySelector("div") as Element);
		expect(d.text).toBe("Betreff");
		expect(JSON.stringify(d)).not.toContain("secret");
	});

	test("an editor around the root counts for what is inside it", () => {
		doc.body.innerHTML = `<div role="textbox"><app-line></app-line></div>`;
		const shadow = $("app-line").attachShadow({ mode: "open" });
		shadow.innerHTML = `<p>typed secret</p>`;
		const d = describeElement(shadow.querySelector("p") as Element);
		expect(d.text).toBeUndefined();
		expect(JSON.stringify(d)).not.toContain("secret");
	});

	test("a detached link does not pass for a shadow root", () => {
		const link = doc.createElement("a");
		link.href = "https://www.example.com/kk";
		expect(landmarkOf(link)).toBeUndefined();
	});

	test("no selector, rather than one that finds another element", () => {
		doc.body.insertAdjacentHTML(
			"beforeend",
			`<button class="Save">Light</button>`,
		);
		root.innerHTML = `<button class="Save">Shadow</button>`;
		expect(cssSelector(inner(".Save"))).toBe("");
	});
});

describe("cssSelector", () => {
	test("prefers test ids, ids and readable classes, and is unique", () => {
		expect(cssSelector($("[data-testid=reset]"))).toBe('[data-testid="reset"]');
		expect(cssSelector($("#year"))).toBe("#year");
		expect(cssSelector($("h1"))).toBe('h1[class*="Hero_title"]');
		for (const el of doc.querySelectorAll("body *")) {
			const selector = cssSelector(el);
			expect(doc.querySelectorAll(selector).length).toBe(1);
			expect(doc.querySelector(selector)).toBe(el);
		}
	});

	test("two identical deep subtrees: the path goes on until it is unique", () => {
		const deep = `${"<div>".repeat(13)}<span>x</span>${"</div>".repeat(13)}`;
		doc.body.innerHTML = `<main>${deep}${deep}</main>`;
		for (const span of doc.querySelectorAll("span")) {
			const selector = cssSelector(span);
			expect(doc.querySelectorAll(selector).length).toBe(1);
			expect(doc.querySelector(selector) === span).toBe(true);
		}
	});

	test("a short path stays short", () => {
		const deep = `${"<div>".repeat(13)}<span>x</span>${"</div>".repeat(13)}`;
		doc.body.innerHTML = `<main>${deep}</main>`;
		expect(cssSelector($("span")).split(" > ").length).toBe(10);
	});

	test("a value too long for a selector falls back to the path", () => {
		doc.body.innerHTML = `<main><p>a</p><p data-testid="${"t".repeat(2100)}">b</p></main>`;
		const p = $("p:nth-of-type(2)");
		const selector = cssSelector(p);
		expect(selector.length).toBeLessThanOrEqual(2000);
		expect(doc.querySelector(selector) === p).toBe(true);
	});

	test("no selector when no path fits the limit", () => {
		const tag = "app-section-wrapper-element";
		const deep = `${`<${tag}>`.repeat(80)}<span>x</span>${`</${tag}>`.repeat(80)}`;
		doc.body.innerHTML = `<main>${deep}${deep}</main>`;
		expect(cssSelector($("span"))).toBe("");
	});
});

describe("the heading of a section or card (DEC-047)", () => {
	/** The demo page (a copy in e2e/pages), as a browser would have it. */
	async function demo(): Promise<Document> {
		const html = await Bun.file(
			new URL("./e2e/pages/demo.html", import.meta.url),
		).text();
		const window = new Window({ url: "https://ractive.ch/sitegloss/demo/" });
		const page = window.document as unknown as Document;
		page.write(html);
		return page;
	}
	const heading = (page: Document, selector: string) =>
		describeElement(page.querySelector(selector) as Element).heading;

	test("what comes before a card's title is under that title, not the card before", async () => {
		const page = await demo();
		// The e-bike's "New" badge and its picture come before its h3.
		expect(heading(page, ".pp-card-new .pp-badge")).toBe("E-bike");
		expect(heading(page, "[data-testid=card-ebike] svg")).toBe("E-bike");
		expect(heading(page, "[data-testid=card-gravel] svg")).toBe("Gravel bike");
		expect(heading(page, "[data-testid=card-city] svg")).toBe("City bike");
	});

	test("what follows a title stays under it, as before", async () => {
		const page = await demo();
		expect(heading(page, "[data-testid=card-city-book]")).toBe("City bike");
		expect(heading(page, "[data-testid=card-gravel-price]")).toBe(
			"Gravel bike",
		);
		expect(heading(page, "[data-testid=booking-name]")).toBe("Book a bike");
		expect(heading(page, "[data-testid=summary-price-ebike]")).toBe(
			"Prices at a glance",
		);
		expect(heading(page, "[data-testid=hero-line]")).toBe(
			"Bikes for the trails, by the day",
		);
		// Nothing above it on the page: none.
		expect(heading(page, "[data-testid=brand]")).toBeUndefined();
	});

	test("a heading is not under its own sub-heading", () => {
		doc.body.innerHTML = `<h1>Shop</h1><section><h2 id="bikes">Bikes</h2><p>Text</p><h3>City</h3></section>`;
		const headings = [...doc.querySelectorAll("h1, h2, h3")];
		expect(headingAbove($("#bikes"), headings)).toBe("Shop");
	});

	test("a card's own title over a subsection's inside it", () => {
		doc.body.innerHTML = `<h2>Plans</h2>
			<ul>
				<li class="plan"><h3>Basic</h3><div class="specs"><article><h4>Specs</h4><p>5 GB</p></article></div><a id="basic-buy">Buy</a></li>
				<li class="plan"><span id="pro-tag">Popular</span><h3>Pro</h3></li>
			</ul>
			<p id="after">Prices in CHF.</p>`;
		const headings = [...doc.querySelectorAll("h2, h3, h4")];
		expect(headingAbove($("#basic-buy"), headings)).toBe("Basic");
		expect(headingAbove($("#pro-tag"), headings)).toBe("Pro");
		// Under no section or card: the nearest heading above, as before.
		expect(headingAbove($("#after"), headings)).toBe("Pro");
	});
});
