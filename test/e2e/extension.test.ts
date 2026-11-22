/**
 * End to end: the unpacked extension in Chromium. Skipped without Chrome for
 * Testing or Chromium locally, required in CI (see harness.ts).
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import { RESOLVED_OPACITY } from "../../src/content/overlay.ts";
import { webpSize } from "../../src/lib/export.ts";
import { sampleCase } from "../fixtures.ts";
import { answerInPanel, connectAi, mcpClient, openSidePanel } from "./ai.ts";
import type { Page } from "./browser.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";
import {
	comment,
	countColour,
	type Db,
	HOST,
	imageBytes,
	imagesOf,
	markElement,
	marksIn,
	nameCase,
	PUT_CASE,
	READ_DB,
	resetPanel,
	saveAs,
	shadow,
	showToolbar,
	until,
} from "./steps.ts";

describe.skipIf(browserBinary === undefined)("extension", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("has the fixed extension ID", () => {
		expect(h.extensionId).toBe("ldmcfigcnobhnbaigehcaodheklibeon");
	});

	test("the content script shows and hides the overlay, once per page", async () => {
		const { page, tabId } = await h.open("v1");
		const inject = `chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ["content.js"] })`;
		// What extension pages hear when the overlay changes by itself.
		await h.control.eval(
			`globalThis.changes = []; chrome.runtime.onMessage.addListener((m) => { if (m.type === "overlay:changed") globalThis.changes.push(m.state.visible); })`,
		);
		await h.control.eval(inject);
		await h.control.eval(inject);
		// A stored case: the control page, a panel too, ends a toolbar whose
		// case is gone (DEC-026).
		await h.control.eval(PUT_CASE(sampleCase("c_shown")));
		const state = await h.control.eval<{ visible: boolean; title: string }>(
			`chrome.tabs.sendMessage(${tabId}, { type: "overlay:show", target: { caseId: "c_shown", title: "Shown", nextMark: 1 } })`,
		);
		expect(state.visible).toBe(true);
		expect(state.title).toBe("Krankenkasse vergleichen (v1)");
		expect(
			await page.eval<number>(
				`document.querySelectorAll("#sitegloss-root").length`,
			),
		).toBe(1);
		await page.click(
			`${HOST}.shadowRoot.querySelector('[data-action="close"]')`,
		);
		await h.control.waitFor("globalThis.changes?.includes(false)");
		const after = await h.control.eval<{ visible: boolean }>(
			`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" })`,
		);
		expect(after.visible).toBe(false);
		await page.send("Page.close");
	});

	test("replaces an overlay that an orphaned instance left behind", async () => {
		// After an extension reload or update the old content script can no
		// longer be reached, but its overlay stays in the page.
		const { page, tabId } = await h.open("v1");
		await page.eval(
			`(() => { const old = document.createElement("div"); old.id = "sitegloss-root"; old.dataset.orphan = "true"; document.documentElement.append(old); })()`,
		);
		await h.control.eval(PUT_CASE(sampleCase("c_shown")));
		const state = await h.control.eval<{ visible: boolean }>(
			`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ["content.js"] }).then(() => chrome.tabs.sendMessage(${tabId}, { type: "overlay:show", target: { caseId: "c_shown", title: "Shown", nextMark: 1 } }))`,
		);
		expect(state.visible).toBe(true);
		expect(
			await page.eval<string[]>(
				`[...document.querySelectorAll("#sitegloss-root")].map((e) => e.dataset.orphan ?? "live")`,
			),
		).toEqual(["live"]);
		await page.send("Page.close");
	});
});

describe.skipIf(browserBinary === undefined)("marking and saving", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	// The control page is a side panel too: a toolbar a test showed for a
	// case opened that case there (DEC-023), and its marks would follow.
	beforeEach(() => resetPanel(h));

	test("marks drawn with the toolbar are saved as a case with screenshots", async () => {
		const { page, tabId } = await h.open("v1");
		// As "New case for this page": the case first, the toolbar adding to it.
		await showToolbar(h, page, tabId);

		// 1: a box around the submit button
		await page.click(shadow('[data-action="tool-box"]'));
		const button = await page.eval<{
			x: number;
			y: number;
			width: number;
			height: number;
		}>(
			`(() => { const r = document.querySelector("[data-truth=submit]").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
		);
		await page.drag(
			{ x: button.x - 6, y: button.y - 6 },
			{ x: button.x + button.width + 6, y: button.y + button.height + 6 },
		);
		await page.waitFor(shadow(".popover textarea"));
		await page.type("Contrast too low");
		await page.click(shadow('[data-action="comment-done"]'));

		// 2: a note on the tip
		await page.click(shadow('[data-action="tool-note"]'));
		await page.click(`document.querySelector("[data-truth=tip]")`);
		await page.waitFor(shadow(".popover textarea"));
		await page.type("Say how much exactly");
		await page.click(shadow('[data-action="comment-done"]'));

		// 3: far below, the contact paragraph picked as an element. A person takes
		// longer to get there: the screenshot of the two marks above is done.
		await Bun.sleep(1000);
		await page.eval(
			`window.scrollTo(0, document.querySelector("[data-truth=contact]").getBoundingClientRect().top + scrollY - 200)`,
		);
		await page.click(shadow('[data-action="tool-element"]'));
		const contact = await page.centreOf(
			`document.querySelector("[data-truth=contact]")`,
		);
		await page.mouse("mouseMoved", contact.x, contact.y);
		await page.clickAt(contact.x, contact.y);
		await page.waitFor(shadow(".popover textarea"));
		await page.type("Add a phone number");
		await page.click(shadow('[data-action="comment-done"]'));

		// Each in the case as its comment is done (DEC-014, DEC-026), and the
		// toolbar's own and the loaded case's draw them.
		await page.waitFor(
			`${shadow('[data-role="status"]')}?.textContent === "Mark 3 added to “Krankenkasse vergleichen (v1)”"`,
			20_000,
		);
		expect(
			await page.eval<string[]>(
				`[...new Set([...${shadow("svg.marks")}.querySelectorAll("g[data-number], [data-review]")].map((g) => g.dataset.number ?? g.dataset.review))].sort()`,
			),
		).toEqual(["1", "2", "3"]);

		// The title, as a person types it in the panel's Rename.
		await saveAs(page, "Prämienrechner");

		const db = await h.control.eval<Db>(READ_DB);
		expect(db.cases).toHaveLength(1);
		const saved = db.cases[0];
		expect(saved?.title).toBe("Prämienrechner");
		// One screenshot per mark added (DEC-014): marks 1 and 2 shared the
		// page's picture, each has its own copy with its pin.
		expect(saved?.shots).toHaveLength(3);
		const [a1, a2, a3] = saved?.marks ?? [];
		expect(a1?.shape.kind).toBe("box");
		expect(a1?.comment).toBe("Contrast too low");
		expect(a1?.element?.tag).toBe("button");
		expect(a1?.element?.name).toBe("Prämien berechnen");
		expect(a2?.shape.kind).toBe("note");
		expect(a2?.element?.text).toContain("höheren Franchise");
		expect(a3?.shape.kind).toBe("element");
		expect(a3?.element?.text).toBe("Unser Team hilft Ihnen gerne weiter.");
		expect(a3?.shot).not.toBe(a1?.shot);
		// The case's own (the page's picture waits for the next mark meanwhile).
		const keys = db.images
			.filter((i) => i.key.startsWith(`${saved?.id}/`))
			.map((i) => i.key.split("/").slice(1).join("/"))
			.sort();
		expect(keys).toEqual([
			"crops/a1.webp",
			"crops/a2.webp",
			"crops/a3.webp",
			"shots/s1.webp",
			"shots/s2.webp",
			"shots/s3.webp",
		]);
		for (const image of db.images) {
			expect(image.type).toBe("image/webp");
			expect(image.size).toBeGreaterThan(500);
		}

		// Chrome's own WebP passes the header check imports use.
		const shot = await imageBytes(h.control, "Prämienrechner", "shots/s1.webp");
		expect(webpSize(Buffer.from(shot.base64, "base64"))).toEqual({
			width: shot.width,
			height: shot.height,
		});

		// The side panel lists it.
		await h.control.waitFor(`document.querySelector("[data-case]")`);
		expect(
			await h.control.eval<string>(
				`document.querySelector("[data-case] .title").textContent`,
			),
		).toBe("Prämienrechner");
		await page.send("Page.close");
	}, 60_000);

	/**
	 * "← All cases" where the panel shows a case: it opens the case a toolbar
	 * adds to (DEC-023), and an open case's marks follow to the tab in front.
	 */
	async function toAllCases(saved?: string): Promise<void> {
		// Opened a moment after the save.
		if (saved !== undefined)
			await h.control.waitFor(
				`document.querySelector("#case-view h2")?.textContent === ${JSON.stringify(saved)}`,
				10_000,
			);
		await h.control.eval(
			`document.getElementById("back").hidden || document.getElementById("back").click()`,
		);
		await h.control.waitFor(`!document.getElementById("home").hidden`);
	}

	test("the toolbar stays on one line in a normal window", async () => {
		const { page, tabId } = await h.open("v1");
		await page.send("Emulation.setDeviceMetricsOverride", {
			width: 1000,
			height: 700,
			deviceScaleFactor: 1,
			mobile: false,
		});
		// A page's own styles do not reach it, not even on the host element.
		await page.eval(`(() => {
			document.documentElement.dir = "rtl";
			document.head.insertAdjacentHTML("beforeend", "<style>div { text-transform: uppercase; letter-spacing: 0.3em; }</style>");
		})()`);
		await showToolbar(h, page, tabId);
		const height = await page.eval<number>(
			`${shadow(".toolbar")}.getBoundingClientRect().height`,
		);
		expect(height).toBeLessThan(60);
		const style = await page.eval<string[]>(
			`(() => { const s = getComputedStyle(${shadow('[data-action="tool-box"]')}); return [s.textTransform, s.letterSpacing, s.direction]; })()`,
		);
		expect(style).toEqual(["none", "normal", "ltr"]);
		await page.send("Page.close");
	});

	test("opening a case from the list puts drawn marks back on their elements", async () => {
		const box = (page: Page, truth: string) =>
			page.eval<{ x: number; y: number; width: number; height: number }>(
				`(() => { const { x, y, width, height } = document.querySelector("[data-truth=${truth}]").getBoundingClientRect(); return { x, y, width, height }; })()`,
			);
		const v1 = await h.open("v1");
		await showToolbar(h, v1.page, v1.tabId);
		await v1.page.click(shadow('[data-action="tool-box"]'));
		const tip = await box(v1.page, "tip");
		await v1.page.drag(
			{ x: tip.x + 60, y: tip.y + 2 },
			{ x: tip.x + 300, y: tip.y + tip.height - 2 },
		);
		await comment(v1.page, "Shorter");
		await v1.page.click(shadow('[data-action="tool-pen"]'));
		await v1.page.drag(
			{ x: tip.x + 400, y: tip.y + 4 },
			{ x: tip.x + 500, y: tip.y + 14 },
		);
		await comment(v1.page, "Scribble");
		await v1.page.click(shadow('[data-action="tool-arrow"]'));
		await v1.page.drag(
			{ x: tip.x + 620, y: tip.y + 2 },
			{ x: tip.x + 560, y: tip.y + 16 },
		);
		await comment(v1.page, "Here");
		await saveAs(v1.page, "Drawn marks");
		// "← All cases" ends the toolbar too, as its Done would.
		await toAllCases("Drawn marks");

		const v2 = await h.open("v2");
		await v2.page.eval(
			`document.querySelector("[data-truth=tip]").style.cssText = "margin: 150px 0 0 80px; width: 400px"`,
		);
		await v2.page.activate();
		await h.control.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
		// Another page than the case's: opening the case draws its marks all the same.
		const row = `[...document.querySelectorAll("[data-case]")].find((e) => e.textContent.includes("Drawn marks"))`;
		await h.control.waitFor(row);
		await h.control.eval(`${row}.click()`);
		await h.control.waitFor(
			`document.querySelectorAll(".match").length === 3`,
			10_000,
		);

		// The paragraph is somewhere else and narrower: the box went with it.
		const moved = await box(v2.page, "tip");
		expect(moved.y - tip.y).toBeGreaterThan(100);
		expect(moved.width).toBeLessThan(tip.width);
		const drawn = await v2.page.eval<{ x: number; y: number; width: number }>(
			`(() => { const r = ${shadow('[data-review="1"]')}.querySelector("rect"); return { x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), width: Number(r.getAttribute("width")) }; })()`,
		);
		const scale = moved.width / tip.width;
		expect(drawn.x).toBeCloseTo(moved.x + 60 * scale, 0);
		expect(drawn.width).toBeCloseTo(240 * scale, 0);
		expect(Math.abs(drawn.y - moved.y)).toBeLessThan(6);
		const points = await v2.page.eval<number>(
			`${shadow('[data-review="2"]')}.querySelector("polyline").points.length`,
		);
		expect(points).toBeGreaterThan(2);
		// All of a mark says how sure the match is, an arrow's head too.
		const arrow = await v2.page.eval<(string | null)[]>(
			`(() => { const g = ${shadow('[data-review="3"]')}; return [g.querySelector("line:not([data-casing])").getAttribute("stroke"), g.querySelector("polygon:not([data-casing])").getAttribute("fill")]; })()`,
		);
		expect(arrow[1]).toBe(arrow[0]);
		await v1.page.send("Page.close");
		await v2.page.send("Page.close");
		await h.control.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
	});

	describe("the case's page", () => {
		const panel = () =>
			h.control.goto(
				`chrome-extension://${h.extensionId}/sidepanel/index.html`,
			);
		const openTheCase = async (title: string) => {
			const row = `[...document.querySelectorAll("[data-case]")].find((e) => e.textContent.includes(${JSON.stringify(title)}))`;
			await h.control.waitFor(row);
			await h.control.eval(`${row}.click()`);
			await h.control.waitFor(`document.getElementById("open-page")`);
		};
		const v1Tabs = () =>
			h.control.eval<{ id: number; active: boolean }[]>(
				`chrome.tabs.query({ url: ${JSON.stringify(`${h.base}/v1`)} }).then((tabs) => tabs.map(({ id, active }) => ({ id, active })))`,
			);

		test("its address opens it in a new tab with the case loaded", async () => {
			const v1 = await h.open("v1");
			await showToolbar(h, v1.page, v1.tabId);
			await markElement(v1.page, "[data-truth=tip]", "Say how much");
			await saveAs(v1.page, "Opened from its case");
			await toAllCases("Opened from its case");
			await v1.page.send("Page.close");
			await panel();
			await openTheCase("Opened from its case");
			expect(
				await h.control.eval<string>(
					`document.getElementById("open-page").textContent`,
				),
			).toBe(`${new URL(h.base).host}/v1`);
			await h.control.eval(`document.getElementById("open-page").click()`);
			await h.control.waitFor(
				`document.querySelector(".match")?.dataset.status === "found"`,
				15_000,
			);
			const tabs = await v1Tabs();
			expect(tabs).toHaveLength(1);
			expect(tabs[0]?.active).toBe(true);
			await h.control.eval(`chrome.tabs.remove(${tabs[0]?.id})`);
			await panel();
		});

		test("opening a case on its own page loads it, no Load needed", async () => {
			const v1 = await h.open("v1");
			await showToolbar(h, v1.page, v1.tabId);
			await markElement(v1.page, "[data-truth=tip]", "Loaded on opening");
			await saveAs(v1.page, "Opened on its page");
			// "← All cases" ends the toolbar too, as its Done would.
			await toAllCases("Opened on its page");
			await v1.page.activate();
			await panel();
			const row = `[...document.querySelectorAll("[data-group=here] [data-case]")].find((e) => e.textContent.includes("Opened on its page"))`;
			await h.control.waitFor(row);
			expect(
				await h.control.eval<boolean>(
					`${row}.parentElement.querySelector("[data-load]") === null`,
				),
			).toBe(true);
			await h.control.eval(`${row}.click()`);
			await h.control.waitFor(
				`document.querySelector(".match")?.dataset.status === "found"`,
				10_000,
			);
			expect(
				await v1.page.eval<number>(
					`${shadow("svg.marks")}.querySelectorAll("[data-review]").length`,
				),
			).toBe(1);
			// Loaded: the button hides the marks again, and then loads.
			const button = `document.getElementById("load-case")`;
			expect(await h.control.eval<string>(`${button}.textContent`)).toBe(
				"Hide marks",
			);
			await h.control.eval(`${button}.click()`);
			await v1.page.waitFor(
				`${shadow("svg.marks")}.querySelectorAll("[data-review]").length === 0`,
			);
			await h.control.waitFor(
				`${button}.textContent === "Show marks" && !document.querySelector(".match")`,
			);
			await v1.page.send("Page.close");
			await panel();
		});

		test("Hide holds while a page just opened is searched again", async () => {
			const v1 = await h.open("v1");
			await showToolbar(h, v1.page, v1.tabId);
			await markElement(v1.page, "[data-truth=tip]", "Here");
			// Drawn by a script on this visit only: the next one lacks it.
			await v1.page.eval(
				`document.body.insertAdjacentHTML("beforeend", '<p id="late">Late</p>')`,
			);
			await markElement(v1.page, "#late", "Not there next time");
			await saveAs(v1.page, "Hidden while searched");
			await toAllCases("Hidden while searched");
			await v1.page.send("Page.close");
			await panel();
			await openTheCase("Hidden while searched");
			const tabTargets = async () =>
				(await h.browser.targets()).filter((t) => t.type === "page");
			const before = new Set((await tabTargets()).map((t) => t.targetId));
			await h.control.eval(`document.getElementById("open-page").click()`);
			await h.control.waitFor(
				`document.getElementById("case-hint").textContent.includes("1 of 2 marks found")`,
				15_000,
			);
			const opened = (await tabTargets()).find((t) => !before.has(t.targetId));
			const page = await h.browser.attachPage(opened?.targetId as string);
			const button = `document.getElementById("load-case")`;
			expect(await h.control.eval<string>(`${button}.textContent`)).toBe(
				"Hide marks",
			);
			await h.control.eval(`${button}.click()`);
			// The searches again at 1 s and 2 s would have drawn the marks back.
			await Bun.sleep(3500);
			expect(
				await page.eval<number>(
					`${shadow("svg.marks")}.querySelectorAll("[data-review]").length`,
				),
			).toBe(0);
			expect(await h.control.eval<string>(`${button}.textContent`)).toBe(
				"Show marks",
			);

			// A clear for another case leaves this one's marks.
			const db = await h.control.eval<Db>(READ_DB);
			const saved = db.cases.find((c) => c.title === "Hidden while searched");
			const tabId = await h.control.eval<number>(
				`chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id)`,
			);
			const send = (message: object) =>
				h.control.eval<{ loadedCase?: string }>(
					`chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(message)})`,
				);
			await send({ type: "case:load", case: saved });
			expect(
				(await send({ type: "case:clear", caseId: "c_other" })).loadedCase,
			).toBe(saved?.id);
			expect(
				(await send({ type: "case:clear", caseId: saved?.id })).loadedCase,
			).toBeUndefined();
			await h.control.eval(`chrome.tabs.remove(${tabId})`);
			await panel();
		});

		test("Match size gives the tab the size the marks were made at", async () => {
			const v1 = await h.open("v1");
			await showToolbar(h, v1.page, v1.tabId);
			await markElement(v1.page, "[data-truth=tip]", "Sized");
			await saveAs(v1.page, "Made at one size");
			await toAllCases("Made at one size");
			const made = await v1.page.eval<{ width: number; height: number }>(
				"({ width: innerWidth, height: innerHeight })",
			);
			const win = await h.control.eval<number>(
				`chrome.tabs.get(${v1.tabId}).then((t) => t.windowId)`,
			);
			await h.control.eval(
				`chrome.windows.update(${win}, { width: ${made.width - 200}, height: ${made.height - 100} })`,
			);
			await v1.page.activate();
			await panel();
			await openTheCase("Made at one size");
			await h.control.waitFor(`!document.getElementById("case-size").hidden`);
			await h.control.eval(`document.getElementById("match-size").click()`);
			await h.control.waitFor(
				`document.getElementById("case-hint").textContent.includes("as when the marks were made")`,
				10_000,
			);
			const now = await v1.page.eval<{ width: number; height: number }>(
				"({ width: innerWidth, height: innerHeight })",
			);
			expect(Math.abs(now.width - made.width)).toBeLessThanOrEqual(2);
			expect(Math.abs(now.height - made.height)).toBeLessThanOrEqual(2);
			await h.control.waitFor(`document.getElementById("case-size").hidden`);
			await v1.page.send("Page.close");
			await panel();
		});
	});

	test("a mark resolved, edited and deleted in the panel; the page follows", async () => {
		const v1 = await h.open("v1");
		await showToolbar(h, v1.page, v1.tabId);
		await markElement(v1.page, "[data-truth=tip]", "One");
		await markElement(v1.page, "[data-truth=submit]", "Two");
		await markElement(v1.page, "[data-truth=contact]", "Three");
		await saveAs(v1.page, "Settled marks");
		// "← All cases" ends the toolbar too, as its Done would.
		await toAllCases("Settled marks");
		await v1.page.activate();
		await h.control.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
		const caseRow = `[...document.querySelectorAll("[data-group=here] [data-case]")].find((e) => e.textContent.includes("Settled marks"))`;
		await h.control.waitFor(caseRow);
		await h.control.eval(`${caseRow}.click()`);
		await h.control.waitFor(
			`document.querySelectorAll(".match").length === 3`,
			10_000,
		);
		const row = (id: string) => `document.querySelector('[data-mark="${id}"]')`;
		const act = (id: string, name: string) =>
			`${row(id)}.querySelector('[data-mark-action="${name}"]')`;
		const review = (n: number) =>
			`${shadow("svg.marks")}.querySelector('[data-review="${n}"]')`;
		const bar = `${shadow('[data-role="review-status"] .count')}.textContent`;

		// Resolve 2 as won't fix, with a note.
		await h.control.eval(`${act("a2", "resolve")}.click()`);
		await h.control.waitFor(
			`${row("a2")}.querySelector("[data-form=resolve]")`,
		);
		await h.control.eval(`(() => {
			const form = ${row("a2")}.querySelector("[data-form=resolve]");
			form.querySelector('input[value="wontfix"]').click();
			const note = form.querySelector("input.note");
			note.value = "Legal wants it";
			note.dispatchEvent(new Event("input"));
			form.querySelector('[data-mark-action="resolve-done"]').click();
		})()`);
		await h.control.waitFor(`${row("a2")}?.dataset.resolved === "wontfix"`);
		expect(
			await h.control.eval<string>(
				`${row("a2")}.querySelector(".history").textContent`,
			),
		).toMatch(/^Won't fix .+ · Legal wants it$/);
		await v1.page.waitFor(`${review(2)}?.hasAttribute("data-resolved")`);
		// Its outline fades; its pin stays solid, to be found.
		expect(
			await v1.page.eval<string[]>(`(() => {
				const mark = ${review(2)};
				return [
					mark.getAttribute("opacity"),
					mark.querySelector("[data-faded]")?.getAttribute("opacity"),
					mark.querySelector("[data-faded] [data-number]") === null,
				].map(String);
			})()`),
		).toEqual(["null", String(RESOLVED_OPACITY), "true"]);
		// Shown from the panel, it is looked for: it shows fully.
		await h.control.eval(
			`document.querySelector('[data-mark="a2"] [data-action=show]').click()`,
		);
		await v1.page.waitFor(
			`${review(2)}?.hasAttribute("data-resolved") && ${review(2)}.querySelector("[data-faded]") === null`,
		);
		// Closed marks are drawn, faded, but not counted.
		expect(await v1.page.eval<string>(bar)).toBe("2 of 2 found");
		// The panel's results stay: the page kept its matches.
		expect(
			await h.control.eval<number>(
				`document.querySelectorAll(".match").length`,
			),
		).toBe(3);

		// Edit 1's comment.
		await h.control.eval(`${act("a1", "comment")}.click()`);
		await h.control.waitFor(
			`${row("a1")}.querySelector("[data-form=comment] textarea")`,
		);
		await h.control.eval(`(() => {
			const field = ${row("a1")}.querySelector("[data-form=comment] textarea");
			field.value = "One, shorter";
			field.dispatchEvent(new Event("input"));
			${row("a1")}.querySelector('[data-mark-action="comment-done"]').click();
		})()`);
		await h.control.waitFor(
			`${row("a1")}.querySelector(".comment").textContent === "One, shorter"`,
		);

		// Delete 3: twice, the second a moment later.
		await h.control.eval(`${act("a3", "delete")}.click()`);
		await h.control.waitFor(
			`${act("a3", "delete")}.textContent === "Really delete?"`,
		);
		await Bun.sleep(600);
		// A double click: one delete, and no error about a mark already gone.
		await h.control.eval(
			`(() => { const b = ${act("a3", "delete")}; b.click(); b.click(); })()`,
		);
		await h.control.waitFor(`${row("a3")} === null`);
		await Bun.sleep(300);
		expect(
			await h.control.eval<string>(
				`document.getElementById("case-hint").textContent`,
			),
		).not.toContain("Not saved");
		await v1.page.waitFor(`${review(3)} === null`);
		expect(await v1.page.eval<string>(bar)).toBe("1 of 1 found");
		const db = await h.control.eval<Db>(READ_DB);
		const saved = db.cases.find((c) => c.title === "Settled marks");
		expect(saved?.marks.map((a) => a.id)).toEqual(["a1", "a2"]);
		expect(saved?.lastNumber).toBe(3);
		expect(saved?.marks[0]?.comment).toBe("One, shorter");
		expect(imagesOf(db, saved?.id ?? "")).not.toContain("crops/a3.webp");

		// Open again, saying why.
		await h.control.eval(`${act("a2", "reopen")}.click()`);
		await h.control.waitFor(
			`${row("a2")}.querySelector("[data-form=reopen] textarea")`,
		);
		await h.control.eval(`(() => {
			const field = ${row("a2")}.querySelector("[data-form=reopen] textarea");
			field.value = "Legal changed its mind";
			field.dispatchEvent(new Event("input"));
			${row("a2")}.querySelector('[data-mark-action="reopen-done"]').click();
		})()`);
		await v1.page.waitFor(`!${review(2)}?.hasAttribute("data-resolved")`);
		expect(await v1.page.eval<string>(bar)).toBe("2 of 2 found");
		await v1.page.send("Page.close");
		await h.control.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
	});

	describe("marking again after a save (DEC-023)", () => {
		const newCaseButton = `document.getElementById("new-case")`;
		const back = `document.getElementById("back")`;
		const status = `${shadow('[data-role="status"]')}?.textContent`;
		/** The marks of the case on the page: the toolbar's own, and the loaded case's. */
		const caseMarks = (page: Page) =>
			page.eval<string[]>(
				`[...new Set([...${shadow("svg.marks")}.querySelectorAll(".saved g[data-number], [data-review]")].map((g) => g.dataset.number ?? g.dataset.review))].sort((a, b) => a - b)`,
			);
		const caseMarksAre = async (page: Page, want: string[]) =>
			expect(
				await until(
					() => caseMarks(page),
					(now) => JSON.stringify(now) === JSON.stringify(want),
				).catch(() => caseMarks(page)),
			).toEqual(want);
		const toolbarUp = (tabId: number) =>
			h.control.eval<boolean>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.visible)`,
			);
		/** The panel shows the case `title`, as it opens the case a toolbar adds to. */
		const inCase = (title: string) =>
			h.control.waitFor(
				`!document.getElementById("case-view").hidden && document.querySelector("#case-view h2")?.textContent === ${JSON.stringify(title)}`,
				10_000,
			);
		/** "← All cases", and the panel is home. */
		async function allCases(): Promise<void> {
			await h.control.eval(`${back}.click()`);
			await h.control.waitFor(`!document.getElementById("home").hidden`);
		}
		const titled = (db: Db, title: string) =>
			db.cases.filter((c) => c.title === title);

		test("the case opens, the marks go into it; All cases closes it, the next marks are a new case", async () => {
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "[data-truth=submit]", "Too pale");
			await saveAs(page, "Going on");
			// The case is open in the panel, the toolbar adding to it (DEC-026).
			await inCase("Going on");
			await h.control.waitFor(
				`document.getElementById("add-marks").textContent === "Done adding"`,
			);
			// What was saved stays on the page, and the toolbar is still up.
			await caseMarksAre(page, ["1"]);
			expect(await toolbarUp(tabId)).toBe(true);

			// Into the case at once, no save step.
			await markElement(page, "[data-truth=tip]", "Say how much");
			await page.waitFor(`${status} === "Mark 2 added to “Going on”"`, 20_000);
			await caseMarksAre(page, ["1", "2"]);
			// A screenshot shows the page alone: mark 2's has no faint mark 1. Its
			// own edges have a few pixels of that colour, a faint mark over 1000.
			expect(
				await countColour(
					h.control,
					"Going on",
					"shots/s2.webp",
					[0xf2, 0x8c, 0xaf],
				),
			).toBeLessThan(200);
			const going = titled(await h.control.eval<Db>(READ_DB), "Going on");
			expect(going).toHaveLength(1);
			expect(going[0]?.marks.map((a) => a.number)).toEqual([1, 2]);

			// All cases: no toolbar, no marks, and nothing to continue.
			await allCases();
			await until(
				() => toolbarUp(tabId),
				(up) => !up,
			);
			await caseMarksAre(page, []);
			await h.control.waitFor(
				`${newCaseButton}.textContent === "New case for this page"`,
			);
			await h.control.eval(`${newCaseButton}.click()`);
			await page.waitFor(
				`${status} === "Adding to “Krankenkasse vergleichen (v1)”"`,
			);
			await markElement(page, "h1", "Larger heading");
			await saveAs(page, "Another one");
			const db = await h.control.eval<Db>(READ_DB);
			expect(titled(db, "Going on")[0]?.marks).toHaveLength(2);
			expect(titled(db, "Another one")[0]?.marks.map((a) => a.number)).toEqual([
				1,
			]);
			await inCase("Another one");
			await allCases();
			await page.send("Page.close");
		}, 60_000);

		test("All cases with a comment open puts that mark into the case first", async () => {
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "h1", "First");
			await saveAs(page, "Comment open");
			await inCase("Comment open");
			await page.click(shadow('[data-action="tool-box"]'));
			await page.drag({ x: 500, y: 100 }, { x: 640, y: 160 });
			await page.waitFor(shadow(".popover textarea"));
			await page.type("Half typed");
			await allCases();
			await until(
				() => toolbarUp(tabId),
				(up) => !up,
			);
			const c = titled(await h.control.eval<Db>(READ_DB), "Comment open")[0];
			expect(c?.marks.map((a) => [a.number, a.comment])).toEqual([
				[1, "First"],
				[2, "Half typed"],
			]);
			await page.send("Page.close");
		}, 60_000);

		test("marks right after a save, on the same screen, go into the case too", async () => {
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "h1", "First");
			await saveAs(page, "Same screen");
			await inCase("Same screen");
			// No scroll and no change to the page: nothing calls for a new shot.
			const box = async (text: string) => {
				// The tool stays on after a mark goes into the case.
				const tool = shadow('[data-action="tool-box"]');
				if (
					(await page.eval(`${tool}.getAttribute("aria-pressed")`)) !== "true"
				)
					await page.click(tool);
				await page.drag({ x: 500, y: 100 }, { x: 640, y: 160 });
				await comment(page, text);
			};
			const marksOf = async (title: string) =>
				(await h.control.eval<Db>(READ_DB)).cases.find((c) => c.title === title)
					?.marks.length;

			await box("Second");
			await page.waitFor(
				`${status} === "Mark 2 added to “Same screen”"`,
				20_000,
			);
			expect(await marksOf("Same screen")).toBe(2);

			// A new case starts with All cases, then New case for this page.
			await allCases();
			await h.control.eval(`${newCaseButton}.click()`);
			await page.waitFor(
				`${status} === "Adding to “Krankenkasse vergleichen (v1)”"`,
			);
			await box("Third");
			await saveAs(page, "Same screen, new case");
			expect(await marksOf("Same screen, new case")).toBe(1);
			expect(await marksOf("Same screen")).toBe(2);
			await inCase("Same screen, new case");
			await allCases();
			await page.send("Page.close");
		}, 60_000);

		test("Delete ends the toolbar adding to the case; the next save starts a new one", async () => {
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "[data-truth=submit]", "Deleted under it");
			await saveAs(page, "Deleted under it");
			await inCase("Deleted under it");
			const remove = `document.getElementById("delete-case")`;
			await h.control.eval(`${remove}.click()`);
			await Bun.sleep(600);
			await h.control.eval(`${remove}.click()`);
			await h.control.waitFor(`!document.getElementById("home").hidden`);
			await until(
				() => toolbarUp(tabId),
				(up) => !up,
			);
			await caseMarksAre(page, []);

			await h.control.eval(`${newCaseButton}.click()`);
			await page.waitFor(
				`${status} === "Adding to “Krankenkasse vergleichen (v1)”"`,
			);
			await markElement(page, "[data-truth=tip]", "Starts again");
			await saveAs(page, "Started again");
			await inCase("Started again");
			await allCases();
			await page.send("Page.close");
		}, 60_000);

		test("New case for this page never continues a case, also one deleted meanwhile", async () => {
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "[data-truth=submit]", "Deleted meanwhile");
			await saveAs(page, "Deleted meanwhile");
			await inCase("Deleted meanwhile");
			const gone = (await h.control.eval<Db>(READ_DB)).cases.find(
				(c) => c.title === "Deleted meanwhile",
			);
			// The toolbar's own Done: it keeps its case, the panel stays in it.
			await page.click(shadow('[data-action="close"]'));
			await until(
				() => toolbarUp(tabId),
				(up) => !up,
			);
			await h.control.eval(`new Promise((resolve, reject) => {
				const open = indexedDB.open("sitegloss");
				open.onsuccess = () => {
					const tx = open.result.transaction("cases", "readwrite");
					tx.objectStore("cases").delete(${JSON.stringify(gone?.id)});
					tx.oncomplete = () => resolve(true);
					tx.onerror = () => reject(tx.error);
				};
			})`);
			// A panel opened again: on Home, as the case is gone.
			await h.control.goto(
				`chrome-extension://${h.extensionId}/sidepanel/index.html`,
			);
			await h.control.waitFor(
				`${newCaseButton}.textContent === "New case for this page" && !document.getElementById("home").hidden`,
			);
			await h.control.eval(`${newCaseButton}.click()`);
			await page.waitFor(
				`${status} === "Adding to “Krankenkasse vergleichen (v1)”"`,
			);
			expect(
				await page.eval<string[]>(
					`[...${shadow("svg.marks")}.querySelectorAll(".saved g[data-number]")].map((g) => g.dataset.number)`,
				),
			).toEqual([]);
			await page.send("Page.close");
		}, 60_000);
	});
});

