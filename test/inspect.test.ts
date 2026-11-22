import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	attributeValue,
	cleanCssUrls,
	cleanUrl,
	type Inspection,
	inspectElement,
	LEFT_OUT_INPUT,
	markupOf,
	matchedRules,
	pickStyles,
	resolveSelector,
	splitSelectors,
} from "../src/lib/inspect.ts";
import { selectorVocabularyProblem } from "../src/lib/selector.ts";

let doc: Document;

function page(html: string, head = ""): Document {
	const win = new Window({ url: "https://shop.example/kk" });
	win.document.write(
		`<!doctype html><html><head>${head}</head><body>${html}</body></html>`,
	);
	doc = win.document as unknown as Document;
	return doc;
}

const $ = (selector: string) => {
	const el = doc.querySelector(selector);
	if (el === null) throw new Error(`no ${selector}`);
	return el;
};

beforeEach(() => {
	page("");
});

describe("URLs", () => {
	test("lose their query string and fragment", () => {
		expect(cleanUrl("/search?q=me&token=abc")).toBe("/search?…");
		expect(cleanUrl("https://other.example/a#section")).toBe(
			"https://other.example/a#…",
		);
		expect(cleanUrl("#top")).toBe("#…");
		expect(cleanUrl("/plain/path")).toBe("/plain/path");
		expect(cleanUrl("data:image/png;base64,AAAA")).toBe("data:image/png…");
		expect(cleanUrl("javascript:alert(document.cookie)")).toBe("javascript:…");
	});

	test("lose a user name and password; other schemes keep only the scheme", () => {
		expect(cleanUrl("https://user:pw@shop.example/a?x=1")).toBe(
			"https://shop.example/a?…",
		);
		expect(cleanUrl("//user:pw@cdn.example/x.png")).toBe("//cdn.example/x.png");
		expect(cleanUrl("mailto:jane@example.com?subject=hi")).toBe("mailto:…");
		expect(cleanUrl("tel:+41441234567")).toBe("tel:…");
		expect(cleanUrl("sms:+41791234567")).toBe("sms:…");
	});

	test("in CSS too", () => {
		expect(
			cleanCssUrls(
				`background: url("https://cdn.example/a.png?sig=1") no-repeat, url(b.svg#icon)`,
			),
		).toBe(
			`background: url("https://cdn.example/a.png?…") no-repeat, url(b.svg#…)`,
		);
	});
});

describe("attributes", () => {
	test("form fields keep no value, and nothing else that could hold one", () => {
		page(
			`<input name="zip" value="8001" data-value="8001" aria-valuetext="8001" placeholder="PLZ" checked data-testid="zip" aria-label="Postleitzahl">`,
		);
		const input = $("input");
		const kept = [...input.attributes]
			.filter((a) => attributeValue(input, a.name, a.value) !== undefined)
			.map((a) => a.name);
		expect(kept).toEqual(["name", "placeholder", "data-testid", "aria-label"]);
	});

	test("handlers lose their code, long values are cut, other elements keep value", () => {
		page(`<button value="go" onclick="track('secret')">Go</button>`);
		const button = $("button");
		expect(attributeValue(button, "onclick", "track('secret')")).toBe("…");
		expect(attributeValue(button, "value", "go")).toBe("go");
		expect(attributeValue(button, "title", "t".repeat(400))?.length).toBe(201);
		expect(attributeValue(button, "nonce", "abc")).toBeUndefined();
		expect(attributeValue(button, "data-csrf-token", "abc")).toBe("…");
		expect(attributeValue(button, "data-session-id", "abc")).toBe("…");
	});

	test("URLs are cleaned by name and by value, srcdoc goes", () => {
		page(
			`<img><iframe></iframe><meta name="csrf-token"><meta name="viewport">`,
		);
		const img = $("img");
		const signed = "https://bucket.s3.example/a.jpg?X-Amz-Signature=abc";
		for (const name of [
			"data-src",
			"data-href",
			"data-url",
			"data-bg",
			"data-lazy-image",
		])
			expect(attributeValue(img, name, signed)).toBe(
				"https://bucket.s3.example/a.jpg?…",
			);
		expect(
			attributeValue(img, "data-srcset", "a.jpg?sig=1 1x, b.jpg?sig=2 2x"),
		).toBe("a.jpg?… 1x, b.jpg?… 2x");
		expect(attributeValue(img, "data-next", "/reset?token=1")).toBe("/reset?…");
		expect(attributeValue(img, "data-whatever", "img/a.png?sig=1")).toBe(
			"img/a.png?…",
		);
		expect(attributeValue(img, "data-mail", "mailto:jane@example.com")).toBe(
			"mailto:…",
		);
		expect(
			attributeValue(img, "data-config", `{"u":"https://x.example/p?k=1"}`),
		).toBe(`{"u":"https://x.example/p?…"}`);
		expect(attributeValue(img, "alt", "What is this? Read on.")).toBe(
			"What is this? Read on.",
		);
		expect(attributeValue($("iframe"), "srcdoc", "<p>doc</p>")).toBe("…");
		const [csrf, viewport] = [...doc.querySelectorAll("meta")];
		expect(attributeValue(csrf as Element, "content", "s3cret")).toBe("…");
		expect(
			attributeValue(viewport as Element, "content", "width=device-width"),
		).toBe("width=device-width");
		expect(attributeValue(img, "srcset", "a.png?x=1 1x, b.png?y=2 2x")).toBe(
			"a.png?… 1x, b.png?… 2x",
		);
		expect(attributeValue(img, "style", "background:url(/i.png?t=1)")).toBe(
			"background:url(/i.png?…)",
		);
	});
});

