/**
 * The store package as a user gets it: the real manifest with no host access,
 * minified, and the toolbar icon clicked for real (CDP's `Extensions` domain
 * clicks it as the browser would, with the user gesture and the `activeTab`
 * grant). All other end-to-end tests run a test build with `<all_urls>`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Page } from "./browser.ts";
import { browserBinary, type Harness, startShipped } from "./harness.ts";
import {
	type Db,
	HOST,
	imagesOf,
	markElement,
	READ_DB,
	reachOverlay,
	saveAs,
	shadow,
	until,
	viewportSettled,
	worker,
} from "./steps.ts";

interface Capture {
	ok: boolean;
	error?: string;
}

describe.skipIf(browserBinary === undefined)("the store package", () => {
	let h: Harness;

	/** How `chrome.scripting` fares on the tab: `"injected"`, or Chrome's refusal. */
	const inject = (tabId: number) =>
		h.control.eval<string>(
			`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ["content.js"] }).then(() => "injected", (e) => e.message)`,
		);
	/** Whether the worker may take a screenshot of the tab, as the AI app's `capture` does. */
	const capture = async (tabId: number) =>
		(await worker(h)).eval<Capture>(
			`chrome.tabs.get(${tabId}).then((t) => chrome.tabs.captureVisibleTab(t.windowId, { format: "png" })).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }))`,
		);
	const sidePanel = async (): Promise<Page> => {
		const { targetId } = await h.browser.waitForTarget(
			(t) =>
				t.type === "page" &&
				t.url === `chrome-extension://${h.extensionId}/sidepanel/index.html` &&
				t.targetId !== h.control.targetId,
		);
		return h.browser.attachPage(targetId);
	};

	beforeAll(async () => {
		h = await startShipped(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("has no host access, in the manifest or in Chrome", async () => {
		expect(h.manifest["host_permissions"]).toBeUndefined();
		expect(h.manifest["key"]).toBeUndefined();
		// Asked for at the first Export (DEC-020), not granted at install.
		expect(h.manifest["optional_permissions"]).toEqual(["downloads"]);
		const granted = await h.control.eval<{
			origins: string[];
			permissions: string[];
		}>("chrome.permissions.getAll()");
		expect(granted.origins).toEqual([]);
		expect(granted.permissions.sort()).toEqual([
			"activeTab",
			"alarms",
			// The browser's sign-in window, for sitegloss.dev (DEC-039).
			"identity",
			"notifications",
			"offscreen",
			"scripting",
			"sidePanel",
			"storage",
			"unlimitedStorage",
		]);
	});

	test("only notifications adds an install warning; storage, unlimitedStorage, alarms and offscreen none", async () => {
		const warnings = (manifest: object) =>
			h.control.eval<string[]>(
				`chrome.management.getPermissionWarningsByManifest(${JSON.stringify(JSON.stringify(manifest))})`,
			);
		const all = h.manifest["permissions"] as string[];
		expect(all).toContain("unlimitedStorage");
		expect(all).toContain("alarms");
		expect(all).toContain("offscreen");
		// "Display notifications", in the browser's language.
		expect(await warnings(h.manifest)).toHaveLength(1);
		const permissions = all.filter((p) => p !== "notifications");
		expect(await warnings({ ...h.manifest, permissions })).toEqual([]);
		// Chrome does warn here, so the empty answer above means something.
		expect(
			await warnings({
				...h.manifest,
				permissions: [...permissions, "history"],
			}),
		).toHaveLength(1);
	});

	/**
	 * The case is open (DEC-023, DEC-026), in the side panel and in the
	 * control page, which is a panel too: both go back to the list, or an
	 * open case's marks would follow to the next tab in front.
	 */
	async function toAllCases(panel: Page, title: string): Promise<void> {
		for (const page of [panel, h.control]) {
			await page.waitFor(
				`document.querySelector("#case-view h2")?.textContent === ${JSON.stringify(title)}`,
				10_000,
			);
			await page.eval(`document.getElementById("back").click()`);
			await page.waitFor(`!document.getElementById("home").hidden`);
		}
	}

	test("a tab nobody clicked the icon on is refused", async () => {
		const { page, tabId } = await h.open("v2");
		expect(await inject(tabId)).toContain("Cannot access");
		const answer = await capture(tabId);
		expect(answer.ok).toBe(false);
		expect(answer.error).toContain("activeTab");
		expect(await page.eval<boolean>(`${HOST} === null`)).toBe(true);
		await page.send("Page.close");
	}, 15_000);

	test("a click on the icon opens the side panel, and marks can be saved on that tab only", async () => {
		const clicked = await h.open("v1");
		const other = await h.open("v2");
		await clicked.page.activate();
		await h.browser.clickIcon(h.extensionId, `${h.base}/v1`);

		const panel = await sidePanel();
		await panel.waitFor(`document.getElementById("new-case")`);
		await clicked.page.waitFor(HOST);
		await viewportSettled(clicked.page);
		// The page's scripts cannot reach into the overlay.
		expect(await clicked.page.eval(`${HOST}.shadowRoot`)).toBeNull();
		expect((await capture(clicked.tabId)).ok).toBe(true);

		await panel.click(`document.getElementById("new-case")`);
		await reachOverlay(clicked.page);
		// The toolbar exists, hidden, from the start: a click on it would go past.
		await clicked.page.waitFor(`!${shadow(".toolbar")}.hidden`);
		await markElement(clicked.page, "[data-truth=submit]", "Too pale");
		await saveAs(clicked.page, "From the store package");
		await toAllCases(panel, "From the store package");
		const db = await h.control.eval<Db>(READ_DB);
		const saved = db.cases[0];
		expect(saved?.title).toBe("From the store package");
		expect(saved?.marks[0]?.element?.tag).toBe("button");
		expect(imagesOf(db, saved?.id ?? "")).toContain("crops/m1.webp");
		await panel.waitFor(`document.querySelector("[data-case]")`);

		// The click was for that tab: the panel, still open, may not touch the
		// other, and says so with a notice above the button it turns off.
		await other.page.activate();
		await panel.waitFor(
			`!document.getElementById("access-notice").hidden && document.getElementById("new-case").disabled`,
		);
		expect(
			await panel.eval<string>(
				`document.getElementById("access-notice").textContent`,
			),
		).toContain("may not run on this tab");
		await panel.click(`document.getElementById("new-case")`);
		expect(await inject(other.tabId)).toContain("Cannot access");
		expect(await other.page.eval<boolean>(`${HOST} === null`)).toBe(true);
		// Its Allow on all sites asks Chrome for every site, in the click.
		await panel.eval(`(() => {
			globalThis.asked = [];
			chrome.permissions.request = (p) => (globalThis.asked.push(p), Promise.resolve(false));
		})()`);
		await panel.click(
			`document.querySelector('#access-notice [data-action="allow-all-sites"]')`,
		);
		expect(await panel.eval(`globalThis.asked`)).toEqual([
			{ origins: ["<all_urls>"] },
		]);
		// A no changes nothing.
		await Bun.sleep(200);
		expect(
			await panel.eval<boolean>(
				`document.getElementById("access-notice").hidden`,
			),
		).toBe(false);
		await panel.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
	}, 60_000);

	test("a click on the icon while the site's next page loads runs Sitegloss on that page", async () => {
		const { page } = await h.open("v1?next=1");
		const tab = await h.browser.waitForTarget(
			(t) => t.type === "tab" && t.url === `${h.base}/v1?next=1`,
		);
		// A link to the next page of the site, which is slow to come: clicked
		// while it comes, the script went into the page on its way out.
		const next = `${h.base}/v2?wait=1500`;
		await page.eval(`location.href = ${JSON.stringify(next)}`);
		await Bun.sleep(300);
		await h.browser.send("Extensions.triggerAction", {
			id: h.extensionId,
			targetId: tab.targetId,
		});
		await page.waitFor(`location.href === ${JSON.stringify(next)}`, 10_000);
		await page.waitFor(HOST, 10_000);
		await page.send("Page.close");
	}, 30_000);

	test("a case's address opens a tab, without the query it was made at; an early click there lets nothing in; the panel asks for that tab, and a click once it has loaded loads the case", async () => {
		const url = `${h.base}/slow/v1?from=1`;
		const first = await h.open("slow/v1?from=1");
		await h.browser.clickIcon(h.extensionId, url);
		const panel = await sidePanel();
		await panel.eval(
			`document.getElementById("back").hidden || document.getElementById("back").click()`,
		);
		await panel.waitFor(`!document.getElementById("home").hidden`);
		await panel.waitFor(`document.getElementById("new-case")`);
		await first.page.waitFor(HOST);
		await viewportSettled(first.page);
		await panel.click(`document.getElementById("new-case")`);
		await reachOverlay(first.page);
		await first.page.waitFor(`!${shadow(".toolbar")}.hidden`);
		await markElement(first.page, "[data-truth=tip]", "Slow to come");
		await saveAs(first.page, "From a slow page");
		await toAllCases(panel, "From a slow page");
		await first.page.send("Page.close");
		const tabTargets = async () =>
			(await h.browser.targets()).filter((t) => t.type === "tab");
		while ((await tabTargets()).some((t) => t.url === url))
			await Bun.sleep(100);

		const row = `[...document.querySelectorAll("[data-case]")].find((e) => e.textContent.includes("From a slow page"))`;
		await panel.waitFor(row);
		await panel.click(row);
		await panel.waitFor(`document.getElementById("open-page")`);
		const before = new Set((await tabTargets()).map((t) => t.targetId));
		await panel.click(`document.getElementById("open-page")`);
		const opened = await h.browser.waitForTarget(
			(t) => t.type === "tab" && !before.has(t.targetId),
		);
		// Clicked before its first page has come (it takes 1.5 s): Chrome
		// grants that page nothing.
		await h.browser.send("Extensions.triggerAction", {
			id: h.extensionId,
			targetId: opened.targetId,
		});
		const tabId = await h.control.eval<number>(
			`chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id)`,
		);
		await until(
			() =>
				h.control.eval<string>(
					`chrome.tabs.get(${tabId}).then((t) => t.status)`,
				),
			(status) => status === "complete",
			10_000,
		);
		// Nothing went in, and the panel asks for the click on this tab.
		await panel.waitFor(
			`!document.getElementById("case-access").hidden && document.getElementById("case-access").dataset.tab === "${tabId}" && document.getElementById("case-access").textContent.includes("Click the Sitegloss icon")`,
			10_000,
		);
		// The case's address has no query.
		const { targetId } = await h.browser.waitForTarget(
			(t) => t.type === "page" && t.url === `${h.base}/slow/v1`,
		);
		const page = await h.browser.attachPage(targetId);
		expect(await page.eval<boolean>(`${HOST} === null`)).toBe(true);
		// The click again, now that the page is there: the case loads.
		await h.browser.send("Extensions.triggerAction", {
			id: h.extensionId,
			targetId: opened.targetId,
		});
		await panel.waitFor(
			`document.querySelector(".match")?.dataset.status === "found"`,
			15_000,
		);
		expect(await page.eval<boolean>(`${HOST} !== null`)).toBe(true);
		expect(
			await panel.eval<string>(
				`document.getElementById("case-hint").textContent`,
			),
		).toContain("1 of 1 marks found");
		await page.send("Page.close");
	}, 60_000);

	test("a case opened on a tab Sitegloss may not see yet loads at the icon's click", async () => {
		// As after reloading the extension: the tab shows the case's page, and
		// Chrome hides its address until the icon is clicked there.
		const tabTargets = async () =>
			(await h.browser.targets()).filter((t) => t.type === "tab");
		const before = new Set((await tabTargets()).map((t) => t.targetId));
		const page = await h.browser.newPage(`${h.base}/v1`);
		await page.activate();
		const fresh = (await tabTargets()).find((t) => !before.has(t.targetId));
		const panel = await sidePanel();
		await panel.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
		const row = `[...document.querySelectorAll("[data-case]")].find((e) => e.textContent.includes("From the store package"))`;
		await panel.waitFor(row);
		await panel.eval(`${row}.click()`);
		await panel.waitFor(
			`!document.getElementById("case-access").hidden && document.getElementById("load-case").hidden`,
		);
		await h.browser.send("Extensions.triggerAction", {
			id: h.extensionId,
			targetId: fresh?.targetId,
		});
		await panel.waitFor(
			`document.querySelector(".match")?.dataset.status === "found"`,
			15_000,
		);
		expect(
			await panel.eval<boolean>(
				`document.getElementById("case-access").hidden`,
			),
		).toBe(true);
		expect(await page.eval<number>(`${HOST} === null ? 0 : 1`)).toBe(1);
	}, 60_000);

	test("as the owner uses it: after a reload, a case loads at the icon's click; Hide takes its marks off and Show puts them back", async () => {
		const tabTargets = async () =>
			(await h.browser.targets()).filter((t) => t.type === "tab");
		const loadedCase = (tabId: number) =>
			h.control.eval<string | null>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.loadedCase ?? null, () => null)`,
			);
		// A case of two marks, one on an element a script added on that visit.
		const url = `${h.base}/v1?owner=1`;
		const first = await h.open("v1?owner=1");
		await h.browser.clickIcon(h.extensionId, url);
		const panel = await sidePanel();
		// It may still show the case of a test before, and its marks followed
		// to this tab: a panel opened again would open that case (DEC-023).
		await panel.eval(
			`document.getElementById("back").hidden || document.getElementById("back").click()`,
		);
		await panel.waitFor(`!document.getElementById("home").hidden`);
		await panel.waitFor(`document.getElementById("new-case")`);
		await first.page.waitFor(HOST);
		await viewportSettled(first.page);
		await panel.click(`document.getElementById("new-case")`);
		await reachOverlay(first.page);
		await first.page.waitFor(`!${shadow(".toolbar")}.hidden`);
		await markElement(first.page, "[data-truth=tip]", "Here");
		await first.page.eval(
			`document.body.insertAdjacentHTML("beforeend", '<p id="late">Late</p>')`,
		);
		await markElement(first.page, "#late", "Not there next time");
		await saveAs(first.page, "As the owner uses it");
		await toAllCases(panel, "As the owner uses it");
		await first.page.send("Page.close");

		// A tab on the case's page that Sitegloss may not see yet.
		const before = new Set((await tabTargets()).map((t) => t.targetId));
		const page = await h.browser.newPage(`${h.base}/v1`);
		await page.activate();
		const fresh = (await tabTargets()).find((t) => !before.has(t.targetId));
		const tabId = await h.control.eval<number>(
			`chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id)`,
		);
		await panel.goto(
			`chrome-extension://${h.extensionId}/sidepanel/index.html`,
		);
		const row = `[...document.querySelectorAll("[data-case]")].find((e) => e.textContent.includes("As the owner uses it"))`;
		await panel.waitFor(row);
		await panel.eval(`${row}.click()`);
		// The notice for THIS tab, not the one before it.
		const openedId = await h.control.eval<number>(
			`chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id)`,
		);
		await panel.waitFor(
			`!document.getElementById("case-access").hidden && document.getElementById("case-access").dataset.tab === "${openedId}"`,
			10_000,
		);
		await h.browser.send("Extensions.triggerAction", {
			id: h.extensionId,
			targetId: fresh?.targetId,
		});
		await panel.waitFor(
			`document.getElementById("case-hint").textContent.includes("1 of 2 marks found")`,
			15_000,
		);
		expect(await loadedCase(tabId)).not.toBeNull();
		const button = `document.getElementById("load-case")`;
		await panel.waitFor(`${button}.textContent === "Hide marks"`);
		// A real click, as a person makes it.
		await panel.click(button);
		await panel.waitFor(`${button}.textContent === "Show marks"`);
		expect(await loadedCase(tabId)).toBeNull();
		// That Hide holds through the searches again is panel.test.ts's (the
		// store package cannot shorten them). Show puts them back.
		await panel.click(button);
		await panel.waitFor(`${button}.textContent === "Hide marks"`);
		expect(await loadedCase(tabId)).not.toBeNull();
	}, 60_000);
});
