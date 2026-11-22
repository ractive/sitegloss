/**
 * The Firefox end-to-end setup: a Firefox build of the extension, a server
 * for the test pages, and a headless Firefox with a profile of its own on a
 * free debug port, the build installed as a temporary add-on, all through
 * `ff-rdp` (`ffrdp.ts`).
 *
 * The test build's layout: Firefox's sidebar is out of automation's reach,
 * so the panel's page runs in the first window's tab, for the page's window
 * (`sidepanel/index.html?window=<id>`, which only that build honours), and
 * the page in a window of its own. Both are tabs ff-rdp reaches by a part of
 * their address. The panel's tab also reaches the event page, through
 * `runtime.getBackgroundPage()`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, FIREFOX_ID } from "../../../scripts/build.ts";
import { DB_VERSION } from "../../../src/lib/store.ts";
import { FfRdp, findFfRdp, findFirefox, freePort, takeLock } from "./ffrdp.ts";

export const ffRdpBinary = findFfRdp();
export const firefoxBinary = findFirefox();
/** Both there: the tests run; else they are skipped (failed in CI). */
export const firefoxReady =
	ffRdpBinary !== undefined && firefoxBinary !== undefined;

if (!firefoxReady && process.env["CI"])
	throw new Error(
		`ff-rdp and Firefox are needed for the Firefox end-to-end tests in CI (ff-rdp: ${ffRdpBinary ?? "not found, set FF_RDP_PATH"}; Firefox: ${firefoxBinary ?? "not found, set FIREFOX_PATH"})`,
	);

/**
 * How long a start waits for another run's lock (a whole run takes about a
 * minute); the tests' hooks wait longer than this for a start.
 */
export const LOCK_WAIT_MS = 5 * 60_000;

export interface FirefoxHarness {
	rdp: FfRdp;
	/** `http://127.0.0.1:<port>` serving `test/e2e/pages/`. */
	base: string;
	/** The add-on's UUID: its pages are at `moz-extension://<uuid>/`. */
	uuid: string;
	/** What Firefox said about the manifest when it installed the build. */
	warnings: unknown[];
	/** The profile's downloads folder. */
	downloads: string;
	/** The page's window (the test build's layout). */
	windowId: number;
	/** ff-rdp's `--tab` for the panel's tab and for the page's. */
	panel: string;
	page: string;
	/** The panel's page in the panel's tab, as automation sees it. */
	panelUrl: string;
	stop(): Promise<void>;
}