describe("markup", () => {
	test("leaves out values, typed text, scripts, styles and comments", () => {
		page(`<form class="Form_root">
			<!-- a comment -->
			<label>PLZ <input name="zip" value="8001"></label>
			<textarea name="note">my secret note</textarea>
			<select name="kk"><option value="a" selected>Helsana</option></select>
			<div contenteditable="true"><p>typed <b>text</b></p></div>
			<script>window.secret = 1</script>
			<style>.x { color: red }</style>
			<a href="/next?session=1">Weiter</a>
			<button type="submit" class="Button_primary">Prämien  berechnen</button>
		</form>`);
		const { html, leftOut } = markupOf($("form"));
		expect(leftOut).toBe(0);
		expect(html.startsWith('<form class="Form_root">')).toBe(true);
		expect(html.endsWith("</form>")).toBe(true);
		for (const gone of [
			"8001",
			"my secret note",
			"Helsana",
			"typed",
			"window.secret",
			"color: red",
			"a comment",
			"session",
		])
			expect(html).not.toContain(gone);
		expect(html).toContain('<input name="zip">');
		expect(html).toContain(
			`<textarea name="note">${LEFT_OUT_INPUT}</textarea>`,
		);
		expect(html).toContain("<script></script>");
		expect(html).toContain('<a href="/next?…">Weiter</a>');
		expect(html).toContain(
			'<button type="submit" class="Button_primary">Prämien berechnen</button>',
		);
	});

	test("an element inside an editable region is typed content as a whole", () => {
		page(`<div contenteditable="true"><p id="typed">my <b>words</b></p></div>`);
		const { html } = markupOf($("#typed"));
		expect(html).toBe(`<p id="typed">${LEFT_OUT_INPUT}</p>`);
	});

	test("is cut at the limit, stays well formed and says how much is left out", () => {
		const items = Array.from(
			{ length: 50 },
			(_, i) => `<li class="item">Item number ${i}</li>`,
		).join("");
		page(`<ul id="list">${items}</ul>`);
		const { html, leftOut } = markupOf($("#list"), { max: 400 });
		expect(html.length).toBeLessThan(520);
		expect(html.endsWith("</ul>")).toBe(true);
		expect(leftOut).toBeGreaterThan(30);
		expect(html).toContain(`${leftOut} more elements left out`);
		const opened = html.match(/<li /g)?.length ?? 0;
		expect(html.match(/<\/li>/g)?.length).toBe(opened);
		expect(opened + leftOut).toBe(50);
	});

	test("the head's content stays out", () => {
		page(
			"<p>x</p>",
			`<meta name="csrf-token" content="s3cret"><title>T</title>`,
		);
		const { html } = markupOf(doc.documentElement);
		expect(html).not.toContain("s3cret");
		expect(html).toContain("<head></head><body><p>x</p></body>");
	});

	test("leaves out hidden elements and says so", () => {
		page(
			`<div id="d"><p>shown</p><p style="display:none">gone <b>too</b></p><span style="visibility:hidden">x</span></div>`,
		);
		const { html, hidden } = markupOf($("#d"));
		expect(html).toBe(
			'<div id="d"><p>shown</p><!-- sitegloss: hidden p left out --><!-- sitegloss: hidden span left out --></div>',
		);
		expect(hidden).toBe(3);
		const inspected = inspectElement($("#d"));
		expect(inspected.children.map((c) => c.text)).toEqual(["shown"]);
		expect(inspected.childrenHidden).toBe(2);
	});

	test("a long markup comes with a short one", () => {
		page(`<ul id="l">${"<li>an item of the list</li>".repeat(400)}</ul>`);
		const inspected = inspectElement($("#l"));
		expect(inspected.html.length).toBeGreaterThan(10_000);
		expect(inspected.short?.html.length).toBeLessThan(4200);
		expect(inspected.short?.html.endsWith("</ul>")).toBe(true);
		expect(inspected.short?.leftOut).toBeGreaterThan(
			inspected.htmlLeftOut ?? 0,
		);
	});

	test("leaves out Sitegloss's own overlay", () => {
		page(`<main><p>Text</p><div id="sitegloss-root">toolbar</div></main>`);
		const { html } = markupOf($("main"), { skip: $("#sitegloss-root") });
		expect(html).toBe("<main><p>Text</p></main>");
	});

	test("long texts are cut", () => {
		page(`<p>${"word ".repeat(200)}</p>`);
		expect(markupOf($("p")).html.length).toBeLessThan(320);
	});
});

