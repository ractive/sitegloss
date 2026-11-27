/**
 * End to end: what only the whole side panel shows, in its real page with the
 * real extension (`main.ts` has no unit tests). The tests write the store
 * directly where a case's marks do not matter, and replace a `chrome.*`
 * function of the panel's page to make a page slow or a permission answer.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import type { Case } from "../../src/lib/case.ts";
import { exportCase } from "../../src/lib/export.ts";
import { DB_VERSION, MemoryStore } from "../../src/lib/store.ts";
import { sampleCase } from "../fixtures.ts";
import {
	answerInPanel,
	closeSidePanel,
	mcpClient,
	openSidePanel,
	setRelay,
} from "./ai.ts";
import type { Page } from "./browser.ts";
import {
	browserBinary,
	type Harness,
	inBothSets,
	PAST_GUARD_MS,
	SEARCH_AGAIN_MS,
	startHarness,
} from "./harness.ts";
import { fullDescribe, fullTest } from "./mode.ts";
import {
	type Db,
	FIELD,
	fieldValue,
	markElement,
	putCases as putStored,
	READ_DB,
	resetPanel,
	retypeField,
	saveAs,
	settingsOf,
	shadow,
	showToolbar,
	testWaits,
	worker,
} from "./steps.ts";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;

/** Until `check` says yes. */
async function until(
	check: () => Promise<boolean>,
	what: string,
	timeoutMs = 5000,
): Promise<void> {
	const end = Date.now() + timeoutMs;
	while (!(await check())) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(50);
	}
}

/**
 * A test with room for a slow machine: one that times out runs on into the
 * next. Of the full set; `smokeTest` is the one of both.
 */
const slowTest = (name: string, run: () => Promise<void>) =>
	fullTest(name, run, 60_000);
const smokeTest = (name: string, run: () => Promise<void>) =>
	test(name, run, 60_000);

