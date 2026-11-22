/**
 * End to end: what a mark records of the page (DEC-047), on a copy of
 * Sitegloss's demo page (`pages/demo.html`): a link's fragment, the heading
 * of the card a mark is in, and the element a note, an arrow, a box and a
 * pen stroke are about, with an arrow's two ends.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Case, ElementDetails } from "../../src/lib/case.ts";
import { lookSummary } from "../../src/lib/element.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	startHarness,
} from "./harness.ts";
import {
	comment,
	type Db,
	markElement,
	marksIn,
	READ_DB,
	shadow,
	showToolbar,
} from "./steps.ts";

type Box = { x: number; y: number; width: number; height: number };

const boxOf = (page: Page, selector: string) =>
	page.eval<Box>(
		`(() => { const { x, y, width, height } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x, y, width, height }; })()`,
	);

/** Choose a drawing tool and wait until it is on. */
async function tool(page: Page, name: string): Promise<void> {
	const button = shadow(`[data-action="tool-${name}"]`);
	await page.click(button);
	await page.waitFor(`${button}.getAttribute("aria-pressed") === "true"`);
}

inFullSet("what a drawn mark records, on the demo page", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("a link's place on the page, the card's own title, and the element each kind of mark is about", async () => {
		const { page, tabId } = await h.open("demo");
		await page.send("Emulation.setDeviceMetricsOverride", {
			width: 1200,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await showToolbar(h, page, tabId);
		// 1. The city bike's Book link, with the Element tool.
		await markElement(page, "[data-testid=card-city-book]", "Book link");
		await page.eval(
			`document.querySelector("#bikes").scrollIntoView({ block: "start" })`,
		);
		await page.eval(
			"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		);
		// 2. A note on the e-bike's "New" badge, which comes before its title.
		await tool(page, "note");
		const badge = await boxOf(page, ".pp-card-new .pp-badge");
		await page.clickAt(badge.x + badge.width / 2, badge.y + badge.height / 2);
		await comment(page, "Badge");
		// 3. An arrow from that badge to the gravel bike's price, ending on
		// its bold amount.
		await tool(page, "arrow");
		// The cards in the middle of the window, and measured again: the
		// comment's field may have scrolled the page so that the badge is
		// at the top, under the bar Sitegloss shows there once the marks
		// are in the case (a press on it draws nothing; it failed so in CI).
		await page.eval(
			`document.querySelector(".pp-card-new").scrollIntoView({ block: "center" })`,
		);
		await page.eval(
			"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		);
		const from = await boxOf(page, ".pp-card-new .pp-badge");
		const amount = await boxOf(page, "[data-testid=card-gravel-price] strong");
		// From the badge's left end, not its middle: the note's pin is
		// there, and a press on a mark's pin opens that mark instead of
		// drawing (DEC-027), once the note is in the case.
		const left = from.x + 3;
		expect(from.x + from.width / 2 - left).toBeGreaterThan(14);
		await page.drag(
			{ x: left, y: from.y + from.height / 2 },
			{ x: amount.x + amount.width / 2, y: amount.y + amount.height / 2 },
		);
		await comment(page, "Arrow");
		// 4. A box round the gravel bike's picture.
		await tool(page, "box");
		const bike = await boxOf(page, "[data-testid=card-gravel] svg");
		await page.drag(
			{ x: bike.x - 6, y: bike.y - 6 },
			{ x: bike.x + bike.width + 6, y: bike.y + bike.height + 6 },
		);
		await comment(page, "Box");
		// 5. The city bike's price underlined.
		await tool(page, "pen");
		const price = await boxOf(page, "[data-testid=card-city-price]");
		const words = await page.eval<Box>(
			`(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector("[data-testid=card-city-price]")); const { x, y, width, height } = r.getBoundingClientRect(); return { x, y, width, height }; })()`,
		);
		// Not from the price's first letter: the Book link's mark (1) has its
		// pin at the link's corner just below, and a press on a pin opens
		// that mark, once it is in the case (DEC-027).
		await page.drag(
			{ x: words.x + 24, y: price.y + price.height + 2 },
			{ x: words.x + words.width, y: price.y + price.height + 4 },
		);
		await comment(page, "Underline");

		const caseId = await marksIn(page);
		const db = await h.control.eval<Db>(READ_DB);
		const c = db.cases.find((x) => x.id === caseId) as unknown as Case;
		const mark = (n: number) =>
			c.marks.find((a) => a.number === n) as Case["marks"][number];
		const el = (n: number) => mark(n).element as ElementDetails;
		const path = new URL(await page.eval<string>("location.href")).pathname;

		// The link keeps where on the page it goes; its title is the card's.
		expect(el(1).attributes["href"]).toBe(`${path}#book`);
		expect(el(1).heading).toBe("City bike");
		// The badge is a thing of its own, under the card it is in.
		expect(el(2).classes).toContain("pp-badge");
		expect(el(2).heading).toBe("E-bike");
		// The arrow is about the price it points at (not the bold word in
		// it), and says where it starts.
		expect(mark(3).shape.kind).toBe("arrow");
		expect(el(3).testId).toBe("card-gravel-price");
		expect(el(3).heading).toBe("Gravel bike");
		expect(mark(3).ends?.end?.testId).toBe("card-gravel-price");
		expect(mark(3).ends?.start?.classes).toContain("pp-badge");
		// The box is about the picture, not a wheel of it.
		expect(el(4).tag).toBe("svg");
		expect(el(4).heading).toBe("Gravel bike");
		// The underline is about the text over it, and has no ends.
		expect(el(5).testId).toBe("card-city-price");
		expect(mark(5).ends).toBeUndefined();
		// A note has no ends either.
		expect(mark(2).ends).toBeUndefined();

		// How the low-contrast Book link looked when it was marked (DEC-048):
		// its text colour, the colour behind it (its own amber background),
		// its type and box, and the boxes of the card's parts before it.
		const look = el(1);
		expect(look.styles?.["color"]).toBe("rgb(245, 207, 88)");
		expect(look.styles?.["background-color"]).toBe("rgb(242, 194, 48)");
		expect(look.backdrop).toEqual({ color: "rgb(242, 194, 48)", depth: 0 });
		expect(look.styles?.["font-weight"]).toBe("700");
		// An item of the card's flex column: the browser computes block.
		expect(look.styles?.["display"]).toBe("block");
		expect(look.styles?.["padding"]).toMatch(/px/);
		expect(look.styles?.["border-radius"]).toBe("8px");
		expect(Object.keys(look.styles ?? {}).length).toBeLessThanOrEqual(40);
		// Nothing that names a URL, no custom property: the cursor is not a style it records.
		expect(look.styles?.["cursor"]).toBeUndefined();
		expect(JSON.stringify(look.styles)).not.toContain("url(");
		expect(Object.keys(look.styles ?? {}).some((k) => k.startsWith("--"))).toBe(
			false,
		);
		expect(look.siblings?.map((s) => [s.offset, s.tag])).toEqual([
			[-3, "h3"],
			[-2, "p"],
			[-1, "p"],
		]);
		// The badge has a green background of its own; the price has none
		// and sits on the white card one step up.
		expect(el(2).backdrop?.color).toBe("rgb(47, 107, 79)");
		expect(el(3).backdrop).toEqual({ color: "rgb(255, 255, 255)", depth: 1 });
		// The look line: amber on amber, with the ratio, as an opaque
		// background was found (the link's own).
		expect(lookSummary(look)).toStartWith(
			"rgb(245, 207, 88) on rgb(242, 194, 48), contrast 1.11:1",
		);
		// A stroke's ends record no look; only the mark's own element does.
		expect(mark(3).ends?.start?.styles).toBeUndefined();
		expect(mark(3).ends?.end?.styles).toBeUndefined();
		expect(mark(3).ends?.start?.backdrop).toBeUndefined();
		await page.send("Page.close");
	}, 120_000);
});
