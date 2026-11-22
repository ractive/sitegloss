/**
 * End to end (DEC-050): Home offers a case only on the same page of the same
 * site; a case opened by hand on another host draws the marks of the path in
 * front, a home page too; a screenshot keeps its query, and a mark's link
 * opens where it was made, or the same on the host in front, and shows the
 * mark there. The second host is `sitegloss.test`, which Chromium resolves
 * to the pages' own server (browser.ts).
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Case, Mark, Shot } from "../../src/lib/case.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	opened,
	SEARCH_AGAIN_MS,
	startHarness,
} from "./harness.ts";
import {
	type Db,
	markElement,
	putCases,
	READ_DB,
	resetPanel,
	saveAs,
	shadow,
	showToolbar,
	testWaits,
} from "./steps.ts";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;

inFullSet("the page a mark was made on", () => {
	let h: Harness;
	/** `http://sitegloss.test:<port>`: the same pages on another host. */
	let other: string;
	let caseId: string;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		other = h.base.replace("127.0.0.1", "sitegloss.test");
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	const readDb = () => h.control.eval<Db>(READ_DB);
	const panelUrl = () =>
		`chrome-extension://${h.extensionId}/sidepanel/index.html`;

	/** Open `url` in a new tab, in front, with its tab id. */
	async function visit(url: string): Promise<{ page: Page; tabId: number }> {
		const page = await h.browser.newPage(url);
		const tabId = await h.control.eval<number>(
			`chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url === ${JSON.stringify(url)})?.id)`,
		);
		opened.set(page, { h, tabId });
		await page.activate();
		return { page, tabId };
	}

	/** The panel (the control page) on Home, for the tab in front. */
	async function home(): Promise<void> {
		await h.control.goto(panelUrl());
		await h.control.waitFor(
			`document.querySelectorAll("[data-case]").length > 0`,
		);
	}

	const tabUrl = (tabId: number) =>
		h.control.eval<string>(`chrome.tabs.get(${tabId}).then((t) => t.url)`);

	/** Until the tab has loaded `url`. */
	async function loaded(tabId: number, url: string): Promise<void> {
		const end = Date.now() + 15_000;
		for (;;) {
			const tab = await h.control.eval<{ url: string; status: string }>(
				`chrome.tabs.get(${tabId}).then((t) => ({ url: t.url, status: t.status }))`,
			);
			if (tab.url === url && tab.status === "complete") return;
			if (Date.now() > end)
				throw new Error(`the tab shows ${tab.url} (${tab.status}), not ${url}`);
			await Bun.sleep(100);
		}
	}

	test("a mark made on the home page keeps its query beside the plain address", async () => {
		await resetPanel(h);
		const { page, tabId } = await visit(`${h.base}/?q=shoes&token=abc#top`);
		await showToolbar(h, page, tabId);
		await markElement(page, "h1", "Title too long");
		await saveAs(page, "Home case");
		const c = (await readDb()).cases.find(
			(x) => x.title === "Home case",
		) as Case;
		caseId = c.id;
		expect(c.shots[0]?.url).toBe(`${h.base}/`);
		expect(c.shots[0]?.query).toBe("q=shoes");
		// Two marks more, as a team would bring them: a box on nothing on
		// the home page, and one on another page with its own query.
		const s1 = c.shots[0] as Shot;
		const m1 = c.marks[0] as Mark;
		const box = (n: number, shot: string): Mark => ({
			...m1,
			id: `m${n}`,
			number: n,
			shot,
			comment: `Box ${n}`,
			shape: {
				kind: "box",
				rect: { x: 40, y: 300 + n * 40, width: 200, height: 30 },
			},
			crop: `crops/m${n}.webp`,
			element: null,
		});
		const s2: Shot = {
			...s1,
			id: "s2",
			image: "shots/s2.webp",
			url: `${h.base}/v2`,
			query: "tab=2",
		};
		await putCases(h, [
			{
				...c,
				pages: [
					...(c.pages ?? []),
					{ url: `${h.base}/v2`, title: "Version 2", lang: "de" },
				],
				shots: [s1, s2],
				marks: [m1, box(2, "s1"), box(3, "s2")],
			},
		]);
		await page.send("Page.close");
	}, 60_000);

	test("Home offers the case on its own site's pages only, whatever the query", async () => {
		await resetPanel(h);
		const here = await visit(`${h.base}/?q=boots`);
		await home();
		await h.control.waitFor(
			`!${id("here")}.hidden && ${id("here-cases")}.querySelector('[data-case="${caseId}"]') !== null`,
		);
		await here.page.send("Page.close");
		const v2 = await visit(`${h.base}/v2`);
		await home();
		await h.control.waitFor(`!${id("here")}.hidden`);
		await v2.page.send("Page.close");
		// The same paths on another host: offered nowhere, listed below.
		for (const path of ["/", "/v2"]) {
			const elsewhere = await visit(`${other}${path}`);
			await home();
			await h.control.waitFor(
				`document.querySelector('ul.cases[data-group="other"] [data-case="${caseId}"]') !== null`,
			);
			expect(await h.control.eval(`${id("here")}.hidden`)).toBe(true);
			expect(
				await h.control.eval<string>(`${id("home")}.textContent`),
			).not.toMatch(/other site/i);
			// Nothing opened by itself.
			expect(await h.control.eval(`${id("case-view")}.hidden`)).toBe(true);
			await elsewhere.page.send("Page.close");
		}
	}, 60_000);

	test("opened by hand on another host's home page, the home page's marks are the page's own; a mark's link opens the same path and query on the host in front, or where it was made, keeping the case open and showing the mark", async () => {
		await resetPanel(h);
		await testWaits(h.control, {
			searchAgainMs: SEARCH_AGAIN_MS,
			routeSettleMs: SEARCH_AGAIN_MS,
		});
		const { page, tabId } = await visit(`${other}/`);
		await home();
		await h.control.click(`document.querySelector('[data-case="${caseId}"]')`);
		const host = new URL(other).host;
		// The home page's marks are this home page's, the box on nothing
		// too; the other page's is not looked for here.
		await h.control.waitFor(
			`${id("case-hint")}.textContent === ${JSON.stringify(`1 of 2 marks found on ${host}. Dashed: unsure. 1 more is on other pages of the case.`)}`,
			15_000,
		);
		// The box on nothing is drawn where it was; the other page's is not.
		await page.waitFor(`${shadow('[data-review="2"]')} !== null`);
		expect(await page.eval(`${shadow('[data-review="1"]')} !== null`)).toBe(
			true,
		);
		expect(await page.eval(`${shadow('[data-review="3"]')} === null`)).toBe(
			true,
		);
		const row = (n: number) => `document.querySelector('[data-mark="m${n}"]')`;
		expect(
			await h.control.eval<string>(
				`${row(3)}.querySelector(".mark-page").textContent`,
			),
		).toBe(`Marked on ${new URL(h.base).host}/v2?tab=2 · Open on ${host}`);
		// Keyboard and screen readers: a button with its own name.
		expect(
			await h.control.eval<string>(
				`${row(3)}.querySelector('[data-mark-link="here"]').getAttribute("aria-label")`,
			),
		).toBe(`Open the same page on ${host}, and show mark 3 there`);
		// The same path and query on this host, in this tab.
		await h.control.eval(
			`${row(3)}.querySelector('[data-mark-link="here"]').click()`,
		);
		await loaded(tabId, `${other}/v2?tab=2`);
		// The case stays open; its mark of that page is drawn and shown.
		await page.waitFor(`${shadow('[data-review="3"]')} !== null`, 15_000);
		expect(await h.control.eval(`${id("case-view")}.hidden`)).toBe(false);
		// Where mark 1 was made: production, with its query; it is found
		// there and outlined (the focused mark shows its element).
		await h.control.eval(
			`${row(1)}.querySelector('[data-mark-link="made"]').click()`,
		);
		await loaded(tabId, `${h.base}/?q=shoes`);
		await page.waitFor(
			`${shadow('[data-review="1"] [data-element]')} !== null`,
			15_000,
		);
		expect(await tabUrl(tabId)).toBe(`${h.base}/?q=shoes`);
		expect(
			await h.control.eval<string>(
				`document.querySelector("#case-view h2")?.textContent`,
			),
		).toBe("Home case");
		await page.send("Page.close");
	}, 60_000);
});