describe("styles", () => {
	const computed = (values: Record<string, string>) => (p: string) =>
		values[p] ??
		{
			display: "block",
			position: "static",
			"box-sizing": "content-box",
			width: "100px",
			height: "20px",
			"font-family": "sans-serif",
			"font-size": "16px",
			"font-weight": "400",
			"line-height": "normal",
			color: "rgb(0, 0, 0)",
			"min-width": "auto",
			"max-width": "none",
			"overflow-x": "visible",
			"overflow-y": "visible",
			opacity: "1",
			"z-index": "auto",
			transform: "none",
			visibility: "visible",
			"background-color": "rgba(0, 0, 0, 0)",
			"background-image": "none",
			"flex-grow": "0",
			"flex-shrink": "1",
			"flex-basis": "auto",
			"row-gap": "normal",
			"column-gap": "normal",
			"text-align": "start",
		}[p] ??
		(/^(margin|padding)-|-width$|-radius$/.test(p)
			? "0px"
			: /-style$/.test(p)
				? "none"
				: "");

	test("initial values are left out; sides come together", () => {
		const styles = pickStyles(
			computed({
				"margin-top": "8px",
				"margin-right": "16px",
				"margin-bottom": "8px",
				"margin-left": "16px",
				"padding-top": "4px",
				"padding-right": "4px",
				"padding-bottom": "4px",
				"padding-left": "4px",
				"border-top-width": "1px",
				"border-top-style": "solid",
				"border-top-color": "rgb(204, 204, 204)",
			}),
		);
		expect(styles).toEqual({
			display: "block",
			position: "static",
			"box-sizing": "content-box",
			width: "100px",
			height: "20px",
			margin: "8px 16px",
			padding: "4px",
			"border-top": "1px solid rgb(204, 204, 204)",
			"font-family": "sans-serif",
			"font-size": "16px",
			"font-weight": "400",
			"line-height": "normal",
			color: "rgb(0, 0, 0)",
		});
	});

	test("flex and grid containers and items, overflow and stacking", () => {
		const styles = pickStyles(
			computed({
				display: "flex",
				position: "relative",
				top: "4px",
				"row-gap": "8px",
				"column-gap": "8px",
				"flex-direction": "column",
				"flex-wrap": "nowrap",
				"justify-content": "space-between",
				"align-items": "normal",
				"align-content": "normal",
				"flex-grow": "1",
				"overflow-x": "hidden",
				"overflow-y": "auto",
				"z-index": "3",
			}),
			{ parentDisplay: "inline-flex" },
		);
		expect(styles["gap"]).toBe("8px");
		expect(styles["flex-direction"]).toBe("column");
		expect(styles["flex-wrap"]).toBeUndefined();
		expect(styles["justify-content"]).toBe("space-between");
		expect(styles["align-items"]).toBeUndefined();
		expect(styles["flex-grow"]).toBe("1");
		expect(styles["flex-shrink"]).toBeUndefined();
		expect(styles["top"]).toBe("4px");
		expect(styles["left"]).toBeUndefined();
		expect(styles["overflow"]).toBe("hidden auto");
		expect(styles["z-index"]).toBe("3");
	});

	test("the layout set has no fonts or colours; a child's is shorter", () => {
		const get = computed({ "background-color": "rgb(255, 0, 0)" });
		const layout = pickStyles(get, { set: "layout" });
		expect(layout["width"]).toBe("100px");
		expect(layout["font-size"]).toBeUndefined();
		expect(layout["background-color"]).toBeUndefined();
		expect(pickStyles(get)["background-color"]).toBe("rgb(255, 0, 0)");
		expect(pickStyles(get, { set: "child" })).toEqual({ display: "block" });
	});
});

