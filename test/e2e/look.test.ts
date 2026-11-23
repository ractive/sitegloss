/**
 * End to end: the look (DEC-024) where only a real browser can tell. The side
 * panel never scrolls sideways at its narrowest and at a common width, a view
 * has at most one amber button, the dark scheme's tokens arrive, every stroke
 * on the page has its casing, and the toolbar's rows are the ones meant.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import {
	CASING_EXTRA,
	PAGE_LOOK,
	STATUS_COLOUR,
} from "../../src/content/overlay.ts";
import { MARK_COLOUR } from "../../src/lib/marks.ts";
import { openSidePanel, setRelay } from "./ai.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	PAST_GUARD_MS,
	startHarness,
} from "./harness.ts";
import {
	dialogField,
	FIELD,
	markElement,
	parkControl,
	saveAs,
	shadow,
} from "./steps.ts";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;

/**
 * The panel's widths: Chrome's narrowest side panel with a classic scrollbar
 * beside its content (15 px on Windows and Linux, whenever a case is taller
 * than the panel), the same without one, and a common width.
 */
const WIDTHS = [345, 360, 420];

inFullSet("the look", () => {
	let h: Harness;
	let panel: Page;
	let page: Page;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		// One panel in the test's window: the control page, a panel too,
		// would open and draw the case as well, after this one closed it.
		await parkControl(h);
		({ page } = await h.open("v1"));
		await page.activate();
		panel = await openSidePanel(h);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	async function panelWidth(width: number): Promise<void> {
		await panel.send("Emulation.setDeviceMetricsOverride", {
			width,
			height: 800,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await panel.waitFor(`innerWidth === ${width}`);
	}

	/**
	 * What reaches past the right edge of the panel's content, and the view's
	 * amber buttons. The content's width is the scrolling element's
	 * `clientWidth`: the window's less a classic scrollbar, where there is one.
	 */
	const measure = () =>
		panel.eval<{
			scroll: number;
			client: number;
			past: string[];
			amber: string[];
		}>(
			`(() => {
				const shown = (e) => e.getClientRects().length > 0;
				const root = document.scrollingElement;
				return {
					scroll: root.scrollWidth,
					client: root.clientWidth,
					past: [...document.querySelectorAll("body *")]
						.filter((e) => shown(e) && !e.closest(".visually-hidden") && e.getBoundingClientRect().right > root.clientWidth + 0.5)
						.map((e) => e.tagName + "#" + e.id + "." + e.className),
					amber: [...document.querySelectorAll("button.primary")].filter(shown).map((e) => e.id || e.textContent),
				};
			})()`,
		);

	/** At each width: no sideways scroll, nothing past the edge, `amber` the amber buttons. */
	async function holds(amber: string[]): Promise<void> {
		for (const width of WIDTHS) {
			await panelWidth(width);
			const seen = await measure();
			expect(seen.client).toBeLessThanOrEqual(width);
			expect(seen.scroll).toBeLessThanOrEqual(seen.client);
			expect(seen.past).toEqual([]);
			expect(seen.amber).toEqual(amber);
		}
	}

	test("Home, a case with its marks open, and Settings: no sideways scroll at 345, 360 and 420 px, at most one amber button", async () => {
		await panel.waitFor(`!${id("new-case")}.disabled`);
		// Home, empty.
		await holds(["new-case"]);

		// A case with a long title and three marks, drawn on the page.
		await panel.eval(`${id("new-case")}.click()`);
		await page.waitFor(shadow('[data-action="tool-box"]'));
		// The case is made and open, the toolbar adding to it (DEC-026): the
		// tool bar's "Adding marks: Done" is the one amber button (DEC-064).
		await panel.waitFor(
			`!${id("case-view")}.hidden && ${id("add-marks")}?.textContent === "Adding marks: Done"`,
			20_000,
		);
		await holds(["add-marks"]);
		await markElement(
			page,
			"[data-truth=submit]",
			"Too pale: the label is hard to read on yellow, and averyveryverylongwordwithoutanybreakinitatallthatmustwrapsomewhere",
		);
		await markElement(page, "[data-truth=tip]", "Amount is outdated");
		await markElement(page, "h1", "Headline should say 2027");
		await saveAs(
			page,
			"Premium form: contrast, copy and a title that takes more than one line of the panel",
			panel,
		);
		// Still the case, renamed, the toolbar adding to it.
		await panel.waitFor(
			`!${id("case-view")}.hidden && ${id("add-marks")}?.textContent === "Adding marks: Done"`,
			20_000,
		);
		await holds(["add-marks"]);
		await panel.eval(`${id("add-marks")}.click()`);
		await panel.waitFor(
			`${id("add-marks")}.textContent === "Add marks"`,
			20_000,
		);
		// At rest the tool bar is calm: no amber in the case (DEC-064).

		// Home, with the page's case under This page: opening it is the one
		// amber button, a new case a plain one.
		await panel.eval(`${id("back")}.click()`);
		await panel.waitFor(
			`!${id("home")}.hidden && document.querySelectorAll("[data-case]").length === 1 && !${id("here")}.hidden`,
			20_000,
		);
		await holds(["open-here"]);

		// The case, opened from the list: its marks are drawn on the page.
		await panel.eval(`document.querySelector("[data-case]").click()`);
		await panel.waitFor(
			`${id("case-hint")}?.textContent.includes("3 of 3 marks found")`,
			20_000,
		);
		// The found line names no colour: a mark's colour is its status.
		expect(await panel.eval<string>(`${id("case-hint")}.textContent`)).toMatch(
			/^3 of 3 marks found on [^ ]+\.$/,
		);
		await panel.eval(`${id("toggle-marks")}.click()`);
		await panel.waitFor(
			`document.querySelectorAll(".mark[data-open]").length === 3`,
		);
		// One mark fixed: open, its body has Verify and Reopen… (DEC-064).
		const first = `document.querySelector(".mark")`;
		await panel.eval(
			`${first}.querySelector('[data-mark-action="resolve"]').click()`,
		);
		await panel.waitFor(
			`document.querySelector('[data-mark-action="resolve-done"]')`,
		);
		await panel.eval(
			`document.querySelector('[data-mark-action="resolve-done"]').click()`,
		);
		await panel.waitFor(
			`${first}.dataset.status === "fixed" && ${first}.querySelector('.body [data-mark-action="verify"]') !== null`,
			20_000,
		);
		await holds([]);
		// The status block: a chip per status with marks, tinted in its colour.
		expect(
			await panel.eval<string[][]>(
				`[...document.querySelectorAll("#case-status .chip")].map((c) => [c.dataset.group, getComputedStyle(c).color, getComputedStyle(c).backgroundColor])`,
			),
		).toEqual([
			["open", "rgb(194, 15, 76)", "rgb(252, 228, 236)"],
			["toVerify", "rgb(67, 71, 201)", "rgb(232, 233, 253)"],
		]);
		// The pins: the status's colour, on the rail.
		expect(
			await panel.eval<string[]>(
				`[...document.querySelectorAll(".mark .number")].map((n) => getComputedStyle(n).backgroundColor)`,
			),
		).toEqual(["rgb(67, 71, 201)", "rgb(194, 15, 76)", "rgb(194, 15, 76)"]);

		// A long link (DEC-028): cut in its line, never wider than the panel,
		// its form too.
		const link = `https://tickets.example.com/browse/ABC-123/${"averyverylongpathsegment".repeat(8)}`;
		await panel.eval(`${id("case-link-edit")}.click()`);
		await panel.waitFor(`!${id("case-link-form")}.hidden`);
		await panel.eval(`(() => {
			const f = ${id("case-link-field")};
			f.value = ${JSON.stringify(link)};
			f.dispatchEvent(new Event("input"));
		})()`);
		await holds([]);
		await panel.eval(`${id("case-link-save")}.click()`);
		await panel.waitFor(
			`${id("case-link-form")}.hidden && ${id("case-link-open")}.getAttribute("href") === ${JSON.stringify(link)}`,
			10_000,
		);
		await holds([]);

		// Settings, over the case: the pill turns AI access on, and the card
		// shows the address and the code, its widest content.
		const relay = startTestRelay({ pageWaitMs: 0 });
		try {
			await setRelay(panel, relay.url);
			await panel.eval(`${id("ai-button")}.click()`);
			await panel.waitFor(
				`!${id("settings")}.hidden && ${id("pair-address")}.textContent.endsWith("/mcp")`,
				20_000,
			);
			expect(await panel.eval<string>(`${id("ai-label")}.textContent`)).toBe(
				"AI on, no app yet",
			);
			await holds([]);
			await panel.eval(`${id("setup")}.open = true`);
			await holds([]);
			await panel.eval(`${id("ai-switch")}.click()`);
			await panel.waitFor(`${id("ai-label")}.textContent === "AI off"`, 20_000);
		} finally {
			await relay.stop();
		}
		// The steps above are quick: a click on the back button that soon after
		// "All cases" counts as a double click's second.
		await Bun.sleep(PAST_GUARD_MS);
		await panel.eval(`${id("back")}.click()`);
		await panel.waitFor(`!${id("case-view")}.hidden`);
		await panel.send("Emulation.clearDeviceMetricsOverride");
	}, 120_000);

	test("the top bar is paper, and the dark scheme's tokens arrive", async () => {
		const read = () =>
			panel.eval<Record<string, string>>(
				`(() => {
					const root = getComputedStyle(document.documentElement);
					return {
						paper: root.getPropertyValue("--paper").trim(),
						ink: root.getPropertyValue("--ink").trim(),
						body: getComputedStyle(document.body).backgroundColor,
						text: getComputedStyle(document.body).color,
						bar: getComputedStyle(${id("bar")}).backgroundColor,
						rule: getComputedStyle(${id("bar")}).borderBottomColor,
					};
				})()`,
			);
		const scheme = (value: string) =>
			panel.send("Emulation.setEmulatedMedia", {
				features: [{ name: "prefers-color-scheme", value }],
			});
		await scheme("light");
		expect(await read()).toEqual({
			paper: "#f6f4ee",
			ink: "#1b2130",
			body: "rgb(246, 244, 238)",
			text: "rgb(27, 33, 48)",
			bar: "rgb(246, 244, 238)",
			rule: "rgb(222, 218, 208)",
		});
		await scheme("dark");
		expect(await read()).toEqual({
			paper: "#11141a",
			ink: "#eceef3",
			body: "rgb(17, 20, 26)",
			text: "rgb(236, 238, 243)",
			bar: "rgb(17, 20, 26)",
			rule: "rgb(43, 49, 61)",
		});
		await panel.send("Emulation.setEmulatedMedia", { features: [] });
	}, 60_000);

	test("on the page every mark's shape has its casing, a draft's and a loaded mark's", async () => {
		await page.activate();
		/** Per group of `selector`: its stroked parts as [casing?, stroke, width]. */
		const shapes = (selector: string) =>
			page.eval<[boolean, string | null, number][][]>(
				`[...${shadow("svg.marks")}.querySelectorAll(${JSON.stringify(selector)})].map((g) =>
					[...g.querySelectorAll("rect, line, polyline")].map((e) => [e.hasAttribute("data-casing"), e.getAttribute("stroke"), Number(e.getAttribute("stroke-width"))]))`,
			);
		const cased: [boolean, string | null, number][] = [
			[true, PAGE_LOOK.casing, 3 + CASING_EXTRA],
			[false, MARK_COLOUR, 3],
		];
		// The case of the test before is open: its marks are drawn on the page,
		// the first one fixed and to verify, in its colour.
		await page.waitFor(
			`${shadow("svg.marks")}.querySelectorAll("[data-review]").length === 3`,
			20_000,
		);
		const toVerify: typeof cased = [
			[true, PAGE_LOOK.casing, 3 + CASING_EXTRA],
			[false, STATUS_COLOUR.toVerify, 3],
		];
		expect(await shapes("[data-review]")).toEqual([toVerify, cased, cased]);
		// The bars have their white ring before the shadow.
		expect(
			await page.eval<string>(
				`getComputedStyle(${shadow(".reviewbar")}).boxShadow`,
			),
		).toStartWith("rgba(255, 255, 255, 0.75) 0px 0px 0px 1px");

		// A draft, drawn now.
		await panel.eval(`${id("add-marks")}.click()`);
		await page.waitFor(shadow('[data-action="tool-element"]'));
		await page.click(shadow('[data-action="tool-element"]'));
		const at = await page.eval<{ x: number; y: number }>(
			`(() => { const r = document.querySelector("label, p, a").getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height / 2 }; })()`,
		);
		await page.mouse("mouseMoved", at.x, at.y);
		await page.waitFor(
			`${shadow("svg.marks")}.querySelectorAll(".drafts rect.hover").length === 2`,
		);
		await page.clickAt(at.x, at.y);
		await page.waitFor(FIELD);
		const drafts = await page.eval<[boolean, string | null, number][]>(
			`[...${shadow("svg.marks")}.querySelectorAll(".drafts > rect:not(.hover)")].map((e) => [e.hasAttribute("data-casing"), e.getAttribute("stroke"), Number(e.getAttribute("stroke-width"))])`,
		);
		expect(drafts).toEqual(cased);
		// The popover is light on any page, with its ring.
		expect(
			await page.eval<string[]>(
				`(() => { const s = getComputedStyle(${shadow(".popover")}); return [s.colorScheme, s.backgroundColor, s.boxShadow.slice(0, 41)]; })()`,
			),
		).toEqual([
			"light",
			"rgb(255, 255, 255)",
			"rgba(255, 255, 255, 0.75) 0px 0px 0px 1px",
		]);
		// The field in its frame is written as large as the dialog around it
		// (Chrome gives the body of an extension's page 75 % of its size).
		const field = await dialogField(page);
		expect(
			await field.eval<string>(
				`getComputedStyle(document.getElementById("field")).fontSize`,
			),
		).toBe(
			await page.eval<string>(
				`getComputedStyle(${shadow(".popover")}).fontSize`,
			),
		);
		expect(
			await page.eval<string>(
				`${shadow('[data-action="comment-remove"]')}.textContent`,
			),
		).toBe("Cancel");
		await page.click(shadow('[data-action="comment-remove"]'));
		await panel.eval(`${id("add-marks")}.click()`);
		await panel.waitFor(
			`${id("add-marks")}.textContent === "Add marks"`,
			20_000,
		);
	}, 120_000);

	test("the toolbar at any page width and font: the tools never wrap, the status is beside them or on its own row, every button keeps its name", async () => {
		await page.activate();
		await panel.eval(`${id("add-marks")}.click()`);
		await page.waitFor(shadow('[data-action="tool-box"]'));
		interface Layout {
			fit: string;
			/** Rows the buttons stand in. */
			buttons: number;
			/** 1: beside the buttons; 2: on a row of its own under them. */
			status: number;
			fits: boolean;
			/** Buttons whose word shows. */
			words: number;
			named: boolean;
		}
		const at = async (width: number): Promise<Layout> => {
			await page.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: 600,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await page.waitFor(`innerWidth === ${width}`);
			// The toolbar lays itself out on the page's resize.
			await page.eval(
				"new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))",
			);
			return page.eval<Layout>(
				`(() => {
					const bar = ${shadow(".toolbar")};
					const all = [...bar.querySelectorAll("button")];
					const box = bar.getBoundingClientRect();
					const tops = all.map((e) => e.getBoundingClientRect().top);
					const under = Math.max(...all.map((e) => e.getBoundingClientRect().bottom));
					const status = bar.querySelector(".status").getBoundingClientRect();
					return {
						fit: bar.dataset.fit,
						buttons: Math.max(...tops) - Math.min(...tops) < 8 ? 1 : 2,
						status: status.top >= under - 1 ? 2 : (status.top + status.bottom) / 2 > Math.min(...tops) && (status.top + status.bottom) / 2 < under ? 1 : 0,
						fits: box.left >= 0 && box.right <= document.documentElement.clientWidth,
						words: all.filter((b) => { const w = b.querySelector(".word"); return w && w.getBoundingClientRect().width > 2; }).length,
						named: all.every((b) => (b.textContent || b.getAttribute("aria-label") || "").trim() !== ""),
					};
				})()`,
			);
		};
		/** From wide to narrow: what must hold whatever the font and the scrollbar. */
		const check = async (): Promise<Layout[]> => {
			const seen: Layout[] = [];
			for (const width of [1600, 1200, 1000, 900, 800, 700, 600, 500, 440]) {
				const layout = await at(width);
				seen.push(layout);
				// The tools never wrap in the middle, and the bar stays on the page.
				expect([width, layout.buttons, layout.fits]).toEqual([width, 1, true]);
				// Beside the tools or on its own row, never between or across.
				expect([1, 2]).toContain(layout.status);
				expect(layout.named).toBe(true);
				// Words go only once the status has a row of its own.
				if (layout.status === 1) expect(layout.words).toBe(7);
			}
			// Narrower never brings a roomier layout back.
			const tightness = seen.map((l) => l.fit.length);
			expect(tightness).toEqual([...tightness].sort((a, b) => a - b));
			const words = seen.map((l) => l.words);
			expect(words).toEqual([...words].sort((a, b) => b - a));
			return seen;
		};
		const plain = await check();
		// Adding to a case: five tools, Undo and Done have an icon and a word.
		// Wide enough, all of it is one row; narrow enough, only icons are left.
		expect(plain[0]).toMatchObject({ fit: "", status: 1, words: 7 });
		expect(plain.at(-1)).toMatchObject({ status: 2, words: 0 });

		// Moved to the top, the toolbar has no review bar beside it: the bar
		// steps aside while marks are added (DEC-061).
		await page.click(shadow('[data-action="move-toolbar"]'));
		expect(
			await page.eval<boolean>(
				`${shadow(".toolbar")}.classList.contains("top") && ${shadow(".reviewbar")}.hidden`,
			),
		).toBe(true);
		await page.click(shadow('[data-action="move-toolbar"]'));

		// A system font a third wider, and a classic scrollbar on the page: the
		// same holds, with other layouts at the same widths.
		await page.eval(`(() => {
			const root = ${shadow(".toolbar")}.getRootNode();
			const wide = new CSSStyleSheet();
			wide.replaceSync(".layer { letter-spacing: 0.14em; font-size: 15px; }");
			root.adoptedStyleSheets = [...root.adoptedStyleSheets, wide];
			const bar = document.createElement("style");
			bar.id = "classic-scrollbar";
			bar.textContent = "html { overflow-y: scroll; } ::-webkit-scrollbar { width: 15px; } body { min-height: 200vh; }";
			document.head.append(bar);
		})()`);
		const wide = await check();
		expect(wide.at(-1)).toMatchObject({ status: 2, words: 0 });
		// The wider font needs the tighter layout sooner.
		expect(
			wide.every((l, i) => l.fit.length >= (plain[i] as Layout).fit.length),
		).toBe(true);
		expect(wide.some((l, i) => l.fit !== (plain[i] as Layout).fit)).toBe(true);
		await page.eval(`(() => {
			const root = ${shadow(".toolbar")}.getRootNode();
			root.adoptedStyleSheets = root.adoptedStyleSheets.slice(0, -1);
			document.getElementById("classic-scrollbar").remove();
		})()`);
		await page.send("Emulation.clearDeviceMetricsOverride");
		await panel.eval(`${id("add-marks")}.click()`);
	}, 120_000);
});