function servePages(): ReturnType<typeof Bun.serve> {
	const pages = join(import.meta.dir, "..", "pages");
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const path = new URL(req.url).pathname.replace(/^\/+/, "") || "v1.html";
			const file = Bun.file(join(pages, path));
			if (path.includes("..") || !(await file.exists()))
				return new Response("not found", { status: 404 });
			return new Response(file, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
}

/** The profile's prefs: downloads into `downloads`, no tabs from a last run. */
export function userJs(downloads: string): string {
	const prefs: Record<string, string | number | boolean> = {
		"browser.download.dir": downloads,
		"browser.download.folderList": 2,
		"browser.download.useDownloadDir": true,
		"browser.sessionstore.resume_from_crash": false,
		"browser.shell.checkDefaultBrowser": false,
		"datareporting.policy.dataSubmissionEnabled": false,
		"toolkit.telemetry.reportingpolicy.firstRun": false,
	};
	return `${Object.entries(prefs)
		.map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
		.join("\n")}\n`;
}

/**
 * Start Firefox with the Firefox build: `test` (the test build, in the
 * layout above) or `store` (the package for addons.mozilla.org, its panel's
 * page alone in the one tab). Holds the tests' lock until `stop`, which
 * also stops Firefox and removes what this made; a start that fails cleans
 * up the same way.
 */
export async function startFirefox(
	kind: "test" | "store",
): Promise<FirefoxHarness> {
	if (ffRdpBinary === undefined) throw new Error("no ff-rdp");
	const unlock = await takeLock(LOCK_WAIT_MS);
	const root = mkdtempSync(join(tmpdir(), "sitegloss-firefox-"));
	const outdir = join(root, "dist");
	const profile = join(root, "profile");
	const downloads = join(root, "downloads");
	const rdp = new FfRdp(ffRdpBinary, freePort());
	let server: ReturnType<typeof Bun.serve> | undefined;
	const stop = async () => {
		await rdp.stop();
		await server?.stop(true);
		rmSync(root, { recursive: true, force: true });
		unlock();
	};
	try {
		await build({
			outdir,
			firefox: true,
			...(kind === "test" ? { test: true, minify: false } : { store: true }),
		});
		await Bun.write(join(profile, "user.js"), userJs(downloads));
		await Bun.write(join(downloads, ".keep"), "");
		server = servePages();
		const base = `http://127.0.0.1:${server.port}`;
		const page = `127.0.0.1:${server.port}/`;
		await rdp.run(
			[
				"launch",
				"--headless",
				"--profile",
				profile,
				"--debug-port",
				String(rdp.port),
				"--window-size",
				"1280x900",
				"--temporary-addon",
				outdir,
				`${base}/v1.html`,
			],
			{ timeoutMs: 60_000 },
		);
		const addons = (await rdp.run(["addon", "list"])) as {
			id: string;
			uuid?: string;
			warnings?: unknown[];
		}[];
		const addon = addons.find((a) => a.id === FIREFOX_ID);
		if (addon?.uuid === undefined)
			throw new Error(`${FIREFOX_ID} is not installed`);
		const uuid = addon.uuid;
		const panelPage = `moz-extension://${uuid}/sidepanel/index.html`;
		await rdp.run(["--tab", page, "navigate", panelPage]);
		let windowId = -1;
		let panelUrl = panelPage;
		if (kind === "test") {
			windowId = await rdp.eval<number>(
				"moz-extension://",
				`chrome.windows.create({ url: ${JSON.stringify(`${base}/v1.html`)} }).then((w) => w.id)`,
			);
			panelUrl = `${panelPage}?window=${windowId}`;
			await rdp.run(["--tab", "moz-extension://", "navigate", panelUrl]);
			await rdp.waitFor(page, "document.readyState === 'complete'", "the page");
		}
		const harness: FirefoxHarness = {
			rdp,
			base,
			uuid,
			warnings: addon.warnings ?? [],
			downloads,
			windowId,
			panel: kind === "test" ? "index.html?window=" : "moz-extension://",
			page,
			panelUrl,
			stop,
		};
		// The panel has the worker's state: the event page started.
		await rdp.waitFor(
			harness.panel,
			"document.documentElement.dataset.aiState ?? document.querySelector('#ai-button')?.textContent.includes('only')",
			"the panel to hear from the event page",
		);
		return harness;
	} catch (error) {
		await stop();
		throw error;
	}
}

/**
 * The newest case in the extension's database, read in the panel's tab,
 * with the sizes of its images.
 */
export interface StoredCase {
	id: string;
	title: string;
	marks: {
		number: number;
		comment: string;
		shot: string;
		shape: {
			kind: string;
			rect?: { x: number; y: number; width: number; height: number };
		};
		crop: string;
	}[];
	shots: {
		id: string;
		image: string;
		viewport: { width: number; height: number; dpr: number };
	}[];
	/** Image path in the case → its width and height. */
	sizes: Record<string, { width: number; height: number }>;
}

/** The case titled `title` (the newest such), as `StoredCase`. */
export function readCase(
	h: FirefoxHarness,
	title?: string,
): Promise<StoredCase> {
	return h.rdp.eval<StoredCase>(
		h.panel,
		`new Promise((resolve, reject) => {
			const open = indexedDB.open("sitegloss", ${DB_VERSION});
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const db = open.result;
				const all = (store) => new Promise((done, fail) => {
					const out = [];
					const req = db.transaction(store).objectStore(store).openCursor();
					req.onerror = () => fail(req.error);
					req.onsuccess = () => {
						const c = req.result;
						if (!c) return done(out);
						out.push([c.key, c.value]);
						c.continue();
					};
				});
				all("cases").then(async (rows) => {
					const cases = rows.map(([, v]) => v)
						.filter((c) => ${JSON.stringify(title ?? null)} === null || c.title === ${JSON.stringify(title ?? null)})
						.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
					const c = cases[0];
					if (c === undefined) return resolve(null);
					const sizes = {};
					for (const [key, value] of await all("images"))
						if (String(key).startsWith(c.id + "/"))
							sizes[String(key).slice(c.id.length + 1)] = { width: value.width, height: value.height };
					db.close();
					resolve({ ...c, sizes });
				}, reject);
			};
		})`,
	);
}

/**
 * What the event page reported as wrong so far, each `error: …` or
 * `warn: …`: the test build's record in `storage.session`, which outlasts
 * the event pages Firefox stops when idle.
 */
export function backgroundLog(h: FirefoxHarness): Promise<string[]> {
	return h.rdp.eval<string[]>(
		h.panel,
		'chrome.storage.session.get("siteglossTestLog").then((s) => s.siteglossTestLog ?? [])',
	);
}

/** A mark to draw on the page with the toolbar. */
export type DrawJob =
	/** The Element tool on the first element `selector` matches. */
	| { tool: "element"; selector: string; comment: string }
	/** The Box tool around that element's middle, `width`×`height` CSS px. */
	| { tool: "box"; selector: string; comment: string; size?: number };

/**
 * Draw `job` on the page as a user would, with pointer events on the
 * overlay (the test build's shadow root is open), and finish its comment.
 * Firefox logs a setPointerCapture error for the events' made-up pointer.
 */
export function draw(h: FirefoxHarness, job: DrawJob): Promise<string> {
	return h.rdp.eval<string>(
		h.page,
		`(async () => {
			const job = ${JSON.stringify(job)};
			const root = document.getElementById("sitegloss-root")?.shadowRoot;
			if (!root) throw new Error("no overlay on the page");
			const until = async (test, what) => {
				for (let i = 0; i < 100; i++) {
					const v = test();
					if (v) return v;
					await new Promise((r) => setTimeout(r, 50));
				}
				throw new Error("no " + what);
			};
			const tool = await until(() => root.querySelector('[data-action="tool-' + job.tool + '"]'), "tool button");
			if (tool.getAttribute("aria-pressed") !== "true") tool.click();
			await until(() => tool.getAttribute("aria-pressed") === "true", "pressed tool");
			const el = document.querySelector(job.selector);
			el.scrollIntoView({ block: "center" });
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const r = el.getBoundingClientRect();
			let from, to;
			if (job.tool === "element") {
				from = to = [r.x + Math.min(12, r.width / 2), r.y + r.height / 2];
			} else {
				const half = (job.size ?? 120) / 2;
				const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
				from = [Math.max(2, cx - half), Math.max(2, cy - half / 2)];
				to = [Math.min(innerWidth - 20, cx + half), Math.min(innerHeight - 2, cy + half / 2)];
			}
			const capture = root.querySelector(".capture");
			const fire = (type, [x, y]) => capture.dispatchEvent(new PointerEvent(type, {
				bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y,
				pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
				buttons: type === "pointerup" ? 0 : 1,
			}));
			fire("pointermove", from);
			fire("pointerdown", from);
			for (let i = 1; i <= 5; i++)
				fire("pointermove", [from[0] + ((to[0] - from[0]) * i) / 5, from[1] + ((to[1] - from[1]) * i) / 5]);
			fire("pointerup", to);
			const field = await until(() => root.querySelector(".popover textarea"), "comment field");
			field.value = job.comment;
			field.dispatchEvent(new Event("input", { bubbles: true }));
			root.querySelector('[data-action="comment-done"]').click();
			return job.tool + " " + from.map(Math.round) + " " + to.map(Math.round);
		})()`,
	);
}

/** Click the first visible button whose text is `text` in the panel. */
export function clickButton(h: FirefoxHarness, text: string): Promise<unknown> {
	return h.rdp.eval(
		h.panel,
		`(() => {
			const b = [...document.querySelectorAll("button")].find((b) => b.offsetParent !== null && b.textContent.trim() === ${JSON.stringify(text)});
			if (!b) throw new Error("no button " + ${JSON.stringify(text)});
			b.click();
			return true;
		})()`,
	);
}

/** The panel's text, for waiting on what it says. */
export const PANEL_TEXT = "document.body.innerText";

/**
 * The panel's Home, its page loaded again: a toolbar still adding to a case
 * on the page opens that case in the panel (DEC-023), and "All cases"
 * finishes its marks.
 */
export async function toHome(h: FirefoxHarness): Promise<void> {
	await h.rdp.run(["--tab", h.panel, "navigate", h.panelUrl]);
	await h.rdp.waitFor(
		h.panel,
		`document.documentElement.dataset.aiState !== undefined &&
			(() => {
				const visible = (b) => b.offsetParent !== null;
				const back = [...document.querySelectorAll("button")].find((b) => visible(b) && b.textContent.trim() === "All cases");
				if (back) { back.click(); return false; }
				return visible(document.getElementById("new-case"));
			})()`,
		"the panel's Home",
	);
}

/** A new case for the page in front, from the panel's Home, with the toolbar on the page. */
export async function newCase(h: FirefoxHarness): Promise<void> {
	await toHome(h);
	await h.rdp.eval(h.panel, "document.getElementById('new-case').click()");
	await h.rdp.waitFor(
		h.page,
		`document.getElementById("sitegloss-root")?.shadowRoot?.querySelector('[data-action="tool-box"]') !== null && document.getElementById("sitegloss-root") !== null`,
		"the toolbar on the page",
	);
}

/** Until the open case in the panel says it has `n` marks. */
export function marksInPanel(h: FirefoxHarness, n: number): Promise<unknown> {
	return h.rdp.waitFor(
		h.panel,
		`/\\bMarks ${n}\\b/.test(${PANEL_TEXT})`,
		`${n} marks in the panel`,
		20_000,
	);
}