describe("rules", () => {
	test("selectors split at top-level commas", () => {
		expect(splitSelectors(`a, b:is(c, d), [title="x, y"]`)).toEqual([
			"a",
			"b:is(c, d)",
			`[title="x, y"]`,
		]);
	});

	test("the rules that match, with sheet and media, in cascade order", () => {
		page(
			`<div class="Card"><button class="Button_primary">Go</button></div>`,
			`<style>
				.Button_primary { padding: 8px 16px; background: url(/b.png?v=3); }
				.Other { color: red; }
				@media (min-width: 1px) { .Card .Button_primary { margin: 4px; } }
				.Button_primary::before { content: "→"; }
			</style>`,
		);
		const { rules, leftOut, unreadable } = matchedRules($("button"));
		expect(leftOut).toBe(0);
		expect(unreadable).toEqual([]);
		expect(rules.map((r) => r.selector)).toEqual([
			".Button_primary",
			".Card .Button_primary",
			".Button_primary::before",
		]);
		expect(rules[0]?.sheet).toBe("<style> 1");
		expect(rules[0]?.declarations).toContain("padding");
		expect(rules[0]?.declarations).not.toContain("v=3");
		expect(rules[1]?.conditions).toEqual(["@media (min-width: 1px)"]);
		expect(rules[2]?.pseudo).toBe("::before");
	});

	test("are capped, keeping the later ones", () => {
		const css = Array.from(
			{ length: 45 },
			(_, i) => `.b { --n${i}: ${i}; }`,
		).join("\n");
		page(`<b class="b">x</b>`, `<style>${css}</style>`);
		const { rules, leftOut } = matchedRules($("b"));
		expect(rules).toHaveLength(30);
		expect(leftOut).toBe(15);
		expect(rules.at(-1)?.declarations).toContain("--n44");
	});
});

