/**
 * End to end: the sync (DEC-021, DEC-025). "Copy to Downloads" writes each
 * case to `Sitegloss/` in the profile's downloads folder (the test build has
 * `downloads`, so Chrome asks nothing), and the worker writes it again after
 * an AI app's change with no extension page open, through its offscreen
 * document. A folder paused for Chrome's OK, its banner, the icon's "!",
 * Allow access and Use Downloads instead are unit tests (sync.test.ts,
 * view.test.ts, icon.test.ts): Chrome's folder picker and its prompt cannot
 * be answered here, so a browser added nothing to them.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
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
import {
	browserBinary,
	type Harness,
	inBothSets,
	PAST_GUARD_MS,
	startHarness,
} from "./harness.ts";
import { fullTest } from "./mode.ts";
import {
	type Db,
	markElement,
	READ_DB,
	saveAs,
	shadow,
	showToolbar,
	until,
} from "./steps.ts";

const FILE = "synced-case.sitegloss.zip";

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

inBothSets("the sync", () => {
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

	fullTest(
		"with no extension page open, an AI app's change is written again by the worker, and a save by a worker started anew",
		async () => {
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
			await Bun.sleep(PAST_GUARD_MS);
			await w.eval(
				`siteglossNotificationButton(${JSON.stringify(question)}, 0)`,
			);
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
				(s) =>
					s.status?.state === "synced" && s.pending === null && !s.offscreen,
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

			expect((await caseIn(FILE))?.verdict).toBe(
				"Written with the panel closed",
			);
			panel = await openSidePanel(h);
			// It may open in the case the tab in front shows (DEC-023): Home, for
			// the tests after.
			await panel.eval(
				`document.getElementById("back").hidden || document.getElementById("back").click()`,
			);
			await panel.waitFor(`!document.getElementById("home").hidden`);
		},
		90_000,
	);
});
