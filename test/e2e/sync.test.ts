/**
 * End to end: the sync (DEC-021, DEC-025). "Copy to Downloads" writes each
 * case to `Sitegloss/` in the profile's downloads folder (the test build has
 * `downloads`, so Chrome asks nothing), and the worker writes it again after
 * an AI app's change with no extension page open, through its offscreen
 * document. Chrome's folder picker cannot be answered over the DevTools
 * Protocol, so the test build hands the side panel a folder of the
 * extension's private file system (`siteglossUseFolder`) instead; that folder
 * never needs Chrome's OK, so `test:access` in the sync's database makes the
 * test build's worker see one that does. Paused, the banner sits above Home
 * and the case and the icon shows "!"; Allow access (a stubbed
 * `requestPermission`) clears both, and "Use Downloads instead" switches.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/client";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import type { Case } from "../../src/lib/case.ts";
import { readZip } from "../../src/lib/zip.ts";
import {
	answerInPanel,
	closeSidePanel,
	connectAi,
	mcpClient,
	openSidePanel,
} from "./ai.ts";
import type { Page } from "./browser.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";
import {
	type Db,
	markElement,
	openCase,
	panelHome,
	READ_DB,
	renameInPanel,
	saveAs,
	shadow,
	showToolbar,
	until,
} from "./steps.ts";

const FOLDER = "synced";
const FILE = "synced-case.sitegloss.zip";

/** The folder of the private file system, as the panel gets it. */
const FOLDER_HANDLE = `navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(${JSON.stringify(FOLDER)}, { create: true }))`;

/** The names of the files in that folder, read in an extension page. */
const FOLDER_FILES = `${FOLDER_HANDLE}.then(async (dir) => {
	const names = [];
	for await (const [name, entry] of dir.entries())
		if (entry.kind === "file") names.push(name);
	return names.sort();
})`;

/** Set `key` in the sync's database to `value` (`undefined` removes it). */
const SYNC_KV = (
	key: string,
	value?: string,
) => `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss-sync", 1);
	open.onupgradeneeded = () => open.result.createObjectStore("settings");
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const tx = open.result.transaction("settings", "readwrite");
		const store = tx.objectStore("settings");
		${value === undefined ? `store.delete(${JSON.stringify(key)})` : `store.put(${JSON.stringify(value)}, ${JSON.stringify(key)})`};
		tx.oncomplete = () => { open.result.close(); resolve(true); };
		tx.onerror = () => reject(tx.error);
	};
})`;

/** `key` in the sync's database (`null` when it is not there). */
const SYNC_GET = (key: string) => `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss-sync", 1);
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const get = open.result.transaction("settings").objectStore("settings").get(${JSON.stringify(key)});
		get.onsuccess = () => { open.result.close(); resolve(get.result ?? null); };
		get.onerror = () => reject(get.error);
	};
})`;

const PANEL_PAGE = (h: Harness) =>
	`chrome-extension://${h.extensionId}/sidepanel/index.html`;
const SYNC = `document.getElementById("sync")`;
const SYNC_STATE = `${SYNC}.querySelector(".sync-state")?.textContent`;
const BANNER = `document.getElementById("sync-banner")`;
const IN_SYNC = (action: string) =>
	`${SYNC}.querySelector('[data-action="${action}"]')`;
const IN_BANNER = (action: string) =>
	`${BANNER}.querySelector('[data-action="${action}"]')`;

/** The worker asked to run, as the panel asks after a change of its own. */
const RUN = `chrome.runtime.sendMessage({ type: "sync:run" })`;