describe("the element on the page", () => {
	test("its box, the window, ancestors and children", () => {
		page(
			`<main class="Page"><section id="s" class="Card big"><h2>Title</h2><p>Body text</p><input value="secret"></section></main>`,
		);
		const inspected = inspectElement($("#s"));
		expect(inspected.tag).toBe("section");
		expect(inspected.html).toContain('<section id="s" class="Card big">');
		expect(inspected.html).not.toContain("secret");
		expect(inspected.viewport.width).toBeGreaterThan(0);
		expect(inspected.styles["display"]).toBeDefined();
		expect(inspected.ancestors.map((a) => a.tag)).toEqual([
			"main",
			"body",
			"html",
		]);
		expect(inspected.ancestors[0]?.classes).toEqual(["Page"]);
		expect(inspected.children.map((c) => [c.tag, c.text])).toEqual([
			["h2", "Title"],
			["p", "Body text"],
			["input", undefined],
		]);
	});

	test("with a mark's element, a selector is looked for only around it", () => {
		page(
			`<form class="f"><div class="row"><button class="b">Go</button></div></form><div class="row">other</div>`,
			`<meta name="csrf-token" content="s3cret">`,
		);
		const button = $("button");
		const up = resolveSelector(doc, button, ".row");
		expect("element" in up && up.relation).toBe("ancestor");
		expect("element" in up && up.element).toBe(button.parentElement as Element);
		const self = resolveSelector(doc, button, ".b");
		expect("element" in self && self.relation).toBe("mark");
		const down = resolveSelector(doc, $("form"), "button");
		expect("element" in down && down.relation).toBe("descendant");
		// No page-wide fallback: the other row, the head's meta tag.
		for (const selector of ["body > div.row", "meta[name=csrf-token]"])
			expect(resolveSelector(doc, button, selector)).toEqual({
				error: `Nothing around the mark's element matches ${selector}: a selector is looked for among its ancestors and inside it.`,
			});
		expect(resolveSelector(doc, button, "[[")).toEqual({
			error: "Not a valid CSS selector: [[",
		});
	});

	test("without one, on the whole page only when allowed, never in the head", () => {
		page(
			`<p class="a" style="display:none">hidden</p><p class="a">shown</p><script class="s"></script>`,
			`<meta name="csrf-token" content="s3cret">`,
		);
		expect(resolveSelector(doc, undefined, "p")).toEqual({
			error:
				"A selector for a mark without an element is looked for only on the case's page.",
		});
		const found = resolveSelector(doc, undefined, ".a", { pageWide: true });
		expect("element" in found && found.relation).toBe("page");
		for (const selector of ["meta[name=csrf-token]", "head", "title", ".s"])
			expect(
				resolveSelector(doc, undefined, selector, { pageWide: true }),
			).toEqual({
				error: `No element of this page's content matches ${selector}.`,
			});
	});

	test("selectors that are too broad or use :has() are refused", () => {
		page(`<p>x</p>`);
		for (const selector of ["*", "* > *", "*, *"])
			expect("error" in resolveSelector(doc, $("p"), selector)).toBe(true);
		for (const selector of ["div:has(p):has(span)", "html:has(p)"])
			expect(
				(resolveSelector(doc, $("p"), selector) as { error: string }).error,
			).toStartWith("The pseudo-class :has() is not allowed");
		expect("element" in resolveSelector(doc, $("p"), "*:not(div)")).toBe(true);
	});
});

/** The error of a refused selector, or `undefined` when it was looked for. */
function refusal(base: Element, selector: string): string | undefined {
	const found = resolveSelector(doc, base, selector);
	return "error" in found ? found.error : undefined;
}

