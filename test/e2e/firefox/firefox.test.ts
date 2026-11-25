/**
 * End to end in Firefox: the Firefox build in a headless Firefox, through
 * the ff-rdp CLI (`harness.ts`). Deliberately small, beside the Chromium
 * suite (`test/e2e/*.test.ts`), which stays the thorough one: what is
 * Firefox's own or most likely to break there, one test each.
 *
 * Skipped without ff-rdp and Firefox (`FF_RDP_PATH`, `FIREFOX_PATH`, or
 * where they are installed); required in CI.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
	startTestRelay,
	type TestRelay,
	tokenFor,
} from "@ractive-ch/tab-mcp/testing";
import { MAX_SIDE } from "../../../src/lib/images.ts";
import { cropRectFor } from "../../../src/lib/save.ts";
import { readZip } from "../../../src/lib/zip.ts";
import { E2E_FULL } from "../mode.ts";
import {
	backgroundLog,
	clickButton,
	draw,
	drawOnly,
	FIELD_FRAME,
	type FirefoxHarness,
	firefoxReady,
	LOCK_WAIT_MS,
	marksInPanel,
	newCase,
	PANEL_TEXT,
	readCase,
	type StoredCase,
	startFirefox,
	toHome,
	typeInField,
} from "./harness.ts";

/** The page the tests mark: the fixture's first version, on the local server. */
const TITLE = "Krankenkasse vergleichen (v1)";

/** Within `slack` of `want`: rounding at a fractional device pixel ratio. */
const near = (got: number, want: number, slack = 2) =>
	Math.abs(got - want) <= slack;

/**
 * Every shot of `c` is its viewport in device pixels, and every mark's crop
 * is its rectangle grown as the overlay grows it (`cropRectFor`), in device
 * pixels, at most MAX_SIDE long. Returns what does not hold.
 */
function sizeProblems(c: StoredCase): string[] {
	const problems: string[] = [];
	for (const shot of c.shots) {
		const size = c.sizes[shot.image];
		const { width, height, dpr } = shot.viewport;
		if (
			size === undefined ||
			!near(size.width, width * dpr) ||
			!near(size.height, height * dpr)
		)
			problems.push(
				`shot ${shot.id}: ${JSON.stringify(size)} for ${width}×${height} at ${dpr}`,
			);
	}
	for (const a of c.marks) {
		const shot = c.shots.find((s) => s.id === a.shot);
		const size = c.sizes[a.crop];
		if (
			shot === undefined ||
			a.shape.rect === undefined ||
			size === undefined
		) {
			problems.push(`mark ${a.number}: no shot, rectangle or crop`);
			continue;
		}
		const { dpr } = shot.viewport;
		const crop = cropRectFor(a.shape.rect, shot.viewport);
		const scale = Math.min(
			1,
			MAX_SIDE / Math.max(crop.width * dpr, crop.height * dpr),
		);
		if (
			!near(size.width, crop.width * dpr * scale, 3) ||
			!near(size.height, crop.height * dpr * scale, 3)
		)
			problems.push(
				`mark ${a.number}: crop ${size.width}×${size.height}, expected ${Math.round(crop.width * dpr * scale)}×${Math.round(crop.height * dpr * scale)}`,
			);
	}
	return problems;
}

/** The files in `dir` (none if it does not exist), but `.keep`. */
const filesIn = (dir: string) =>
	existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".keep") : [];

/** Until `test()` holds, or `ms` have passed (then it throws, naming `what`). */
async function until(
	test: () => boolean,
	what: string,
	ms = 15_000,
): Promise<void> {
	const end = Date.now() + ms;
	while (!test()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(100);
	}
}

/**
 * The time a start may take: the wait for another run's lock, then the
 * build and Firefox's start (two minutes). A start the hook gave up on goes
 * on, and is stopped once it is there (`stopStarted`).
 */
const START_TIMEOUT_MS = LOCK_WAIT_MS + 120_000;
/** Enough for a start the hook gave up on to finish, and to stop it. */
const STOP_TIMEOUT_MS = 180_000;

/** Stop the Firefox a start made, also one still under way when the hook timed out. */
async function stopStarted(
	starting: Promise<FirefoxHarness> | undefined,
): Promise<void> {
	// A failed start cleaned up after itself.
	const started = await starting?.catch(() => undefined);
	await started?.stop();
}