inBothSets("the side panel's page", () => {
	let h: Harness;

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	const panelUrl = () =>
		`chrome-extension://${h.extensionId}/sidepanel/index.html`;
	const openPanel = () => h.control.goto(panelUrl());
	const readDb = () => h.control.eval<Db>(READ_DB);
	const storedCase = async (caseId: string) =>
		(await h.control.eval<{ cases: Case[] }>(READ_DB)).cases.find(
			(c) => c.id === caseId,
		);

	/** Write these cases over what the store has. */
	const putCases = (cases: Case[]) => putStored(h, cases);

	/** The panel on an empty store with these cases and no settings. */
	async function fresh(cases: Case[] = []): Promise<void> {
		// Made as the extension's store makes it, should this come first (a
		// test run by itself): opened without a version it would have no
		// stores, the transaction would throw, and this would wait for ever.
		await h.control.eval(`new Promise((resolve, reject) => {
			const open = indexedDB.open("sitegloss", ${DB_VERSION});
			open.onupgradeneeded = () => {
				open.result.createObjectStore("cases", { keyPath: "id" });
				open.result.createObjectStore("images");
			};
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const tx = open.result.transaction(["cases", "images"], "readwrite");
				tx.objectStore("cases").clear();
				tx.objectStore("images").clear();
				tx.oncomplete = () => { open.result.close(); resolve(); };
				tx.onerror = () => reject(tx.error);
			};
		})`);
		await putCases(cases);
		// No page of a test before, the panel on Home: one failing test does
		// not take the next ones along.
		await resetPanel(h);
	}

	/** Open the case with this id in `page`. */
	async function openCase(caseId: string, page = h.control): Promise<void> {
		const item = `document.querySelector('button[data-case="${caseId}"]')`;
		await page.waitFor(item);
		await page.eval(`${item}.click()`);
		await page.waitFor(`${id("verdict")}?.dataset.case === "${caseId}"`);
	}

	const backHome = (page = h.control) =>
		page.eval(`document.getElementById("back").click()`);

	/** What typing does; a script's `value` alone tells the panel nothing. */
	const typeVerdict = (text: string, page = h.control) =>
		page.eval(
			`(() => { const v = ${id("verdict")}; v.value = ${JSON.stringify(text)}; v.dispatchEvent(new Event("input")); })()`,
		);

	/** Make `chrome.tabs.sendMessage` in the panel go through `body`. */
	const wrapSend = (body: string) =>
		h.control.eval(
			`(() => { const send = chrome.tabs.sendMessage.bind(chrome.tabs); chrome.tabs.sendMessage = (tabId, message) => (${body})(tabId, message, send); })()`,
		);

	/** The panel shows the case `title`, as it opens the case a toolbar adds to (DEC-023): back to the list. */
	async function afterSave(title: string, page = h.control): Promise<void> {
		await page.waitFor(
			`document.querySelector("#case-view h2")?.textContent === ${JSON.stringify(title)}`,
			10_000,
		);
		await backHome(page);
		await page.waitFor(`!${id("home")}.hidden`);
	}

	/** A page with a saved case of one mark, and that case's id. */
	async function markedCase(title: string) {
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "h1", "Too long");
		await saveAs(page, title);
		// The panel opened the case the toolbar adds to (DEC-023): back to the
		// list, which ends the toolbar (as its Done) and takes the marks off.
		await afterSave(title);
		const saved = (await readDb()).cases.find((c) => c.title === title);
		return { page, tabId, caseId: saved?.id as string };
	}

	/**
	 * The case's marks on the tab in front: opening a case of that page loads
	 * it already, and the button would then hide them.
	 */
	const showMarks = async () => {
		await h.control.eval(
			`${id("load-case")}.textContent === "Show marks" && ${id("load-case")}.click()`,
		);
		await h.control.waitFor(
			`${id("case-hint")}.textContent.includes("marks found")`,
		);
	};

	/** The case whose marks the page shows; `null` also where no content script runs (yet). */
	const pageCase = (tabId: number) =>
		h.control.eval<string | null>(
			`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.loadedCase ?? null, () => null)`,
		);

	// A page Sitegloss is not in yet (the panel puts it there as a case opens)
	// shows no case: asked a moment early, that is the answer, not a failure.
	const overlayOf = (tabId: number) =>
		h.control.eval<{ loadedCase?: string }>(
			`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).catch(() => ({}))`,
		);

	/** Both clicks of a deliberate Delete. */
	async function confirmDelete(): Promise<void> {
		await h.control.eval(`${id("delete-case")}.click()`);
		await Bun.sleep(PAST_GUARD_MS);
		await h.control.eval(`${id("delete-case")}.click()`);
		await h.control.waitFor(`!${id("home")}.hidden`);
	}

	/** Pick a file in the panel's import field. */
	async function importFile(name: string, bytes: Uint8Array): Promise<void> {
		const base64 = Buffer.from(bytes).toString("base64");
		await h.control.eval(`(() => {
			const bytes = Uint8Array.from(atob("${base64}"), (c) => c.charCodeAt(0));
			const data = new DataTransfer();
			data.items.add(new File([bytes], ${JSON.stringify(name)}, { type: "application/zip" }));
			const input = ${id("import-file")};
			input.files = data.files;
			input.dispatchEvent(new Event("change"));
		})()`);
	}

	const zipOf = (c: Case) => exportCase(new MemoryStore(), c);

	slowTest(
		"Delete keeps the keyboard's focus, so Enter can confirm it",
		async () => {
			await fresh([sampleCase("c_keys")]);
			await openCase("c_keys");
			await h.control.activate();
			// Delete case is in the case's "…" menu (DEC-061).
			await h.control.eval(`${id("case-more")}.click()`);
			await h.control.eval(`${id("delete-case")}.focus()`);
			const enter = async () => {
				for (const type of ["keyDown", "keyUp"])
					await h.control.send("Input.dispatchKeyEvent", {
						type,
						key: "Enter",
						code: "Enter",
						windowsVirtualKeyCode: 13,
						...(type === "keyDown" ? { text: "\r" } : {}),
					});
			};
			await enter();
			await h.control.waitFor(
				`${id("delete-case")}.textContent === "Really delete?"`,
			);
			expect(await h.control.eval(`document.activeElement?.id`)).toBe(
				"delete-case",
			);
			await Bun.sleep(PAST_GUARD_MS);
			await enter();
			await h.control.waitFor(`!${id("home")}.hidden`);
			expect(await storedCase("c_keys")).toBeUndefined();
			// The delete is on record, written with it (DEC-039): by this
			// the sync deletes the case for a team, and by nothing else.
			expect(
				(await h.control.eval<{ deleted: string[] }>(READ_DB)).deleted,
			).toEqual(["c_keys"]);
		},
	);

	slowTest(
		"an armed Delete stays where it was clicked while the marks found on the tab are said above it: a second click in the same place deletes",
		async () => {
			await fresh();
			const marked = await h.open("v1");
			await marked.page.activate();
			const panel = await openSidePanel(h);
			try {
				// A case made with the toolbar on v1; the side panel shows it.
				await showToolbar(h, marked.page, marked.tabId);
				await markElement(marked.page, "[data-truth=submit]", "Too pale");
				await saveAs(marked.page, "Held in place", panel);
				const caseId = (await readDb()).cases.find(
					(c) => c.title === "Held in place",
				)?.id as string;
				// Another page in front: the case's mark is not found there.
				const other = await h.open("long");
				await other.page.activate();
				const found = `(${id("case-hint")}?.textContent ?? "").includes("1 of 1 marks found")`;
				await panel.waitFor(
					`!(${found}) && !${id("this-tab")}.innerText.includes("Looking for")`,
					10_000,
				);
				// The first click arms it (where the button is then does not
				// matter); the second goes to the spot it was armed at, which a
				// hand sees: below the case's thread, it is scrolled to first.
				// Delete case is in the case's "…" menu (DEC-061).
				await panel.eval(`${id("case-more")}.click()`);
				await panel.eval(
					`${id("delete-case")}.scrollIntoView({ block: "center" })`,
				);
				await panel.eval(`${id("delete-case")}.click()`);
				await panel.waitFor(
					`${id("delete-case")}.hasAttribute("data-armed")`,
					2000,
				);
				const armedAt = Date.now();
				const at = await panel.eval<{ x: number; y: number }>(
					`(() => { const r = ${id("delete-case")}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
				);
				// Between the two clicks v1 comes to the front: the panel finds
				// the mark there and says so above the button.
				await marked.page.activate();
				// Within the 4 s the Delete stays armed (DELETE_ARMED_MS).
				await panel.waitFor(found, 3500 - (Date.now() - armedAt));
				// The button is where the first click found it (no click is
				// aimed until it is: a test is faster than a hand), and the
				// same place, a second time, confirms.
				await panel.waitFor(
					`(() => { const r = ${id("delete-case")}.getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - ${at.x}) < 1 && Math.abs(r.y + r.height / 2 - ${at.y}) < 1 && document.elementFromPoint(${at.x}, ${at.y})?.id === "delete-case"; })()`,
					3000,
				);
				// A confirming click this soon after the first counts as a
				// double-click and deletes nothing (DELETE_CLICK_GAP_MS).
				await Bun.sleep(Math.max(0, PAST_GUARD_MS - (Date.now() - armedAt)));
				await panel.clickAt(at.x, at.y);
				await panel.waitFor(`!${id("home")}.hidden`, 5000);
				expect(await storedCase(caseId)).toBeUndefined();
			} finally {
				await closeSidePanel(h, panel);
			}
		},
	);

	slowTest(
		"a verdict not saved comes back with its case, and only there",
		async () => {
			await fresh([sampleCase("c_one"), sampleCase("c_two")]);
			await openCase("c_one");
			await typeVerdict("Darker, as agreed");
			await backHome();
			await openCase("c_two");
			expect(await h.control.eval(`${id("verdict")}.value`)).toBe("");
			await backHome();
			await openCase("c_one");
			expect(await h.control.eval(`${id("verdict")}.value`)).toBe(
				"Darker, as agreed",
			);
			expect(await h.control.eval(`${id("verdict-status")}.textContent`)).toBe(
				"Not saved yet",
			);
			expect((await storedCase("c_one"))?.verdict).toBeNull();
			// Saved, it is no draft any more.
			await h.control.eval(`${id("save-verdict")}.click()`);
			await h.control.waitFor(
				`${id("verdict-status")}.textContent === "Saved"`,
			);
			await backHome();
			await openCase("c_one");
			expect(await h.control.eval(`${id("verdict")}.value`)).toBe(
				"Darker, as agreed",
			);
			expect((await storedCase("c_one"))?.verdict).toBe("Darker, as agreed");
		},
	);

	slowTest(
		"a panel in another window follows; a saved verdict shows what is stored",
		async () => {
			await fresh([sampleCase("c_both")]);
			const other = await h.browser.newPage(panelUrl());
			await openCase("c_both");
			await openCase("c_both", other);

			// Saved with a newline: the stored text is trimmed, and so is the field.
			await typeVerdict("abc\n");
			await h.control.eval(`${id("save-verdict")}.click()`);
			await h.control.waitFor(`${id("verdict")}.value === "abc"`);
			await other.waitFor(`${id("verdict")}.value === "abc"`);

			// Saved in the other window: this one is not typing, so it follows.
			await typeVerdict("From the other window", other);
			await other.eval(`${id("save-verdict")}.click()`);
			await h.control.waitFor(
				`${id("verdict")}.value === "From the other window"`,
			);

			// Deleted in the other window: this one leaves the case.
			await other.eval(`${id("delete-case")}.click()`);
			await Bun.sleep(PAST_GUARD_MS);
			await other.eval(`${id("delete-case")}.click()`);
			await h.control.waitFor(`!${id("home")}.hidden`);
			await other.send("Page.close");
		},
	);

	slowTest("a deleted case's outlines leave the page", async () => {
		await fresh();
		const { page, tabId, caseId } = await markedCase("Outlined");
		await openPanel();
		await openCase(caseId);
		await page.activate();
		await showMarks();
		expect((await overlayOf(tabId)).loadedCase).toBe(caseId);
		await confirmDelete();
		await until(
			async () => (await overlayOf(tabId)).loadedCase === undefined,
			"the outlines to go",
		);
		await page.send("Page.close");
	});

	slowTest("a case a tool deleted leaves the page as well", async () => {
		await fresh();
		const { page, tabId, caseId } = await markedCase("Deleted by a tool");
		await openPanel();
		await page.activate();
		const c = await storedCase(caseId);
		await h.control.eval(
			`chrome.tabs.sendMessage(${tabId}, { type: "case:load", case: ${JSON.stringify(c)} })`,
		);
		await h.control.waitFor(`${id("page")}.textContent.endsWith("/v1")`);
		// What the panel of the window where the tool ran tells this one.
		const other = await h.browser.newPage(panelUrl());
		await page.activate();
		await other.eval(`new Promise((resolve, reject) => {
			const open = indexedDB.open("sitegloss");
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const tx = open.result.transaction("cases", "readwrite");
				tx.objectStore("cases").delete(${JSON.stringify(caseId)});
				tx.oncomplete = () => { open.result.close(); resolve(); };
			};
		})`);
		await other.eval(
			`chrome.runtime.sendMessage({ type: "cases:changed", caseId: ${JSON.stringify(caseId)} })`,
		);
		await until(
			async () => (await overlayOf(tabId)).loadedCase === undefined,
			"the outlines to go",
		);
		await other.send("Page.close");
		await page.send("Page.close");
	});

	slowTest(
		"Replace asks again when the case changed under the prompt",
		async () => {
			const c: Case = { ...sampleCase("c_file"), verdict: "From the file" };
			await fresh([{ ...c, verdict: "Stored" }]);
			await importFile("case.sitegloss.zip", await zipOf(c));
			const replace = `document.querySelector('[data-action="import-replace"]')`;
			await h.control.waitFor(replace);

			// An AI app's change, say, while the prompt is open.
			const changed = {
				...c,
				verdict: "Newer",
				updatedAt: "2026-11-05T10:00:00Z",
			};
			await putCases([changed]);
			const asked = await h.control.eval<string>(
				`${id("import-prompt")}.textContent`,
			);
			await h.control.eval(`${replace}.click()`);
			await h.control.waitFor(
				`${id("import-prompt")}.textContent !== ${JSON.stringify(asked)}`,
			);
			expect(await h.control.eval(`${id("import-prompt")}.hidden`)).toBe(false);
			expect((await storedCase("c_file"))?.verdict).toBe("Newer");

			// Knowing that, the user replaces it after all.
			await h.control.eval(`${replace}.click()`);
			await h.control.waitFor(`${id("verdict")}?.value === "From the file"`);
			expect((await storedCase("c_file"))?.verdict).toBe("From the file");
		},
	);

	slowTest(
		"the page goes on within itself (a hash, a single-page app's next route): nothing is drawn again, and the panel speaks of the page it shows now",
		async () => {
			await fresh();
			const a = await markedCase("Route change");
			await a.page.activate();
			await openPanel();
			await h.control.eval(`globalThis.loads = 0`);
			await wrapSend(`(tabId, message, send) => {
				if (message.type === "case:load") globalThis.loads++;
				return send(tabId, message);
			}`);
			await openCase(a.caseId);
			await until(
				async () => (await pageCase(a.tabId)) === a.caseId,
				"the marks on the tab in front",
			);
			// Its one mark is found: the draw is over, no search again follows.
			await h.control.waitFor(
				`/marks found on [^ ]+\\/v1\\.$/.test(${id("case-hint")}.textContent)`,
			);
			const before = await h.control.eval<number>(`globalThis.loads`);
			// The address changes within the page, as a router does it: no
			// load, the case stays on the page, and the page is another one
			// now, with none of the case's marks (DEC-057).
			await a.page.eval(`location.hash = "#/elsewhere"`);
			await a.page.eval(
				`history.pushState({}, "", location.pathname.replace("v1", "v2"))`,
			);
			await h.control.waitFor(
				`${id("none-found")}.textContent === "This case's page is not in this tab."`,
			);
			expect(await h.control.eval<number>(`globalThis.loads`)).toBe(before);
			expect(await pageCase(a.tabId)).toBe(a.caseId);
			// A real load of the page draws them again.
			await a.page.goto(`${h.base}/v1`);
			await until(
				async () => (await pageCase(a.tabId)) === a.caseId,
				"the marks after the load",
			);
			await a.page.send("Page.close");
		},
	);

	smokeTest(
		"opening a case draws its marks on the tab in front, and they follow to the next tab",
		async () => {
			await fresh();
			const a = await markedCase("Follows the tab");
			const b = await h.open(h.nextBuild);
			await b.page.activate();
			await openPanel();
			await testWaits(h.control, { searchAgainMs: SEARCH_AGAIN_MS });
			await openCase(a.caseId);
			// No click: v1 in another environment is in front.
			await until(
				async () => (await pageCase(b.tabId)) === a.caseId,
				"the marks on the tab in front",
			);
			await h.control.waitFor(
				`${id("case-hint")}.textContent.includes("marks found on")`,
			);
			expect(await h.control.eval(`${id("load-case")}.textContent`)).toBe(
				"Hide marks",
			);
			expect(await pageCase(a.tabId)).toBeNull();

			// Another tab in front: drawn there, taken off the one before.
			await a.page.activate();
			await until(
				async () => (await pageCase(a.tabId)) === a.caseId,
				"the marks on the next tab",
			);
			await until(
				async () => (await pageCase(b.tabId)) === null,
				"the marks off the tab before",
			);
			await h.control.waitFor(
				`document.querySelector(".match")?.dataset.status === "found"`,
			);

			// Hidden on a tab: not drawn there again by itself, not even after a
			// switch or a reload.
			await h.control.eval(`${id("load-case")}.click()`);
			await until(
				async () => (await pageCase(a.tabId)) === null,
				"the marks to go",
			);
			await b.page.activate();
			await until(
				async () => (await pageCase(b.tabId)) === a.caseId,
				"the marks on the other tab",
			);
			await a.page.activate();
			await until(
				async () => (await pageCase(b.tabId)) === null,
				"the marks off the other tab",
			);
			await a.page.goto(`${h.base}/v1`);
			await a.page.waitFor(`document.readyState === "complete"`);
			await Bun.sleep(4 * SEARCH_AGAIN_MS);
			expect(await pageCase(a.tabId)).toBeNull();
			await h.control.waitFor(
				`${id("load-case")}.textContent === "Show marks"`,
			);
			// Show puts them back; a reload draws them again from then on.
			await h.control.eval(`${id("load-case")}.click()`);
			await until(
				async () => (await pageCase(a.tabId)) === a.caseId,
				"the marks back",
			);
			await a.page.goto(`${h.base}/v1`);
			await until(
				async () => (await pageCase(a.tabId)) === a.caseId,
				"the marks after the reload",
			);

			// Back to the list: the panel's marks leave the page.
			await backHome();
			await until(
				async () => (await pageCase(a.tabId)) === null,
				"the marks to go with the case",
			);
			await a.page.send("Page.close");
			await b.page.send("Page.close");
		},
	);

	slowTest(
		"the page's own Hide holds: the searches again do not draw the marks back, a press on the pill does",
		async () => {
			await fresh();
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "h1", "Here");
			// Drawn by a script on this visit only: the next one lacks it.
			await page.eval(
				`document.body.insertAdjacentHTML("beforeend", '<p id="late">Late</p>')`,
			);
			await markElement(page, "#late", "Not there next time");
			await saveAs(page, "Hidden on the page");
			await afterSave("Hidden on the page");
			const saved = (await readDb()).cases.find(
				(c) => c.title === "Hidden on the page",
			);
			await page.goto(`${h.base}/v1`);
			await page.activate();
			await openPanel();
			// Searches again at 1 and 3 steps after the first draw: a step long
			// enough that the Hide comes before the last one, and the first
			// draw's time kept, to show that it did.
			const step = 1000;
			await testWaits(h.control, { searchAgainMs: step });
			await wrapSend(`(tabId, message, send) => {
				if (message.type === "case:load") globalThis.firstLoadAt ??= Date.now();
				return send(tabId, message);
			}`);
			await openCase(saved?.id as string);
			// One of two found: it is looked for again. (The status line says
			// it only once the searches again are over, DEC-064's review: the
			// marks' rows say it at once.)
			await h.control.waitFor(
				`[...document.querySelectorAll(".match")].filter((m) => m.dataset.status === "found").length === 1`,
			);
			await page.click(shadow('[data-action="review-hide"]'));
			await until(
				async () => (await pageCase(tabId)) === null,
				"the marks to go",
			);
			const hiddenAfter = await h.control.eval<number>(
				"Date.now() - globalThis.firstLoadAt",
			);
			expect(hiddenAfter).toBeLessThan(3 * step);
			// Past the last search again.
			await Bun.sleep(3 * step + 500 - hiddenAfter);
			expect(await pageCase(tabId)).toBeNull();
			expect(await h.control.eval(`${id("load-case")}.textContent`)).toBe(
				"Show marks",
			);
			// A real press on the pill brings them back. (Its pointer was once
			// captured at the press, and a captured pointer's click goes to the
			// bar, not to the button: the press did nothing.)
			await page.click(shadow('[data-action="review-show"]'));
			await until(
				async () => (await pageCase(tabId)) !== null,
				"the marks to come back",
			);
			await page.send("Page.close");
		},
	);

	slowTest(
		"a page that is none of the case's: one quiet line, and the facts' address opens the page (DEC-063)",
		async () => {
			await fresh();
			const { page, tabId } = await h.open("v1");
			await showToolbar(h, page, tabId);
			await markElement(page, "[data-truth=submit]", "Too pale");
			await saveAs(page, "Not for this page");
			// The panel opened it (DEC-023): its marks would follow the page.
			await afterSave("Not for this page");
			const saved = (await readDb()).cases.find(
				(c) => c.title === "Not for this page",
			);
			// A page with no such button.
			await page.goto(`${h.base}/long`);
			await page.activate();
			await openPanel();
			await testWaits(h.control, { searchAgainMs: SEARCH_AGAIN_MS });
			await openCase(saved?.id as string);
			// None of the case's marks is this page's (DEC-057).
			await h.control.waitFor(`!${id("none-found")}.hidden`, 10_000);
			expect(
				await h.control.eval<string>(`${id("none-found")}.textContent`),
			).toBe("This case's page is not in this tab.");
			expect(await h.control.eval(`${id("case-hint")}.hidden`)).toBe(true);
			// The page's address in the facts opens it, where the mark is found.
			await h.control.eval(`${id("open-page")}.click()`);
			await h.control.waitFor(
				`document.querySelector(".match")?.dataset.status === "found"`,
				15_000,
			);
			expect(await h.control.eval(`${id("none-found")}.hidden`)).toBe(true);
			const opened = await h.control.eval<number>(
				`chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id)`,
			);
			await h.control.eval(`chrome.tabs.remove(${opened})`);
			await page.send("Page.close");
		},
	);

	slowTest("a hint stays until the tab in front changes", async () => {
		await fresh();
		const a = await h.open("v1");
		const b = await h.open("v2");
		await b.page.activate();
		await h.control.waitFor(`${id("page")}.textContent.endsWith("/v2")`);
		await h.control.eval(`(() => {
			const no = () => Promise.reject(new Error("no access"));
			chrome.tabs.sendMessage = no;
			chrome.scripting.executeScript = no;
		})()`);
		await h.control.eval(`${id("new-case")}.click()`);
		// The test build may run on all sites: a refusal there is a page that
		// could not be reached, and the hint offers no way that cannot help
		// (DEC-076).
		await h.control.waitFor(
			`(() => { const t = ${id("hint")}.textContent; return !${id("hint")}.hidden && /reload/i.test(t) && !/all sites|click/i.test(t); })()`,
		);
		await a.page.goto(`${h.base}/v1`);
		await Bun.sleep(300);
		expect(await h.control.eval(`${id("hint")}.hidden`)).toBe(false);
		await a.page.activate();
		await h.control.waitFor(`${id("hint")}.hidden`);
		await a.page.send("Page.close");
		await b.page.send("Page.close");
	});

	slowTest(
		"Allow on all sites shows the permission and changes it",
		async () => {
			await fresh();
			const box = id("all-sites");
			// A test build has it from the start, and Chrome will not take that away.
			await h.control.waitFor(`${box}.checked`);
			await h.control.waitFor(`${id("page")}.textContent !== "…"`);
			await h.control.eval(`${box}.click()`);
			await h.control.waitFor(
				`${id("hint")}.textContent.includes("Could not change the access")`,
			);
			await h.control.waitFor(`${box}.checked`);

			await h.control.eval(`(() => {
			globalThis.asked = [];
			globalThis.granted = true;
			globalThis.answer = false;
			chrome.permissions.contains = async () => globalThis.granted;
			chrome.permissions.request = async (p) => {
				globalThis.asked.push(["request", ...p.origins]);
				globalThis.granted = globalThis.answer;
				return globalThis.granted;
			};
			chrome.permissions.remove = async (p) => {
				globalThis.asked.push(["remove", ...p.origins]);
				globalThis.granted = false;
				return true;
			};
		})()`);
			await h.control.eval(`${box}.click()`);
			await h.control.waitFor(`!${box}.checked`);
			// Declined: it stays off.
			await h.control.eval(`${box}.click()`);
			await h.control.waitFor(`globalThis.asked.length === 2`);
			await h.control.waitFor(`!${box}.checked`);
			await h.control.eval(`globalThis.answer = true; ${box}.click()`);
			await h.control.waitFor(`${box}.checked`);
			expect(await h.control.eval(`globalThis.asked`)).toEqual([
				["remove", "<all_urls>"],
				["request", "<all_urls>"],
				["request", "<all_urls>"],
			]);
		},
	);

	slowTest(
		"the blur setting goes to every tab, whatever a tab answers",
		async () => {
			await fresh();
			const a = await h.open("v1");
			const b = await h.open("v2");
			await b.page.activate();
			// The real side panel's box: the worker keeps the setting and tells
			// the tabs (DEC-016).
			const panel = await openSidePanel(h);
			const w = await worker(h);
			const tabs = await w.eval<number[]>(
				`chrome.tabs.query({}).then((tabs) => tabs.map((t) => t.id).sort())`,
			);
			await w.eval(`(() => {
				globalThis.told = [];
				const send = chrome.tabs.sendMessage.bind(chrome.tabs);
				chrome.tabs.sendMessage = (tabId, message, ...rest) => {
					if (message?.type !== "overlay:settings") return send(tabId, message, ...rest);
					globalThis.told.push({ tabId, ...message });
					return Promise.reject(new Error("no receiver"));
				};
			})()`);
			expect(await panel.eval(`${id("blur-forms")}.checked`)).toBe(false);
			await panel.eval(`${id("blur-forms")}.click()`);
			await w.waitFor(`globalThis.told.length === ${tabs.length}`);
			const told =
				await w.eval<{ tabId: number; blurForms: boolean }[]>(
					`globalThis.told`,
				);
			expect(told.map((t) => t.tabId).sort()).toEqual(tabs);
			expect(told.every((t) => t.blurForms === true)).toBe(true);
			expect((await settingsOf(h))["blurForms"]).toBe(true);
			// Off again for the tests after this one.
			await panel.eval(`${id("blur-forms")}.click()`);
			await w.waitFor(`globalThis.told.length === ${2 * tabs.length}`);
			expect((await settingsOf(h))["blurForms"]).toBe(false);
			await closeSidePanel(h, panel);
			await a.page.send("Page.close");
			await b.page.send("Page.close");
		},
	);

	fullDescribe("loads close together", () => {
		const hint = `${id("case-hint")}.textContent`;
		const REPLACED = "Loading was replaced";

		/**
		 * A case of `n` marks on v1 drawn on nothing: its load takes many of
		 * the page's timer turns (so a message sent right behind it lands
		 * while it runs), and none is ever found (so it is searched again at
		 * 1 s and 2 s).
		 */
		const manyMarks = (id: string, n = 60): Case => {
			const c = sampleCase(id);
			return {
				...c,
				page: { ...c.page, url: `${h.base}/v1` },
				marks: Array.from({ length: n }, (_, i) => ({
					id: `m${i + 1}`,
					number: i + 1,
					shot: "s1",
					comment: `Mark ${i + 1}`,
					author: "user" as const,
					shape: { kind: "note" as const, at: { x: 10 + i, y: 10 } },
					crop: `crops/m${i + 1}.webp`,
					element: null,
				})),
			};
		};

		slowTest(
			"the case opened again while its searches again wait: it is drawn",
			async () => {
				await fresh([manyMarks("c_again")]);
				const { page, tabId } = await h.open("v1");
				await page.activate();
				await openCase("c_again");
				await until(
					async () => (await pageCase(tabId)) === "c_again",
					"the marks on the page",
				);
				// The searches again (1 s, 2 s) are under way: back to the list,
				// and the case opened again at once.
				await h.control.eval(`${id("back")}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the marks to go",
				);
				await openCase("c_again");
				await until(
					async () => (await pageCase(tabId)) === "c_again",
					"the marks drawn again",
				);
				await h.control.eval(`${id("back")}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				await page.send("Page.close");
			},
		);

		slowTest(
			"a clear close behind the panel's draw: the panel shows what the page shows, and Show marks draws",
			async () => {
				// Many marks: the clear reaches the page while the load runs, mostly.
				const caseId = "c_cleared";
				await fresh([manyMarks(caseId)]);
				const { page, tabId } = await h.open("v1");
				// Sitegloss runs there already: the message behind the draw reaches it.
				await h.control.eval(
					`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ["content.js"] })`,
				);
				// Right behind the panel's draw, a clear of whatever the page shows,
				// as the Hide on the page's own bar, an AI app's tool or another
				// window's panel would. Which takes effect first is the page's
				// business: the draw stopped (replaced), or done and then cleared.
				await wrapSend(`async (tabId, message, send) => {
					if (message.type !== "case:load" || globalThis.raced)
						return send(tabId, message);
					globalThis.raced = true;
					const mine = send(tabId, message);
					const cleared = send(tabId, { type: "case:clear" });
					const answer = await mine;
					await cleared;
					globalThis.answered = true;
					return answer;
				}`);
				await page.activate();
				await openCase(caseId);
				const button = id("load-case");
				// The draw is over, either way: its button is back.
				await h.control.waitFor(
					`globalThis.answered && !${button}.hidden && ${button}.textContent === "Show marks"`,
				);
				expect(await pageCase(tabId)).toBeNull();
				expect(await h.control.eval<string>(hint)).not.toContain(REPLACED);
				expect(await h.control.eval<string>(hint)).not.toContain("marks found");
				expect(
					await h.control.eval<string>(`${id("tab-line")}.textContent`),
				).toBe("Marks are hidden on this tab.");
				// Show marks is the newest load: it draws them.
				await h.control.eval(`${button}.click()`);
				await h.control.waitFor(`${hint}.includes("0 of 60 marks found")`);
				await until(
					async () => (await pageCase(tabId)) === caseId,
					"the marks on the page",
				);
				expect(await h.control.eval<string>(`${button}.textContent`)).toBe(
					"Hide marks",
				);
				await h.control.eval(`${id("back")}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				await page.send("Page.close");
			},
		);
	});

	fullDescribe("one toolbar per open case (DEC-023)", () => {
		const back = id("back");
		/** A saved case of one mark, the panel in it and its marks on the page in front. */
		async function inCaseWithMarks(title: string) {
			await fresh();
			const saved = await markedCase(title);
			// The panel opened the case; start from the list.
			await h.control.eval(`${back}.hidden || ${back}.click()`);
			await h.control.waitFor(`!${id("home")}.hidden`);
			await openCase(saved.caseId);
			await saved.page.activate();
			await until(
				async () => (await pageCase(saved.tabId)) === saved.caseId,
				"the case's marks on the page",
			);
			return saved;
		}

		const toolbarUp = (tabId: number) =>
			h.control.eval<boolean>(
				`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).then((s) => s.visible, () => false)`,
			);

		slowTest(
			"the back button is a real button in the top bar, 32 px high at least",
			async () => {
				const { page } = await inCaseWithMarks("A large back button");
				const box = await h.control.eval<{ width: number; height: number }>(
					`(() => { const r = ${back}.getBoundingClientRect(); return { width: r.width, height: r.height }; })()`,
				);
				expect(box.height).toBeGreaterThanOrEqual(32);
				expect(box.width).toBeGreaterThanOrEqual(112);
				expect(await h.control.eval<string>(`${back}.textContent`)).toBe(
					"All cases",
				);
				// It stays in view while the case scrolls.
				await h.control.eval(`window.scrollTo(0, 400)`);
				expect(
					await h.control.eval<number>(`${back}.getBoundingClientRect().top`),
				).toBeGreaterThanOrEqual(0);
				await page.send("Page.close");
			},
		);

		slowTest(
			"the panel closed and opened again is in the case the page shows",
			async () => {
				const { page, tabId, caseId } = await inCaseWithMarks("Opened again");
				// As closing and opening the side panel: its page starts afresh.
				await openPanel();
				await h.control.waitFor(
					`!${id("case-view")}.hidden && ${id("verdict")}?.dataset.case === "${caseId}"`,
					10_000,
				);
				await h.control.waitFor(
					`${id("load-case")}.textContent === "Hide marks"`,
				);
				// The case's marks are the panel's again: they follow the case to
				// the next tab and leave this one.
				const other = await h.open("v2");
				await other.page.activate();
				await until(
					async () => (await pageCase(other.tabId)) === caseId,
					"the marks on the next tab",
				);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the marks to leave the first tab",
				);
				await h.control.eval(`${back}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				await until(
					async () => (await pageCase(other.tabId)) === null,
					"the marks to go",
				);
				await other.page.send("Page.close");
				await page.send("Page.close");
			},
		);

		slowTest(
			"a panel opened again while the toolbar adds to the case: its marks are the panel's",
			async () => {
				const { page, tabId, caseId } = await inCaseWithMarks(
					"Reopened while adding",
				);
				await h.control.eval(`${id("add-marks")}.click()`);
				await until(() => toolbarUp(tabId), "the toolbar");
				// As closing and opening the side panel.
				await openPanel();
				await h.control.waitFor(
					`!${id("case-view")}.hidden && ${id("verdict")}?.dataset.case === "${caseId}" && ${id("add-marks")}.textContent === "Adding marks: Done"`,
					10_000,
				);
				// What the page found shows, without a draw again.
				await h.control.waitFor(
					`document.querySelectorAll(".match").length === 1 && ${id("case-hint")}.textContent.includes("1 of 1 marks found")`,
				);
				// They follow the case to the next tab, and leave this one.
				const other = await h.open("v2");
				await other.page.activate();
				await until(
					async () => (await pageCase(other.tabId)) === caseId,
					"the marks on the next tab",
				);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the marks to leave the first tab",
				);
				await page.activate();
				await h.control.eval(`${back}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				await until(async () => !(await toolbarUp(tabId)), "the toolbar to go");
				await other.page.send("Page.close");
				await page.send("Page.close");
			},
		);

		slowTest(
			"a tab that does not answer the end does not hold the panel in the case",
			async () => {
				const { page, tabId } = await inCaseWithMarks("A silent tab");
				// Not the 20 s a frozen tab gets: this one is given up on sooner.
				await testWaits(h.control, { endMs: 500 });
				// Frozen by Chrome, or a page in an alert(): no answer, ever.
				await wrapSend(`(tabId, message, send) =>
					message.type === "overlay:end" ? new Promise(() => {}) : send(tabId, message)`);
				await h.control.eval(`${back}.click()`);
				await h.control.waitFor(
					`${id("leave-hint")}.textContent === "Finishing the marks…"`,
				);
				await h.control.waitFor(`!${id("home")}.hidden`, 10_000);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the marks to go",
				);
				await openPanel();
				await page.send("Page.close");
			},
		);

		slowTest(
			"a Hide on the tab holds through a reload, until Add marks shows the case's marks again",
			async () => {
				const { page, tabId, caseId } = await inCaseWithMarks(
					"Hidden, then shown while adding",
				);
				await testWaits(h.control, { searchAgainMs: SEARCH_AGAIN_MS });
				await h.control.eval(`${id("load-case")}.click()`);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the marks to go",
				);
				await h.control.waitFor(
					`${id("tab-line")}.textContent === "Marks are hidden on this tab." && ${id("load-case")}.textContent === "Show marks"`,
				);
				await page.send("Page.reload");
				await page.waitFor(`document.readyState === "complete"`);
				// Past the last search again (at 0, 1 and 3 steps): none drew them back.
				await Bun.sleep(4 * SEARCH_AGAIN_MS);
				expect(await pageCase(tabId)).toBeNull();
				expect(
					await h.control.eval<string>(`${id("load-case")}.textContent`),
				).toBe("Show marks");
				await h.control.eval(`${id("add-marks")}.click()`);
				await until(() => toolbarUp(tabId), "the toolbar");
				await until(
					async () => (await pageCase(tabId)) === caseId,
					"the marks back on the page",
				);
				await h.control.waitFor(
					`${id("load-case")}.textContent === "Hide marks" && ${id("add-marks")}.textContent === "Adding marks: Done"`,
				);
				// A mark added now is the case's, drawn as the others are.
				await markElement(page, "[data-truth=tip]", "And this");
				await until(
					async () =>
						(await page.eval<number>(
							`${shadow("svg.marks")}.querySelectorAll("[data-review]").length`,
						)) === 2,
					"the new mark among the loaded ones",
				);
				// Hide hides, and ends the adding: hidden marks and adding do not
				// go together (DEC-061).
				await h.control.eval(`${id("load-case")}.click()`);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the marks to go again",
				);
				await until(async () => !(await toolbarUp(tabId)), "the toolbar to go");
				await page.send("Page.close");
			},
		);

		slowTest(
			"a mark's pin on the page opens its comment there: changed, then deleted (DEC-027)",
			async () => {
				const { page, tabId, caseId } =
					await inCaseWithMarks("Picked on the page");
				const before = (await storedCase(caseId))?.marks[0];
				if (before === undefined) throw new Error("no mark");
				const pin = shadow(
					`.review [data-review="${before.number}"] [data-number] text`,
				);
				const popover = shadow(".popover");
				const field = FIELD;
				const row = `document.querySelector('[data-mark="${before.id}"]')`;
				await page.waitFor(pin);
				expect(
					await h.control.eval<boolean>(`${row}.hasAttribute("data-open")`),
				).toBe(false);
				await page.click(pin);
				await page.waitFor(`!${popover}.hidden && ${field} !== null`);
				expect(await fieldValue(page)).toBe(before.comment);
				// The panel shows the mark, with its other actions.
				await h.control.waitFor(`${row}.hasAttribute("data-open")`);

				// Done stores the changed comment; the panel and the case have it.
				await retypeField(page, "Changed on the page");
				await page.click(shadow('[data-action="mark-done"]'));
				await until(
					async () =>
						(await storedCase(caseId))?.marks[0]?.comment ===
						"Changed on the page",
					"the comment in the case",
				);
				await page.waitFor(`${popover}.hidden`);
				await h.control.waitFor(
					`${row}.querySelector(".comment").textContent === "Changed on the page"`,
				);

				// With a tool on, the layer that takes the pointer covers the pin:
				// a press there opens the comment and draws nothing.
				await h.control.eval(`${id("add-marks")}.click()`);
				await until(() => toolbarUp(tabId), "the toolbar");
				await page.click(shadow('[data-action="tool-box"]'));
				await page.waitFor(
					`${shadow('[data-action="tool-box"]')}.getAttribute("aria-pressed") === "true"`,
				);
				const at = await page.eval<{ x: number; y: number }>(
					`(() => { const r = ${pin}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
				);
				await page.clickAt(at.x, at.y);
				await page.waitFor(`!${popover}.hidden && ${field} !== null`);
				expect(await fieldValue(page)).toBe("Changed on the page");
				expect(
					await page.eval<number>(
						`${shadow("svg.marks")}.querySelectorAll(".drafts [data-number]").length`,
					),
				).toBe(0);

				// Delete mark asks twice; then the mark is out of the case, off
				// the page and off the panel's list.
				const remove = shadow('[data-action="mark-delete"]');
				await page.click(remove);
				await page.waitFor(`${remove}.textContent === "Really delete?"`);
				expect((await storedCase(caseId))?.marks.length).toBe(1);
				await Bun.sleep(PAST_GUARD_MS);
				await page.click(remove);
				await until(
					async () => (await storedCase(caseId))?.marks.length === 0,
					"the mark out of the case",
				);
				await page.waitFor(
					`${popover}.hidden && ${shadow("svg.marks")}.querySelectorAll("[data-review]").length === 0`,
				);
				await h.control.waitFor(`${row} === null`);
				await h.control.eval(`${id("add-marks")}.click()`);
				await until(async () => !(await toolbarUp(tabId)), "the toolbar to go");
				await page.send("Page.close");
			},
		);

		/** Delete the case as another window's panel (or an AI app) does. */
		async function deleteElsewhere(caseId: string, back: Page): Promise<void> {
			const elsewhere = await h.browser.newPage(panelUrl());
			await back.activate();
			await elsewhere.eval(`new Promise((resolve) => {
				const open = indexedDB.open("sitegloss");
				open.onsuccess = () => {
					const tx = open.result.transaction("cases", "readwrite");
					tx.objectStore("cases").delete(${JSON.stringify(caseId)});
					tx.oncomplete = () => { open.result.close(); resolve(); };
				};
			})`);
			await elsewhere.eval(
				`chrome.runtime.sendMessage({ type: "cases:changed", caseId: ${JSON.stringify(caseId)} })`,
			);
			await elsewhere.send("Page.close");
		}
		const toolbarSays = (page: Page) =>
			page.eval<string | undefined>(
				`${shadow('[data-role="status"]')}?.textContent`,
			);

		slowTest(
			"a toolbar on another tab whose case was deleted meanwhile ends too (DEC-026)",
			async () => {
				const { page, tabId, caseId } = await inCaseWithMarks("Deleted behind");
				await h.control.eval(`${id("add-marks")}.click()`);
				await until(() => toolbarUp(tabId), "the toolbar");
				const other = await h.open("v2");
				await other.page.activate();
				await until(
					async () => (await pageCase(other.tabId)) === caseId,
					"the marks on the next tab",
				);
				expect(await toolbarSays(page)).toBe("Adding to “Deleted behind”");
				await deleteElsewhere(caseId, other.page);
				await h.control.waitFor(`!${id("home")}.hidden`);
				// Not in front, its toolbar ends all the same: no case to add to.
				await until(async () => !(await toolbarUp(tabId)), "the toolbar to go");
				await page.activate();
				await h.control.waitFor(
					`${id("new-case")}.textContent === "New case for this page" && !${id("home")}.hidden`,
				);
				await other.page.send("Page.close");
				await page.send("Page.close");
			},
		);

		slowTest(
			"an AI app's load_case of the open case leaves with ← All cases",
			async () => {
				const { page, tabId, caseId } = await inCaseWithMarks(
					"Loaded by an AI app",
				);
				// The panel's own marks go; then an AI app draws the case there.
				await h.control.waitFor(
					`${id("load-case")}.textContent === "Hide marks"`,
				);
				await h.control.eval(`${id("load-case")}.click()`);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the panel's marks to go",
				);
				const c = await storedCase(caseId);
				await h.control.eval(
					`chrome.tabs.sendMessage(${tabId}, { type: "case:load", case: ${JSON.stringify(c)} })`,
				);
				expect(await pageCase(tabId)).toBe(caseId);
				await h.control.eval(`${back}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				await until(
					async () => (await pageCase(tabId)) === null,
					"the AI app's marks to go",
				);
				await page.send("Page.close");
			},
		);
	});

	fullDescribe("closing a case from the panel", () => {
		slowTest(
			"Close case leads back to the list, says where the case is and takes the focus there; Reopen case stays on the case",
			async () => {
				await fresh();
				const saved = await markedCase("Close and back");
				await openCase(saved.caseId);
				await saved.page.activate();
				await until(
					async () => (await pageCase(saved.tabId)) === saved.caseId,
					"the case's marks on the page",
				);
				await h.control.eval(`${id("close-case")}.click()`);
				await h.control.waitFor(`!${id("home")}.hidden`);
				expect(
					await h.control.eval<string>(`${id("hint")}.textContent`),
				).toMatch(
					/^\u201cClose and back\u201d is closed\. It is under (Closed|This page)\.$/,
				);
				// The marks left the tab, as with "All cases"; the focus is not on the body.
				await until(
					async () => (await pageCase(saved.tabId)) === null,
					"the case's marks to go",
				);
				expect(
					await h.control.eval<boolean>(
						`document.activeElement !== document.body`,
					),
				).toBe(true);
				// Reopened on the case itself: the person goes on there.
				await openCase(saved.caseId);
				await h.control.waitFor(
					`${id("close-case")}.textContent === "Reopen case"`,
				);
				await h.control.eval(`${id("close-case")}.click()`);
				await h.control.waitFor(
					`${id("close-case")}.textContent === "Close case"`,
				);
				expect(await h.control.eval<boolean>(`${id("case-view")}.hidden`)).toBe(
					false,
				);
				await saved.page.send("Page.close");
			},
		);
	});

	fullDescribe("with a relay", () => {
		const status = `${id("ai-status")}.textContent`;
		let side: Page | undefined;

		/** The side panel (the AI connection talks only to it), opened once. */
		async function sidePanel(): Promise<Page> {
			if (side === undefined) {
				await (await h.open("v1")).page.activate();
				side = await openSidePanel(h);
			}
			return side;
		}

		/** The side panel on `relay`, with "Keep AI access on". */
		async function keepOnWith(relay: string): Promise<Page> {
			const panel = await sidePanel();
			await setRelay(panel, relay);
			await panel.eval(`${id("keep-on")}.checked || ${id("keep-on")}.click()`);
			return panel;
		}

		/** A paired MCP client, through the address the card shows (none paired yet). */
		async function pairedClient(
			panel: Page,
			relay: Parameters<typeof mcpClient>[0],
		) {
			await panel.waitFor(
				`${id("pair-address")}.textContent.endsWith("/mcp")`,
				10_000,
			);
			const address = await panel.eval<string>(
				`${id("pair-address")}.textContent`,
			);
			return mcpClient(relay, address);
		}

		slowTest(
			"the AI pill in a case opens Settings and keeps the case, its marks and the toolbar (DEC-023)",
			async () => {
				const relay = startTestRelay({ pageWaitMs: 0 });
				await fresh();
				const { page, tabId, caseId } = await markedCase("Pill in a case");
				const panel = await sidePanel();
				const back = id("back");
				const toolbarOf = () =>
					h.control.eval<{ visible: boolean; target?: { caseId: string } }>(
						`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" })`,
					);
				try {
					await setRelay(panel, relay.url);
					await panel.eval(`${back}.hidden || ${back}.click()`);
					await panel.waitFor(`!${id("home")}.hidden`);
					await page.activate();
					await openCase(caseId, panel);
					await until(
						async () => (await pageCase(tabId)) === caseId,
						"the case's marks on the page",
					);
					await panel.eval(`${id("add-marks")}.click()`);
					await until(async () => (await toolbarOf()).visible, "the toolbar");

					await panel.eval(`${id("ai-button")}.click()`);
					await panel.waitFor(
						`!${id("settings")}.hidden && ${id("case-view")}.hidden && ${back}.textContent === "Back"`,
					);
					// A real click in the AI app card reaches it now. The card
					// grows while AI access comes on (the pairing box, above the
					// field), so a click aimed just before lands beside the field:
					// click until it is the field that has the focus.
					await until(async () => {
						await panel.click(id("relay"));
						return panel.eval<boolean>(
							`document.activeElement === ${id("relay")}`,
						);
					}, "a real click to reach the relay field");
					expect(await pageCase(tabId)).toBe(caseId);
					const toolbar = await toolbarOf();
					expect(toolbar.visible).toBe(true);
					expect(toolbar.target?.caseId).toBe(caseId);

					await panel.eval(`${back}.click()`);
					await panel.waitFor(
						`${id("settings")}.hidden && !${id("case-view")}.hidden && ${id("verdict")}?.dataset.case === "${caseId}"`,
					);
					expect(
						await panel.eval<string>(`${id("add-marks")}.textContent`),
					).toBe("Adding marks: Done");
					// Not a double click's second: that would do nothing.
					await Bun.sleep(PAST_GUARD_MS);
					await panel.eval(`${back}.click()`);
					await panel.waitFor(`!${id("home")}.hidden`);
					await until(
						async () => !(await toolbarOf()).visible,
						"the toolbar to go",
					);
					expect(await pageCase(tabId)).toBeNull();
				} finally {
					// AI access off, as the AI view's switch does.
					await panel.eval(
						`${id("ai-switch")}.checked && ${id("ai-switch")}.click()`,
					);
					await page.send("Page.close");
					await relay.stop();
				}
			},
		);

		test.each([
			["idle", { idleTimeoutMs: 300, heartbeatMs: 200 }],
			["expired", { sessionLifetimeMs: 800 }],
		])(
			"Keep AI access on connects again after a session ended as %s",
			async (_reason, limits) => {
				const relay = startTestRelay(limits);
				await fresh();
				const panel = await keepOnWith(relay.url);
				await panel.waitFor(
					`${status} === "Waiting for an AI app to pair"`,
					10_000,
				);
				await panel.eval(`(() => {
				globalThis.seen = [];
				new MutationObserver(() => globalThis.seen.push(${status})).observe(
					${id("ai-status")},
					{ childList: true },
				);
			})()`);
				await panel.waitFor(`globalThis.seen.includes("Connecting…")`);
				await panel.waitFor(`${status} === "Waiting for an AI app to pair"`);
				await relay.stop();
			},
			60_000,
		);

		slowTest(
			"a change by a tool reaches the panel in another window",
			async () => {
				const relay = startTestRelay();
				await fresh([sampleCase("c_tool")]);
				const other = await h.browser.newPage(panelUrl());
				await openCase("c_tool", other);
				const panel = await keepOnWith(relay.url);
				await panel.waitFor(
					`${status} === "Waiting for an AI app to pair"`,
					10_000,
				);
				const client = await pairedClient(panel, relay);
				try {
					const verdict = client.callTool({
						name: "set_summary",
						arguments: { caseId: "c_tool", summary: "Darker" },
					});
					await answerInPanel(panel, "allow");
					expect((await verdict).isError).toBeFalsy();
					await other.waitFor(`${id("verdict")}.value === "Darker"`);
				} finally {
					await client.close();
					await other.send("Page.close");
					await relay.stop();
				}
			},
		);

		slowTest(
			"Keep AI access on goes on trying a relay that is down, and says why",
			async () => {
				const gone = startTestRelay();
				const { port } = gone.relay;
				const { url } = gone;
				await gone.stop();
				await fresh();
				const panel = await keepOnWith(url);
				await panel.waitFor(
					`${status}.startsWith("Not connected: Could not connect to the relay")`,
					10_000,
				);
				expect(await panel.eval(status)).toContain("Trying again");
				const relay = startTestRelay({ port });
				await panel.waitFor(
					`${status} === "Waiting for an AI app to pair"`,
					15_000,
				);
				await relay.stop();
			},
		);
	});
});