describe.skipIf(browserBinary === undefined)(
	"loading in another environment",
	() => {
		let h: Harness;

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
		}, 60_000);

		afterAll(async () => {
			await h?.stop();
		});

		test("a case from v1 finds its elements on v2 through the side panel", async () => {
			// The control page, a side panel, on Home: it opens the case the
			// toolbar adds to, where the case is named.
			await resetPanel(h);
			const v1 = await h.open("v1");
			await showToolbar(h, v1.page, v1.tabId);
			await markElement(v1.page, "[data-truth=submit]", "Too pale");
			await markElement(v1.page, "[data-truth=tip]", "Say how much");
			await markElement(v1.page, "[data-truth=contact]", "Add a phone number");
			await markElement(v1.page, "footer", "Footer is gone in v2");
			await saveAs(v1.page, "Reload test");
			await v1.page.send("Page.close");

			const v2 = await h.open("v2");
			await v2.page.eval(`document.querySelector("footer").remove()`);
			await v2.page.activate();
			await h.control.eval(
				`chrome.scripting.executeScript({ target: { tabId: ${v2.tabId} }, files: ["content.js"] })`,
			);
			// The side panel (the control page) acts on the tab in front: v2.
			// goto waits for the new document; a reload through eval would not.
			await h.control.goto(
				`chrome-extension://${h.extensionId}/sidepanel/index.html`,
			);
			await h.control.waitFor(`document.querySelector("[data-case]")`);
			await h.control.eval(`document.querySelector("[data-case]").click()`);
			await h.control.waitFor(`document.getElementById("load-case")`);
			// Opening it draws its marks on the tab in front already (DEC-022).
			await h.control.eval(
				`document.getElementById("load-case").textContent === "Show marks" && document.getElementById("load-case").click()`,
			);
			await h.control.waitFor(
				`document.querySelectorAll(".match").length === 4`,
				10_000,
			);

			const statuses = await h.control.eval<string[]>(
				`[...document.querySelectorAll(".match")].map((m) => m.dataset.status)`,
			);
			expect(
				statuses.slice(0, 3).every((s) => s === "found" || s === "probable"),
			).toBe(true);
			expect(statuses[3]).toBe("lost");

			// Each found mark is outlined on the right element of v2.
			const db = await h.control.eval<Db>(READ_DB);
			const saved = db.cases.find((c) => c.title === "Reload test");
			const result = await h.control.eval<{
				matches: { number: number; candidates: { selector: string }[] }[];
			}>(
				`chrome.tabs.sendMessage(${v2.tabId}, { type: "case:load", case: ${JSON.stringify(saved)} })`,
			);
			const truths = ["submit", "tip", "contact"];
			for (const [i, truth] of truths.entries()) {
				const selector = result.matches[i]?.candidates[0]?.selector ?? "";
				expect(
					await v2.page.eval<string | null>(
						`document.querySelector(${JSON.stringify(selector)})?.dataset.truth ?? null`,
					),
				).toBe(truth);
			}
			expect(
				await v2.page.eval<number>(
					`${shadow("svg.marks")}.querySelectorAll("[data-review]").length`,
				),
			).toBe(3);

			// "Show" scrolls the page to the contact paragraph.
			await h.control.eval(
				`document.querySelectorAll(".mark")[2].querySelector("[data-action=show]").click()`,
			);
			await v2.page.waitFor(
				`Math.abs(document.querySelector("[data-truth=contact]").getBoundingClientRect().top - innerHeight / 2) < innerHeight / 2`,
			);

			// Marks drawn while a case is loaded: its outlines stay out of the screenshot.
			await showToolbar(h, v2.page, v2.tabId);
			await markElement(v2.page, "[data-truth=tip]", "Still unclear");
			expect(
				await v2.page.eval<number>(
					`${shadow("svg.marks")}.querySelectorAll("[data-review]").length`,
				),
			).toBe(3);
			// The panel shows the loaded case, not this toolbar's: named as setup.
			await nameCase(
				h,
				await marksIn(v2.page),
				"With outlines loaded",
				v2.tabId,
			);
			expect(
				await countColour(
					h.control,
					"With outlines loaded",
					"shots/s1.webp",
					[0x1e, 0x8e, 0x3e],
				),
			).toBe(0);
			await v2.page.send("Page.close");
		}, 90_000);
	},
);