describe("a selector cannot ask about form state", () => {
	const FORM = `<main class="Page"><form class="Form_root" data-testid="pay">
		<input name="iban" value="CH9300762011623852957">
		<input type="checkbox" name="terms" checked>
		<input name="zip" required placeholder="z.B. 8000">
		<select name="country"><option value="DE">Deutschland</option><option value="CH" selected>Schweiz</option></select>
		<textarea name="note">prefilled note</textarea>
		<div class="Editor" contenteditable="true"><p class="line">typed line</p></div>
		<button class="Button_primary" type="submit" aria-label="Pay">Pay</button>
	</form></main>`;

	test("state pseudo-classes are refused, also inside :is(), :where(), :not() and :nth-child(of)", () => {
		page(FORM);
		const button = $("button");
		const state = [
			":checked",
			"option:checked",
			"input:indeterminate",
			":default",
			"input:placeholder-shown",
			"input:autofill",
			"input:-webkit-autofill",
			":valid",
			":invalid",
			":user-valid",
			":user-invalid",
			":in-range",
			":out-of-range",
			":focus",
			":focus-within",
			":focus-visible",
			":hover",
			":active",
			":target",
			":visited",
			":link",
			"form:is(:checked, .x)",
			"form :where(:checked)",
			"form:not(:invalid)",
			"input:nth-child(1 of :checked)",
			"INPUT:CHECKED",
			"input:Placeholder-Shown",
		];
		for (const selector of state) {
			const error = refusal(button, selector);
			expect(error).toContain("is not allowed");
			expect(error).toContain("may not test what is typed or chosen");
		}
		expect(refusal(button, "p:empty")).toStartWith(
			"The pseudo-class :empty is not allowed",
		);
		expect(refusal(button, "p::before")).toContain("pseudo-element");
		expect(refusal(button, "form:has(input[name=iban])")).toStartWith(
			"The pseudo-class :has() is not allowed",
		);
		expect(refusal(button, ":is(form:has(:checked))")).toStartWith(
			"The pseudo-class :has() is not allowed",
		);
	});

	test("attribute selectors only on attributes that hold no field value, with any operator and flag", () => {
		page(FORM);
		const form = $("form");
		const refused = [
			"[value]",
			'[value="CH9300762011623852957"]',
			'input[name=iban][value^="CH9"]',
			"[value*=CH]",
			"[value$='957']",
			"[value~=CH]",
			"[value|=CH]",
			'[value^="ch9" i]',
			'[value^="CH9" s]',
			"[VALUE^=CH]",
			"[checked]",
			"[selected]",
			"option[selected]",
			"[aria-valuenow]",
			"[aria-valuetext^=a]",
			"[aria-checked=true]",
			"[data-replicated-value]",
			"[ng-reflect-model]",
			"[style*=width]",
			"[title]",
			"[href*=token]",
			"[src]",
		];
		for (const selector of refused) {
			const error = refusal(form, selector);
			expect(error).toStartWith("The attribute selector [");
			expect(error).toContain("is not allowed");
			// What the page holds is not in the answer.
			expect(error).not.toContain("9300762011623852957");
		}
		expect(selectorVocabularyProblem("[*|value]")).toContain("namespace");
	});

	test("tags, classes, ids, test ids, roles, structure and combinators are still looked for", () => {
		page(FORM);
		const input = $("input[name=zip]");
		const allowed: [Element, string][] = [
			[input, "form"],
			[input, ".Form_root"],
			[input, "main.Page > form"],
			[input, "[data-testid=pay]"],
			[input, '[class*="Form_"]'],
			[input, "[name=zip]"],
			[input, "input[required]"],
			[input, ":is(.Form_root, .Other)"],
			[input, "form:not(.Other)"],
			[input, "input:nth-child(3)"],
			[input, "input:nth-of-type(2n + 1)"],
			[input, "input:nth-child(odd of [name])"],
			[$("form"), "input + input"],
			[$("form"), "select ~ button"],
			[$("form"), '[type=submit][aria-label="Pay" i]'],
			[$("form"), "button:first-of-type:last-of-type"],
			[$("form"), "#nothing, button"],
			[$("form"), "[aria-label]"],
		];
		for (const [base, selector] of allowed)
			expect([selector, refusal(base, selector)]).toEqual([
				selector,
				undefined,
			]);
	});

	test("a selector never names what is inside a select, a text area or an editor", () => {
		page(FORM);
		const form = $("form");
		for (const selector of [
			"option",
			"select > option:nth-child(2)",
			".line",
			"[contenteditable] > p",
			"p",
		])
			expect(refusal(form, selector)).toStartWith(
				"Nothing around the mark's element matches",
			);
		// The field and the editor themselves may be read: their content is left out.
		const editor = resolveSelector(doc, form, ".Editor");
		expect("element" in editor && editor.element).toBe($(".Editor"));
		const select = resolveSelector(doc, form, "select");
		expect("element" in select && markupOf(select.element).html).not.toContain(
			"CH",
		);
		// From inside an editor, the ancestors in it are skipped, not a dead end.
		const up = resolveSelector(doc, $(".line"), "div, form");
		expect("element" in up && up.element).toBe($(".Editor"));
		const out = resolveSelector(doc, $(".line"), "form");
		expect("element" in out && out.element).toBe(form);
		// Page-wide, for a mark without an element, the same.
		expect(
			resolveSelector(doc, undefined, ".line", { pageWide: true }),
		).toEqual({ error: "No element of this page's content matches .line." });
	});

	test("an option keeps no value and is never selected in the markup", () => {
		page(FORM);
		const chosen = doc.querySelectorAll("option")[1] as Element;
		expect(attributeValue(chosen, "value", "CH")).toBeUndefined();
		expect(attributeValue(chosen, "selected", "")).toBeUndefined();
		expect(markupOf(chosen).html).toBe(`<option>${LEFT_OUT_INPUT}</option>`);
	});

	test("two pages that differ only in what was typed or chosen give the same answers", () => {
		const SELECTORS = [
			"input",
			"[name=iban]",
			"option",
			"p",
			".line",
			"div > *",
			"input:nth-child(1)",
			"form > *:last-child",
			".Editor",
			"[contenteditable]",
			"select",
			"label",
		];
		const answers = (html: string) => {
			page(html);
			const form = $("form");
			const read = SELECTORS.map((s) => {
				const r = resolveSelector(doc, form, s);
				return "error" in r
					? r.error
					: { relation: r.relation, inspection: inspectElement(r.element) };
			});
			// A mark drawn inside the editor, read without a selector.
			const inside = doc.querySelector(".Editor > .line");
			return { read, inside: inside && inspectElement(inside) };
		};
		const typed = answers(
			`<form><input name="iban" value="CH93"><input type="checkbox" name="news" checked><label>News</label><select><option>a</option><option selected>b</option></select><div class="Editor" contenteditable><h2>Diagnosis</h2><p class="line">x</p><p>y <span class="mention" id="user-jane-doe">@jane</span></p><ul><li>a</li></ul></div></form>`,
		);
		const empty = answers(
			`<form><input name="iban" value=""><input type="checkbox" name="news"><label>News</label><select><option>a</option><option>b</option></select><div class="Editor" contenteditable></div></form>`,
		);
		expect(typed.read).toEqual(empty.read);
		expect(typed.read.filter((a) => typeof a !== "string")).toHaveLength(8);
		// The editor's content stays out, children included, typed or not.
		const editor = typed.read[8] as { inspection: Inspection };
		expect(editor.inspection.html).toBe(
			`<div class="Editor" contenteditable>${LEFT_OUT_INPUT}</div>`,
		);
		expect(editor.inspection.children).toEqual([]);
		expect(editor.inspection.childrenLeftOut).toBeUndefined();
		expect(typed.inside?.children).toEqual([]);
		expect(typed.inside?.html).toBe(`<p class="line">${LEFT_OUT_INPUT}</p>`);
	});

	test("the page's own rules that depend on a state are never listed, nor counted", () => {
		const css = `<style>
			.check { padding: 1px }
			.check:checked { background-color: blue }
			.check:checked + label { color: red }
			.field:has(:checked) { border: 1px solid red }
			input:not(:placeholder-shown) { color: green }
			input:invalid, .other { border-color: red }
			[checked] { margin: 1px }
			option[selected] { color: red }
			.field label:hover { color: blue }
			label::before { content: "*" }
			.field > label { font-weight: bold }
		</style>`;
		const rulesOf = (checked: boolean) => {
			page(
				`<form><div class="field"><input class="check" type="checkbox" name="news"${checked ? " checked" : ""}><label for="x">News</label></div></form>`,
				css,
			);
			const form = $("form");
			return ["input[name=news]", "input[name=news] + label", ".field"].map(
				(s) => {
					const r = resolveSelector(doc, form, s);
					if ("error" in r) throw new Error(r.error);
					const m = matchedRules(r.element);
					return {
						selectors: m.rules.map((x) => x.selector),
						leftOut: m.leftOut,
					};
				},
			);
		};
		const ticked = rulesOf(true);
		expect(ticked).toEqual(rulesOf(false));
		expect(ticked.map((r) => r.selectors)).toEqual([
			[".check"],
			["label::before", ".field > label"],
			[],
		]);
	});

	test("a selector names nothing inside a hidden subtree", () => {
		page(
			`<main><div class="menu" style="display:none"><p class="secret">hidden <b>inside</b></p></div><p class="shown">shown</p></main>`,
		);
		const main = $("main");
		for (const selector of [".menu > p", ".secret", "b"])
			expect(refusal(main, selector)).toStartWith(
				"Nothing around the mark's element matches",
			);
		// The hidden element itself is still named, as before: its content is left out.
		const menu = resolveSelector(doc, main, ".menu");
		expect("element" in menu && markupOf(menu.element).html).not.toContain(
			"inside",
		);
		expect(
			resolveSelector(doc, undefined, ".secret", { pageWide: true }),
		).toEqual({ error: "No element of this page's content matches .secret." });
		// From inside it, past the hidden ancestors.
		const up = resolveSelector(doc, $("b"), "main");
		expect("element" in up && up.element).toBe(main);
	});

	test("substring operators only on id, class and test ids: the markup cuts the rest", () => {
		page(
			`<main><button aria-label="Copy invite link https://app.example/invite?token=s3cr3t" data-testid="copy-link">Copy</button><img alt="https://app.example/a.png?sig=abc"></main>`,
		);
		const main = $("main");
		for (const selector of [
			'[aria-label*="token=s3"]',
			'[aria-label^="Copy"]',
			'[alt$="abc"]',
			'[name^="x"]',
		])
			expect(refusal(main, selector)).toStartWith(
				"The operators ^=, $= and *= are not allowed on [",
			);
		for (const selector of [
			'[aria-label="Copy invite link https://app.example/invite?token=s3cr3t"]',
			'[data-testid^="copy"]',
			'[class*="x"], button',
			'[id$="y"], button',
			"[aria-label~=Copy]",
			"[aria-label]",
		])
			expect([selector, refusal(main, selector)]).toEqual([
				selector,
				undefined,
			]);
	});
});