describe.skipIf(browserBinary === undefined)("the sync", () => {
	let h: Harness;
	let panel: Page;
	let claude: Client;
	let caseId: string;
	const relay = startTestRelay();

	const downloaded = (name: string) =>
		join(h.browser.downloads, "Sitegloss", name);
	/** The case in the downloads' file `name`, as Import a case… would read it. */
	const caseIn = async (name: string): Promise<Case | undefined> => {
		const file = Bun.file(downloaded(name));
		if (!(await file.exists())) return undefined;
		try {
			const zip = await readZip(new Uint8Array(await file.arrayBuffer()));
			return JSON.parse(new TextDecoder().decode(zip.get("case.json")));
		} catch {
			// Being written just now: read again.
			return undefined;
		}
	};
	const badge = () => h.control.eval<string>("chrome.action.getBadgeText({})");
	const title = () => h.control.eval<string>("chrome.action.getTitle({})");
	/** Chrome's download list: the sync keeps only its newest entry there. */
	const downloadList = () =>
		h.control.eval<string[]>(
			"chrome.downloads.search({}).then((all) => all.map((d) => d.filename))",
		);
	/** Extension pages open now, but the offscreen document. */
	const extensionPages = async () =>
		(await h.browser.targets())
			.filter(
				(t) =>
					(t.type === "page" || t.type === "tab") &&
					t.url.startsWith(`chrome-extension://${h.extensionId}/`) &&
					!t.url.includes("/offscreen/"),
			)
			.map((t) => t.url);

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		// Chrome's own way, by its settings: CDP's "allow" names a file by a GUID.
		await h.browser.send("Browser.setDownloadBehavior", {
			behavior: "default",
		});
		// Not v1: a test's tab is found by its address.
		const tab = await h.open("v2");
		await tab.page.activate();
		panel = await openSidePanel(h);
		await panel.waitFor(`${SYNC_STATE} === "Off."`, 10_000);
		const address = await connectAi(panel, relay.url);
		claude = await mcpClient(relay, address);
	}, 60_000);

	afterAll(async () => {
		await claude?.close();
		await h?.stop();
		await relay.stop();
	});

	test("Sync to Downloads writes Sitegloss/<name>.sitegloss.zip into the downloads folder", async () => {
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "[data-truth=submit]", "Too pale");
		await saveAs(page, "Synced case");
		// The case is open in the panel (DEC-023, DEC-026): back to the list,
		// where the sync's choice is.
		await panel.waitFor(
			`document.querySelector("#case-view h2")?.textContent === "Synced case"`,
			10_000,
		);
		await panel.eval(`document.getElementById("back").click()`);
		await panel.waitFor(`!document.getElementById("home").hidden`);
		await page.send("Page.close");
		const saved = (await h.control.eval<Db>(READ_DB)).cases.find(
			(c) => c.title === "Synced case",
		);
		if (saved === undefined) throw new Error("not saved");
		caseId = saved.id;

		await panel.click(IN_SYNC("sync-downloads"));
		const written = await until(
			() => caseIn(FILE),
			(c) => c !== undefined,
			15_000,
		);
		expect(written?.id).toBe(caseId);
		await panel.waitFor(
			`${SYNC_STATE} === "Copying to Downloads/Sitegloss" && ${SYNC}.querySelector(".sync-line")?.textContent.startsWith("Last written ")`,
			10_000,
		);
		expect(await panel.eval(`Boolean(${IN_SYNC("sync-show")})`)).toBe(true);
		expect(await panel.eval(`${BANNER}.hidden`)).toBe(true);
		expect(await badge()).toBe("");
	}, 60_000);

	test("with no extension page open, an AI app's change is written again by the worker, and a save by a worker started anew", async () => {
		const first = claude.callTool({
			name: "set_summary",
			arguments: { caseId, summary: "Darker button, as agreed" },
		});
		await answerInPanel(panel, "allow");
		expect(((await first) as { isError?: boolean }).isError).toBeFalsy();
		await until(
			() => caseIn(FILE),
			(c) => c?.verdict === "Darker button, as agreed",
			15_000,
		);

		// A page with the toolbar, for a mark once the worker is a new one. Its
		// case has no mark yet: no file for it (DEC-026).
		const later = await h.open("v1");
		const laterCase = await showToolbar(h, later.page, later.tabId);
		const PAGE_FILE = "krankenkasse-vergleichen-v1.sitegloss.zip";
		// No extension page open: the panel closed, the control page elsewhere.
		await (await h.open("v2")).page.activate();
		await closeSidePanel(h, panel);
		await h.control.goto("about:blank");
		expect(await extensionPages()).toEqual([]);
		const call = claude.callTool({
			name: "set_summary",
			arguments: { caseId, summary: "Written with the panel closed" },
		});
		// With no panel, the question is a notification: Allow, as its button
		// would (the worker's own handler; no extension page needed for it).
		const { targetId } = await h.browser.waitForTarget(
			(t) =>
				t.type === "service_worker" &&
				t.url === `chrome-extension://${h.extensionId}/background.js`,
		);
		const w = await h.browser.attach(targetId);
		const [question] = await until(
			() => w.eval<Record<string, unknown>>("chrome.notifications.getAll()"),
			(all) => Object.keys(all).length > 0,
			10_000,
		).then(Object.keys);
		// After the guard against a click that came too soon.
		await Bun.sleep(600);
		await w.eval(`siteglossNotificationButton(${JSON.stringify(question)}, 0)`);
		const result = await call;
		expect((result as { isError?: boolean }).isError).toBeFalsy();
		const written = await until(
			() => caseIn(FILE),
			(c) => c?.verdict === "Written with the panel closed",
			15_000,
		);
		expect(written?.id).toBe(caseId);
		expect(await extensionPages()).toEqual([]);

		// The case without marks was not written, while everything else was.
		expect(await Bun.file(downloaded(PAGE_FILE)).exists()).toBe(false);
		// Chrome stops a worker once it has been idle a while, not in the
		// middle of a run: the file is there before the worker has recorded
		// it, and a worker stopped then writes the case again, after the
		// page's (newer) one, whose entry it then takes out of the list. So
		// the run is over first: recorded, nothing pending, no offscreen
		// document.
		await until(
			async () => ({
				status: await w.eval<{ state?: string } | null>(SYNC_GET("status")),
				pending: await w.eval<unknown>(SYNC_GET("downloads:pending")),
				offscreen: (await h.browser.targets()).some((t) =>
					t.url.startsWith(`chrome-extension://${h.extensionId}/offscreen/`),
				),
			}),
			(s) => s.status?.state === "synced" && s.pending === null && !s.offscreen,
			10_000,
		);

		// The worker stopped, as Chrome stops an idle one; the first mark on
		// the page goes into its case and starts a new one, which writes the
		// case's first file with no extension page open either.
		await h.browser.send("Target.closeTarget", { targetId });
		await until(
			() => h.browser.targets(),
			(targets) => !targets.some((t) => t.targetId === targetId),
		);
		await later.page.activate();
		await markElement(later.page, "[data-truth=submit]", "Fresh worker");
		await later.page.waitFor(
			`${shadow('[data-role="status"]')}?.textContent.startsWith("Mark 1 added")`,
			20_000,
		);
		const fresh = await until(
			() => caseIn(PAGE_FILE),
			(c) => c !== undefined,
			20_000,
		);
		expect(fresh?.id).toBe(laterCase);
		expect(fresh?.marks.map((a) => a.comment)).toEqual(["Fresh worker"]);
		expect(await extensionPages()).toEqual([]);
		await later.page.send("Page.close");

		await h.control.goto(PANEL_PAGE(h));
		// Overwritten in place, no "(1)" copy; one entry left in the list, the newest.
		await until(downloadList, (list) => list.length === 1);
		expect(await downloadList()).toEqual([downloaded(PAGE_FILE)]);

		// Renamed in the panel: the same file is written again, under the name
		// it was first written under; no second file (review of PR 57).
		const item = `document.querySelector('[data-case="${laterCase}"]')`;
		await h.control.waitFor(item);
		await h.control.eval(`${item}.click()`);
		await renameInPanel(h.control, laterCase, "Checkout contrast");
		const renamed = await until(
			() => caseIn(PAGE_FILE),
			(c) => c?.title === "Checkout contrast",
			20_000,
		);
		expect(renamed?.id).toBe(laterCase);
		expect(
			await Bun.file(downloaded("checkout-contrast.sitegloss.zip")).exists(),
		).toBe(false);
		await h.control.eval(`document.getElementById("back").click()`);
		await h.control.waitFor(`!document.getElementById("home").hidden`);
		expect((await caseIn(FILE))?.verdict).toBe("Written with the panel closed");
		panel = await openSidePanel(h);
	}, 90_000);

	test("a paused folder shows the banner on Home and in the case, and “!” on the icon", async () => {
		await panel.eval(SYNC_KV("test:access", "prompt"));
		await panel.eval(
			`${FOLDER_HANDLE}.then((dir) => window.siteglossUseFolder(dir))`,
		);
		await panel.waitFor(`!${BANNER}.hidden`, 10_000);
		expect(await panel.eval(`${BANNER}.querySelector("p").textContent`)).toBe(
			`The copy to a folder is paused. Chrome needs your OK to write to “${FOLDER}” again.`,
		);
		expect(await panel.eval(`${BANNER}.getAttribute("role")`)).toBe("status");
		expect(await panel.eval(SYNC_STATE)).toBe(
			`Paused: Chrome wants your OK for “${FOLDER}” again.`,
		);
		await until(badge, (b) => b === "!");
		expect(await title()).toBe(
			"Sitegloss: the copy to a folder is paused. Click to allow access. AI access is on.",
		);

		await openCase(panel, "Synced case");
		expect(await panel.eval(`${BANNER}.hidden`)).toBe(false);
		expect(await panel.eval(`Boolean(${IN_BANNER("sync-allow")})`)).toBe(true);
		// Nothing was written to the folder.
		expect(await panel.eval(FOLDER_FILES)).toEqual([]);
	}, 60_000);

	test("Allow access (Chrome's answer stubbed) clears the banner and the “!”", async () => {
		// Chrome's prompt cannot be answered here: "granted", as a yes would be.
		await panel.eval(`(() => {
			FileSystemHandle.prototype.requestPermission = async function () {
				await ${SYNC_KV("test:access")};
				return "granted";
			};
		})()`);
		await panel.click(IN_BANNER("sync-allow"));
		await panel.waitFor(`${BANNER}.hidden`, 10_000);
		await until(badge, (b) => b === "");
		expect(await title()).toBe("Sitegloss: AI access is on");
		await until(
			() => panel.eval<string[]>(FOLDER_FILES),
			(files) => files.includes(FILE),
			10_000,
		);
	}, 60_000);

	test("Use Downloads instead switches; the folder's files stay", async () => {
		await panel.eval(SYNC_KV("test:access", "prompt"));
		await panel.eval(RUN);
		await panel.waitFor(`!${BANNER}.hidden`, 10_000);
		await until(badge, (b) => b === "!");
		await panel.click(IN_BANNER("sync-use-downloads"));
		await panel.waitFor(`${BANNER}.hidden`, 10_000);
		await until(badge, (b) => b === "");
		// Home, in the control page: the section says where it syncs now.
		await h.control.waitFor(
			`${SYNC_STATE} === "Copying to Downloads/Sitegloss"`,
			10_000,
		);
		expect(await panel.eval<string[]>(FOLDER_FILES)).toContain(FILE);
		await panel.eval(SYNC_KV("test:access"));
	}, 60_000);

	test("a deleted case keeps its file; after Stop syncing nothing more is written", async () => {
		const home = await panelHome(h);
		await openCase(home, "Synced case");
		const del = `document.getElementById("delete-case")`;
		await h.control.click(del);
		await h.control.waitFor(`${del}?.textContent === "Really delete?"`);
		await Bun.sleep(600); // a confirming click this soon counts as a double-click
		await h.control.click(del);
		await until(
			() => h.control.eval<Db>(READ_DB),
			(db) => !db.cases.some((c) => c.title === "Synced case"),
		);
		await Bun.sleep(1000);
		expect((await caseIn(FILE))?.verdict).toBe("Written with the panel closed");

		await h.control.goto(PANEL_PAGE(h));
		await h.control.waitFor(IN_SYNC("sync-stop"), 10_000);
		await h.control.click(IN_SYNC("sync-stop"));
		await h.control.waitFor(`${SYNC_STATE} === "Off."`);
		const { page, tabId } = await h.open("v1");
		await showToolbar(h, page, tabId);
		await markElement(page, "[data-truth=submit]", "Again");
		await saveAs(page, "Not synced");
		await page.send("Page.close");
		await until(
			() => h.control.eval<Db>(READ_DB),
			(db) => db.cases.some((c) => c.title === "Not synced"),
		);
		await Bun.sleep(1000);
		expect(
			await Bun.file(downloaded("not-synced.sitegloss.zip")).exists(),
		).toBe(false);
	}, 60_000);
});