describe.skipIf(browserBinary === undefined)(
	"an AI app through a relay",
	() => {
		let h: Harness;
		const relay = startTestRelay();

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
		}, 60_000);

		afterAll(async () => {
			await h?.stop();
			await relay.stop();
		});

		test("the side panel's tools serve real cases to an MCP client", async () => {
			const v1 = await h.open("v1");
			await showToolbar(h, v1.page, v1.tabId);
			await markElement(v1.page, "[data-truth=submit]", "Too pale");
			await markElement(v1.page, "[data-truth=tip]", "Say how much");
			await saveAs(v1.page, "AI test");
			await v1.page.send("Page.close");
			const v2 = await h.open("v2");
			await v2.page.activate();
			await h.control.eval(
				`chrome.scripting.executeScript({ target: { tabId: ${v2.tabId} }, files: ["content.js"] })`,
			);

			// The relay comes with the worker's first state: the default one.
			const panel = await openSidePanel(h);
			await panel.waitFor(
				`document.getElementById("relay").value === "https://tab-mcp.ractive.ch"`,
			);

			// The side panel connects to the test relay ("keep AI access on").
			const address = await connectAi(panel, relay.url, { keepOn: true });
			const client = await mcpClient(relay, address);
			try {
				const cases = await client.callTool({
					name: "list_cases",
					arguments: {},
				});
				const [listed] = JSON.parse(
					(cases.content as { text: string }[])[0]?.text ?? "[]",
				) as { caseId: string; title: string }[];
				expect(listed?.title).toBe("AI test");

				const read = await client.callTool({
					name: "get_case",
					arguments: { caseId: listed?.caseId },
				});
				const images = (
					read.content as { type: string; data?: string; mimeType?: string }[]
				).filter((c) => c.type === "image");
				expect(images).toHaveLength(2);
				const bytes = Buffer.from(images[0]?.data ?? "", "base64");
				expect(images[0]?.mimeType).toBe("image/webp");
				expect(bytes.subarray(8, 12).toString()).toBe("WEBP");

				const load = await client.callTool({
					name: "load_case",
					arguments: { caseId: listed?.caseId },
				});
				const loaded = JSON.parse(
					(load.content as { text: string }[])[0]?.text ?? "{}",
				) as {
					url: string;
					marks: { status: string }[];
				};
				expect(loaded.url).toContain("/v2");
				expect(loaded.marks.map((m) => m.status)).toEqual(["found", "found"]);

				const shot = await client.callTool({ name: "capture", arguments: {} });
				expect((shot.content as { type: string }[])[1]?.type).toBe("image");

				// A change asks in the side panel, names the case, and offers
				// Always allow (DEC-018).
				const verdict = client.callTool({
					name: "set_summary",
					arguments: { caseId: listed?.caseId, summary: "Darker" },
				});
				const question = `document.querySelector("[data-question]")`;
				await panel.waitFor(question, 10_000);
				expect(
					await panel.eval<string[]>(
						`[...${question}.querySelectorAll("button")].map((b) => b.textContent.trim())`,
					),
				).toEqual(["Don't allow", "Allow", "Always allow"]);
				expect(await panel.eval<string>(`${question}.textContent`)).toContain(
					"Case: “AI test”",
				);
				await answerInPanel(panel, "deny");
				expect((await verdict).isError).toBe(true);
				await v2.page.activate();
			} finally {
				await client.close();
			}

			// The temporary mark for an AI app's screenshot.
			const described = await h.control.eval<{
				ok: boolean;
				details: { tag: string };
			}>(
				`chrome.tabs.sendMessage(${v2.tabId}, { type: "element:mark", selector: "button[type=submit]", number: 9, blurForms: true })`,
			);
			expect(described.ok).toBe(true);
			expect(described.details.tag).toBe("button");
			// Its own mode (not a save's "capturing"), form fields blurred.
			expect(
				await v2.page.eval<string>(
					`${HOST}.shadowRoot.querySelector(".layer").className`,
				),
			).toBe("layer marking");
			expect(
				await v2.page.eval<string>(
					`document.querySelector("input[name=zip]").style.filter`,
				),
			).toBe("blur(6px)");
			expect(
				await v2.page.eval<number>(
					`${shadow("g.temporary")}.childElementCount`,
				),
			).toBeGreaterThan(0);
			await h.control.eval(
				`chrome.tabs.sendMessage(${v2.tabId}, { type: "element:unmark" })`,
			);
			expect(
				await v2.page.eval<number>(
					`${shadow("g.temporary")}.childElementCount`,
				),
			).toBe(0);
			expect(
				await v2.page.eval<string>(
					`document.querySelector("input[name=zip]").style.filter`,
				),
			).toBe("");
			await v2.page.send("Page.close");
		}, 90_000);
	},
);