describe.skipIf(!firefoxReady || !E2E_FULL)("Firefox: the test build", () => {
	let h: FirefoxHarness;
	let starting: Promise<FirefoxHarness> | undefined;
	let relay: TestRelay | undefined;

	beforeAll(async () => {
		starting = startFirefox("test");
		h = await starting;
	}, START_TIMEOUT_MS);

	afterAll(async () => {
		await relay?.stop();
		await stopStarted(starting);
	}, STOP_TIMEOUT_MS);

	test("installs with no manifest warning, and the event page starts without an error", async () => {
		expect(h.warnings).toEqual([]);
		expect(await backgroundLog(h)).toEqual([]);
		// The event page's address is what the panel takes the background's
		// messages from (BACKGROUND_PAGE, DEC-050's review).
		expect(
			await h.rdp.eval<boolean>(
				h.panel,
				'browser.runtime.getBackgroundPage().then((w) => w.location.href === chrome.runtime.getURL("_generated_background_page.html"))',
			),
		).toBe(true);
		// Firefox's words: the panel is a sidebar there.
		expect(
			await h.rdp.eval<string>(
				h.panel,
				"document.getElementById('ai-button').title",
			),
		).not.toContain("Chrome");
	});

	test("a case with an element mark and a box: its screenshots and crops have the right sizes", async () => {
		await newCase(h);
		await draw(h, { tool: "element", selector: "h1", comment: "The title" });
		await marksInPanel(h, 1);
		await draw(h, {
			tool: "box",
			selector: "main section p",
			comment: "This text",
		});
		await marksInPanel(h, 2);
		const c = await readCase(h, TITLE);
		expect(c.marks.map((a) => [a.shape.kind, a.comment])).toEqual([
			["element", "The title"],
			["box", "This text"],
		]);
		expect(sizeProblems(c)).toEqual([]);
	}, 60_000);

	test("the dialog's comment field is a frame of the extension's own: focus on open, typing, Ctrl+Enter, Escape, and the page hears none of it (DEC-064)", async () => {
		await h.rdp.eval(
			h.page,
			`(() => {
				window.heard = [];
				for (const type of ["keydown", "keyup", "beforeinput", "input", "paste"])
					window.addEventListener(type, (e) => window.heard.push(type), true);
				return true;
			})()`,
		);
		await newCase(h);
		const key = (k: string, mod: boolean) =>
			h.rdp.evalInFrame(
				h.page,
				FIELD_FRAME,
				`document.getElementById("field").dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, ctrlKey: ${mod}, bubbles: true, cancelable: true }))`,
			);
		const open = `!!document.getElementById("sitegloss-root").shadowRoot.querySelector(".popover iframe.field")`;
		await drawOnly(h, { tool: "element", selector: "h1", comment: "" });
		expect(await typeInField(h, "Typed in Firefox")).toBe(true);
		await key("Enter", true);
		await h.rdp.waitFor(
			h.page,
			`!(${open})`,
			"the dialog closed by Ctrl+Enter",
		);
		await marksInPanel(h, 1);
		await drawOnly(h, {
			tool: "box",
			selector: "main section p",
			comment: "",
		});
		await typeInField(h, "Closed with Escape");
		await key("Escape", false);
		await h.rdp.waitFor(h.page, `!(${open})`, "the dialog closed by Escape");
		await marksInPanel(h, 2);
		const c = await readCase(h, TITLE);
		expect(c.marks.map((a) => a.comment)).toEqual([
			"Typed in Firefox",
			"Closed with Escape",
		]);
		expect(await h.rdp.eval<string[]>(h.page, "window.heard")).toEqual([]);
	}, 60_000);

	test("at 150 % zoom too", async () => {
		const tabId = await h.rdp.eval<number>(
			h.panel,
			`chrome.tabs.query({ active: true, windowId: ${h.windowId} }).then(([t]) => t.id)`,
		);
		await h.rdp.eval(h.panel, `chrome.tabs.setZoom(${tabId}, 1.5)`);
		try {
			await h.rdp.waitFor(h.page, "devicePixelRatio > 1.4", "the zoom");
			await newCase(h);
			await draw(h, {
				tool: "element",
				selector: "button[type=submit]",
				comment: "Zoomed button",
			});
			await draw(h, {
				tool: "box",
				selector: "main section h2",
				comment: "Zoomed box",
			});
			await marksInPanel(h, 2);
			const c = await readCase(h, TITLE);
			expect(c.marks.map((a) => a.comment)).toEqual([
				"Zoomed button",
				"Zoomed box",
			]);
			expect(c.shots[0]?.viewport.dpr).toBeGreaterThan(1.4);
			expect(sizeProblems(c)).toEqual([]);
		} finally {
			await h.rdp.eval(h.panel, `chrome.tabs.setZoom(${tabId}, 1)`);
			await h.rdp.waitFor(h.page, "devicePixelRatio < 1.1", "zoom 100 %");
		}
	}, 60_000);

	test("after a reload the open case's marks are found again", async () => {
		// The zoomed case is open in the panel, its marks drawn on the page.
		await h.rdp.waitFor(
			h.panel,
			`/2 of 2 marks found/.test(${PANEL_TEXT})`,
			"the marks found before the reload",
		);
		await h.rdp.run(["--tab", h.page, "reload"]);
		await h.rdp.waitFor(
			h.page,
			"document.readyState === 'complete' && document.getElementById('sitegloss-root') !== null",
			"the page again, with the overlay",
		);
		await h.rdp.waitFor(
			h.panel,
			`/2 of 2 marks found/.test(${PANEL_TEXT})`,
			"the marks found after the reload",
			20_000,
		);
		const drawn = await h.rdp.eval<number>(
			h.page,
			"document.getElementById('sitegloss-root').shadowRoot.querySelectorAll('.marks > *').length",
		);
		expect(drawn).toBeGreaterThan(0);
	}, 60_000);

	test("export, and import as a copy", async () => {
		// Export is in the case's … menu (DEC-061).
		await h.rdp.eval(h.panel, `document.getElementById("case-more").click()`);
		await clickButton(h, "Export…");
		let file = "";
		await until(() => {
			file =
				filesIn(h.downloads).find((f) => f.endsWith(".sitegloss.zip")) ?? "";
			return file !== "" && statSync(join(h.downloads, file)).size > 0;
		}, "the exported file");
		const bytes = await Bun.file(join(h.downloads, file)).bytes();
		// Import is on Home, and asks there.
		await toHome(h);
		await h.rdp.eval(
			h.panel,
			`(() => {
				const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))}), (c) => c.charCodeAt(0));
				const input = document.getElementById("import-file");
				const files = new DataTransfer();
				files.items.add(new File([bytes], "case.sitegloss.zip", { type: "application/zip" }));
				input.files = files.files;
				input.dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			})()`,
		);
		// The case is here already: Keep both.
		await h.rdp.waitFor(
			h.panel,
			`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Keep both")`,
			"the import's question",
		);
		await clickButton(h, "Keep both");
		await h.rdp.waitFor(
			h.panel,
			`/\\(copy\\)/.test(${PANEL_TEXT})`,
			"the copy in the panel",
		);
		const copy = await readCase(h, `${TITLE} (copy)`);
		expect(copy.marks.map((a) => a.comment)).toEqual([
			"Zoomed button",
			"Zoomed box",
		]);
		expect(sizeProblems(copy)).toEqual([]);
	}, 60_000);

	test("sync to Downloads writes each case, and overwrites its file after a change", async () => {
		const folder = join(h.downloads, "Sitegloss");
		const synced = () =>
			filesIn(folder).filter((f) => f.endsWith(".sitegloss.zip"));
		/** The marks in a synced file's case.json; -1 while it cannot be read. */
		const marksIn = async (file: string) => {
			try {
				const files = await readZip(await Bun.file(join(folder, file)).bytes());
				const json = files.get("case.json");
				if (json === undefined) return -1;
				return (
					JSON.parse(new TextDecoder().decode(json)) as {
						marks: unknown[];
					}
				).marks.length;
			} catch {
				return -1;
			}
		};
		// On Home: every case so far gets a file of its own.
		await toHome(h);
		// As many as the tests before made.
		const cases = await h.rdp.eval<number>(
			h.panel,
			`document.querySelectorAll("button[data-case]").length`,
		);
		expect(cases).toBeGreaterThan(0);
		await clickButton(h, "Copy to Downloads");
		await until(
			() => synced().length === cases,
			`${cases} synced files`,
			30_000,
		);
		const before = new Set(synced());

		// A new case: one more file; a second mark: the same file again.
		await newCase(h);
		await draw(h, { tool: "element", selector: "h1", comment: "Synced" });
		await marksInPanel(h, 1);
		let file = "";
		await until(
			() => {
				file = synced().find((f) => !before.has(f)) ?? "";
				return file !== "";
			},
			"the new case's file",
			30_000,
		);
		const end = Date.now() + 30_000;
		while ((await marksIn(file)) !== 1) {
			if (Date.now() > end) throw new Error("the file never had the mark");
			await Bun.sleep(200);
		}
		await draw(h, {
			tool: "box",
			selector: "main section p",
			comment: "Synced box",
		});
		await marksInPanel(h, 2);
		while ((await marksIn(file)) !== 2) {
			if (Date.now() > end + 30_000)
				throw new Error("the file was not written again");
			await Bun.sleep(200);
		}
		// Overwritten in place: no "(1)" copy beside it.
		expect(synced().sort()).toEqual([...before, file].sort());
		// Firefox's download list keeps only the newest of the sync's entries.
		// The worker erases the entry before it once the new one is done.
		await h.rdp.waitFor(
			h.panel,
			"chrome.downloads.search({}).then((all) => all.filter((d) => /[\\\\/]Sitegloss[\\\\/]/.test(d.filename)).length === 1)",
			"one entry of the sync's in the download list",
		);
	}, 120_000);

	test("AI access: a read tool, a question answered in the panel, still connected after a while idle", async () => {
		relay = startTestRelay();
		const url = relay.url;
		await h.rdp.run(["--tab", h.panel, "navigate", h.panelUrl]);
		await h.rdp.waitFor(
			h.panel,
			"document.documentElement.dataset.aiState === 'disconnected'",
			"the panel",
		);
		// The control: with AI access off nothing keeps the event page, and
		// this profile stops it after 3 s idle (its user.js). Else the wait
		// below would prove nothing about the keepalive.
		const timeOrigin = () =>
			h.rdp.eval<number>(
				h.panel,
				"browser.runtime.getBackgroundPage().then((bg) => bg.performance.timeOrigin)",
			);
		const idleBefore = await timeOrigin();
		await Bun.sleep(5000);
		expect(await timeOrigin()).not.toBe(idleBefore);
		await h.rdp.eval(
			h.panel,
			`(() => {
				const relay = document.getElementById("relay");
				relay.value = ${JSON.stringify(url)};
				relay.dispatchEvent(new Event("change"));
				document.getElementById("ai-button").click();
				return true;
			})()`,
		);
		const address = await h.rdp.waitFor<string>(
			h.panel,
			"document.documentElement.dataset.aiState === 'connected' && document.getElementById('pair-address').textContent",
			"AI access connected",
			20_000,
		);
		expect(address).toContain(url);
		const token = await tokenFor(relay, address);
		const client = new Client(
			{ name: "firefox-e2e", version: "1.0.0" },
			{ versionNegotiation: { mode: { pin: "2026-07-28" } } },
		);
		await client.connect(
			new StreamableHTTPClientTransport(new URL(address), {
				requestInit: { headers: { Authorization: `Bearer ${token}` } },
			}),
		);
		try {
			const listed = await client.callTool({
				name: "list_cases",
				arguments: {},
			});
			// One case per line, as JSON (DEC-081).
			const cases = ((listed.content as { text: string }[])[0]?.text ?? "")
				.split("\n")
				.filter((line) => line.startsWith("{"))
				.map((line) => JSON.parse(line)) as { caseId: string; title: string }[];
			const target = cases.find((c) => c.title === `${TITLE} (copy)`);
			expect(target).toBeDefined();

			// A change asks; Allow counts only in a panel with the focus, so its
			// window comes to the front for the answer (and the page's after:
			// the tools act on the tab in front of the last focused window).
			const verdict = client.callTool({
				name: "set_summary",
				arguments: { caseId: target?.caseId, summary: "From Firefox" },
			});
			await h.rdp.waitFor(
				h.panel,
				"document.querySelector('[data-question]') !== null",
				"the question in the panel",
			);
			await h.rdp.eval(
				h.panel,
				"chrome.tabs.getCurrent().then((t) => chrome.windows.update(t.windowId, { focused: true })).then(() => true)",
			);
			const allow = `document.querySelector('[data-question] button[data-answer="allow"]')`;
			await h.rdp.waitFor(h.panel, `!${allow}.disabled`, "Allow to count");
			await h.rdp.eval(h.panel, `${allow}.click()`);
			const result = (await verdict) as { isError?: boolean };
			expect(result.isError).toBeFalsy();
			await h.rdp.eval(
				h.panel,
				`chrome.windows.update(${h.windowId}, { focused: true }).then(() => true)`,
			);
			// The summary for the developer is the case's `verdict` (DEC-019).
			expect((await readCase(h, `${TITLE} (copy)`)) as unknown).toMatchObject({
				verdict: "From Firefox",
			});

			// Firefox stops an event page that had no extension events for a
			// while (30 s; 3 s in this profile), its WebSocket with it, unless
			// something keeps it.
			const started = await timeOrigin();
			await Bun.sleep(8000);
			expect(await timeOrigin()).toBe(started);
			expect(
				await h.rdp.eval<string>(
					h.panel,
					"document.documentElement.dataset.aiState",
				),
			).toBe("connected");
			const again = await client.callTool({
				name: "list_cases",
				arguments: {},
			});
			expect(again.isError).toBeFalsy();
		} finally {
			await client.close();
		}
	}, 120_000);

	test("a picture opens in a window of its own, a popup, and Close closes it (DEC-064)", async () => {
		await newCase(h);
		await draw(h, { tool: "element", selector: "h1", comment: "Seen large" });
		await marksInPanel(h, 1);
		await h.rdp.eval(
			h.panel,
			`(() => { const t = document.querySelector("li.mark .mark-toggle"); if (!document.querySelector("li.mark[data-open]")) t.click(); return true; })()`,
		);
		await h.rdp.waitFor(
			h.panel,
			`document.querySelector('li.mark[data-open] [data-picture="screenshot"] [data-action="open-larger"]') !== null`,
			"the mark's picture tile",
			30_000,
		);
		await h.rdp.eval(
			h.panel,
			`document.querySelector('li.mark[data-open] [data-picture="screenshot"] [data-action="open-larger"]').click()`,
		);
		const viewers = `browser.windows.getAll({ populate: true }).then((ws) => ws.filter((w) => w.tabs.some((t) => (t.url ?? "").includes("/viewer/index.html"))).map((w) => w.type + " " + w.tabs.length))`;
		expect(
			await h.rdp.waitFor<string[]>(
				h.panel,
				`${viewers}.then((v) => v.length > 0 && v)`,
				"the viewer's window",
			),
		).toEqual(["popup 1"]);
		await h.rdp.waitFor(
			"/viewer/index.html",
			`!document.getElementById("picture").hidden`,
			"the picture in the viewer",
		);
		await h.rdp.eval(
			"/viewer/index.html",
			`document.getElementById("close").click()`,
		);
		await h.rdp.waitFor(
			h.panel,
			`${viewers}.then((v) => v.length === 0)`,
			"the viewer's window closed",
		);
	}, 60_000);

	test("the event page logged no error all along", async () => {
		expect(await backgroundLog(h)).toEqual([]);
	});
});