describe("selector vocabulary (escapes, comments, case)", () => {
	test("escapes are read as CSS reads them", () => {
		for (const selector of [
			":\\63 hecked",
			":\\000063hecked",
			":\\43 HECKED",
			":c\\68 ecked",
			"input:\\70 laceholder-shown",
			":\\68 as(p)",
			":i\\73(:checked)",
			"[v\\61 lue]",
			"[\\76 alue^=C]",
			"[val\\ue]",
			"[\\56 ALUE]",
			"[d\\61ta-replicated-value]",
			// Spaces happy-dom does not parse, as Chrome does.
			"[ value ^= CH ]",
		])
			expect([selector, selectorVocabularyProblem(selector)]).toEqual([
				selector,
				expect.stringContaining("is not allowed"),
			]);
		// An escaped colon is part of a tag's name, not a pseudo-class.
		expect(selectorVocabularyProblem("a\\:checked")).toBeUndefined();
		expect(selectorVocabularyProblem(".\\31 23")).toBeUndefined();
		expect(selectorVocabularyProblem("[n\\61me=zip]")).toBeUndefined();
		// Markup, not state (happy-dom does not match them; Chrome does).
		for (const selector of [
			"input:required",
			"input:optional",
			"input:read-only",
			"div:read-write",
			"button:disabled",
			"[ name = zip i ]",
			"[role=button]",
			// What cssSelector writes for the stored details.
			'[data-testid="a\\"b"] > div:nth-of-type(2) > #x\\:y',
			'button[class*="Button_primary"]',
		])
			expect(selectorVocabularyProblem(selector)).toBeUndefined();
	});

	test("comments, namespaces, nesting and other syntax are refused", () => {
		for (const selector of [
			"input:/**/checked",
			"form/**/input",
			'[class="a"]/* x */',
			"svg|a",
			"*|input",
			"|input",
			"a || b",
			"& > p",
			":host",
			":host(.x)",
			":lang(de)",
			":dir(rtl)",
			":state(checked)",
			":-webkit-any(:checked)",
			"input::part(x)",
			":nth-child(\\6e)",
		])
			expect([selector, selectorVocabularyProblem(selector)]).toEqual([
				selector,
				expect.stringContaining("not allowed"),
			]);
		// A string is only a value: what it says is not read as a selector.
		expect(selectorVocabularyProblem('[class=":checked /* [value]"]')).toBe(
			undefined,
		);
	});
});