describe.skipIf(browserBinary === undefined)("screenshot scale", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("crops follow the captured image, not devicePixelRatio", async () => {
		const { page, tabId } = await h.open("v1");
		// devicePixelRatio 2, while Chrome still captures at 1×: like browser
		// zoom or DevTools' device mode.
		await page.send("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 800,
			deviceScaleFactor: 2,
			mobile: false,
		});
		await showToolbar(h, page, tabId);
		await markElement(page, "[data-truth=submit]", "Too pale");
		await saveAs(page, "Scale");
		const sizes = await h.control.eval<
			Record<string, { width: number; height: number }>
		>(
			`new Promise((resolve) => { const o = indexedDB.open("sitegloss"); o.onsuccess = () => { const tx = o.result.transaction(["cases", "images"]); const cases = tx.objectStore("cases").getAll(); const images = tx.objectStore("images").getAll(); const keys = tx.objectStore("images").getAllKeys(); tx.oncomplete = () => { const id = cases.result.find((c) => c.title === "Scale").id; const out = {}; keys.result.forEach((k, i) => { if (k.startsWith(id + "/")) out[k.slice(id.length + 1)] = { width: images.result[i].width, height: images.result[i].height }; }); resolve(out); }; }; })`,
		);
		const shot = sizes["shots/s1.webp"];
		const crop = sizes["crops/a1.webp"];
		const button = await page.eval<{ width: number; height: number }>(
			`(() => { const r = document.querySelector("[data-truth=submit]").getBoundingClientRect(); return { width: r.width, height: r.height }; })()`,
		);
		expect(shot).toBeDefined();
		expect(crop).toBeDefined();
		const scale = (shot?.width ?? 0) / 1280;
		// The button plus a 40 px margin on each side, at the image's scale:
		// not at devicePixelRatio's, which would double it.
		const pad = 2 * 40 + 2;
		expect(crop?.width ?? 0).toBeGreaterThanOrEqual(
			Math.floor(button.width * scale),
		);
		expect(crop?.width ?? 0).toBeLessThanOrEqual(
			Math.ceil((button.width + pad) * scale),
		);
		expect(crop?.height ?? 0).toBeGreaterThanOrEqual(
			Math.floor(button.height * scale),
		);
		expect(crop?.height ?? 0).toBeLessThanOrEqual(
			Math.ceil((button.height + pad) * scale),
		);
		await page.send("Page.close");
	}, 60_000);
});