describe.skipIf(!firefoxReady || !E2E_FULL)(
	"Firefox: the store package",
	() => {
		let h: FirefoxHarness;
		let starting: Promise<FirefoxHarness> | undefined;

		beforeAll(async () => {
			starting = startFirefox("store");
			h = await starting;
		}, START_TIMEOUT_MS);

		afterAll(async () => {
			await stopStarted(starting);
		}, STOP_TIMEOUT_MS);

		test("installs with no manifest warning; its panel's page in a tab is no panel", async () => {
			expect(h.warnings).toEqual([]);
			expect(await h.rdp.eval<string>(h.panel, PANEL_TEXT)).toContain(
				"Open the sidebar from the Sitegloss icon for AI access",
			);
			expect(
				await h.rdp.eval<boolean>(
					h.panel,
					"document.getElementById('connect').disabled",
				),
			).toBe(true);
			// The event page closes a port from it at once, and tells it nothing.
			expect(
				await h.rdp.eval<string>(
					h.panel,
					`new Promise((resolve) => {
					const port = chrome.runtime.connect({ name: "ai" });
					let told = false;
					port.onMessage.addListener(() => { told = true; });
					port.onDisconnect.addListener(() => resolve(told ? "told" : "closed"));
					setTimeout(() => resolve("still open"), 5000);
				})`,
				),
			).toBe("closed");
		}, 60_000);

		test("no host access at install: the offer of all sites first, the option on Home in Firefox's words (DEC-076)", async () => {
			expect(
				await h.rdp.eval<boolean>(
					h.panel,
					"chrome.permissions.contains({ origins: ['<all_urls>'] })",
				),
			).toBe(false);
			await h.rdp.waitFor(
				h.panel,
				"!document.getElementById('all-sites-offer').hidden",
				"the offer of all sites",
			);
			expect(
				await h.rdp.eval<unknown>(
					h.panel,
					`(() => {
						const box = document.getElementById("all-sites");
						return {
							home: box.closest("main").id,
							checked: box.checked,
							note: document.getElementById("all-sites-note").textContent.includes("“Access your data for all websites”"),
						};
					})()`,
				),
			).toEqual({ home: "home", checked: false, note: true });
		}, 60_000);
	},
);