describe.skipIf(browserBinary === undefined)("the side panel", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("a verdict being typed survives the case changing; delete asks twice", async () => {
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "h1", "Too long");
		await saveAs(page, "Panel test");
		await page.click(shadow('[data-action="close"]'));

		await h.control.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
		await h.control.waitFor(`document.querySelector("[data-case]")`);
		await h.control.eval(`document.querySelector("[data-case]").click()`);
		await h.control.waitFor(`document.getElementById("verdict")`);
		await h.control.eval(
			`(() => { const v = document.getElementById("verdict"); v.focus(); v.value = "Typed, not saved"; v.dispatchEvent(new Event("input")); v.setSelectionRange(5, 5); })()`,
		);

		// Another mark, added from the page, changes the open case.
		await page.activate();
		await h.control.eval(`document.getElementById("add-marks").click()`);
		await page.waitFor(
			`${shadow('[data-role="status"]')}?.textContent.includes("Panel test")`,
		);
		await markElement(page, "[data-truth=tip]", "Say how much");
		await h.control.waitFor(`document.querySelectorAll(".mark").length === 2`);
		expect(
			await h.control.eval<{ value: string; focused: boolean; at: number }>(
				`(() => { const v = document.getElementById("verdict"); return { value: v.value, focused: document.activeElement === v, at: v.selectionStart }; })()`,
			),
		).toEqual({ value: "Typed, not saved", focused: true, at: 5 });

		// Saving the verdict, then deleting: the first click only asks.
		await h.control.eval(`document.getElementById("save-verdict").click()`);
		await h.control.waitFor(
			`document.getElementById("verdict-status")?.textContent === "Saved"`,
		);
		await h.control.eval(`document.getElementById("delete-case").click()`);
		expect(
			await h.control.eval<string>(
				`document.getElementById("delete-case").textContent`,
			),
		).toBe("Really delete?");
		await Bun.sleep(600);
		await h.control.eval(`document.getElementById("delete-case").click()`);
		await h.control.waitFor(`!document.getElementById("home").hidden`);
		await h.control.waitFor(
			`![...document.querySelectorAll("[data-case] .title")].some((t) => t.textContent === "Panel test")`,
		);
		await page.send("Page.close");
	}, 90_000);
});
