/**
 * The end-to-end setup: a test build of the extension (or the store package,
 * `startShipped`), a server for the test pages, Chromium with the extension
 * loaded, and an extension page to call `chrome.*` APIs from (it stays alive,
 * unlike the service worker).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BuildOptions,
	type BuildResult,
	build,
} from "../../scripts/build.ts";
import { Browser, findBrowser, type Page } from "./browser.ts";
import { StepTimeout, step } from "./trace.ts";

// A timed-out test also loses the browser, and with it the rest of its file:
// on a busy machine a first screenshot alone can take longer than Bun's default.
// So `bun run test` sets `--timeout`; `setDefaultTimeout` in this module would
// reach only the first test file of a run, and `bunfig.toml` none at all.

export const browserBinary = findBrowser();

/**
 * The test build's guards against a click that comes too soon (a double
 * click's second, a yes the moment a question shows, a notification's
 * button) are 100 ms there (DEC-053): a test waits this long to be past one.
 */
export const PAST_GUARD_MS = 150;

/**
 * The step of the panel's searches again a test can set for itself, in the
 * panel's page: `globalThis.siteglossTestWaits = { searchAgainMs }`
 * (src/lib/test-waits.ts). The searches run at 0, 1 and 3 steps, so four
 * steps are past the last one.
 */
export const SEARCH_AGAIN_MS = 150;

if (browserBinary === undefined && process.env["CI"])
	throw new Error(
		"Chrome for Testing is needed for the end-to-end tests in CI",
	);

/**
 * The harness and tab of each page `open` opened: steps that act for the
 * user (saveAs) reach the side panel and the page's tab through it.
 */
export const opened = new WeakMap<Page, { h: Harness; tabId: number }>();

export interface Harness {
	browser: Browser;
	/** `http://127.0.0.1:<port>` serving `test/e2e/pages/`. */
	base: string;
	extensionId: string;
	manifest: BuildResult["manifest"];
	/** An extension page for calling `chrome.*` (the side panel's document, in a tab). */
	control: Page;
	/** Open a test page in a new tab and return it with its tab id. */
	open(path: string): Promise<{ page: Page; tabId: number }>;
	stop(): Promise<void>;
}

/**
 * Open an extension page to call `chrome.*` from, waiting for the extension
 * to be installed (after launch, or after `chrome.runtime.reload()`).
 */
export async function openControl(
	browser: Browser,
	extensionId: string,
): Promise<Page> {
	const control = await browser.newPage();
	for (let attempt = 0; ; attempt++) {
		try {
			await control.goto(
				`chrome-extension://${extensionId}/sidepanel/index.html`,
			);
			if (
				await control.eval<boolean>("typeof chrome?.tabs?.query === 'function'")
			)
				return control;
		} catch (error) {
			if (attempt >= 40) throw error;
		}
		if (attempt >= 40) throw new Error("extension pages have no chrome.tabs");
		await Bun.sleep(100);
	}
}

function servePages(): ReturnType<typeof Bun.serve> {
	const pages = join(import.meta.dir, "pages");
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const address = new URL(req.url);
			let path = address.pathname.replace(/^\/+/, "") || "v1";
			// `?wait=<ms>`: a page that takes that long to come (a slow site);
			// `slow/<page>`: 1.5 s, also at a case's address, which has no query.
			const wait = path.startsWith("slow/")
				? 1500
				: Number(address.searchParams.get("wait"));
			path = path.replace(/^slow\//, "");
			if (wait > 0) await Bun.sleep(Math.min(wait, 10_000));
			const file = Bun.file(
				join(pages, path.endsWith(".html") ? path : `${path}.html`),
			);
			if (!(await file.exists()) || path.includes(".."))
				return new Response("not found", { status: 404 });
			return new Response(file, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
}

/** What differs between the test build and the store package. */
interface Launch {
	options: BuildOptions;
	browser(outdir: string): Promise<Browser>;
	extensionId(
		browser: Browser,
		outdir: string,
		built: BuildResult,
	): Promise<string>;
	tabIdOf(control: Page, page: Page, url: string): Promise<number>;
}

async function start(binary: string, launch: Launch): Promise<Harness> {
	const outdir = mkdtempSync(join(tmpdir(), "sitegloss-dist-"));
	let server: ReturnType<typeof Bun.serve> | undefined;
	let browser: Browser | undefined;
	const cleanUp = async () => {
		await browser?.close();
		await server?.stop(true);
		rmSync(outdir, { recursive: true, force: true });
	};
	try {
		const built = await step(
			"build",
			() => build({ outdir, ...launch.options }),
			60_000,
		);
		server = servePages();
		const base = `http://127.0.0.1:${server.port}`;
		// Chrome is not Sitegloss: a start that failed (it gives up after 20 s and
		// is killed) is tried once more.
		const startChrome = () =>
			step("start Chrome", () => launch.browser(outdir), 30_000);
		const launched = await startChrome().catch(startChrome);
		browser = launched;
		const extensionId = await step("load the extension", () =>
			launch.extensionId(launched, outdir, built),
		);
		const control = await step("open the control page", () =>
			openControl(launched, extensionId),
		).catch((error: unknown) => {
			// Too slow is no wrong binary: the step's own message says which.
			if (error instanceof StepTimeout) throw error;
			throw new Error(
				`the extension did not load (${error instanceof Error ? error.message : String(error)}); is ${binary} Chrome for Testing or Chromium? (branded Chrome ignores --load-extension)`,
				{ cause: error },
			);
		});
		const harness: Harness = {
			browser: launched,
			base,
			extensionId,
			manifest: built.manifest,
			control,
			open: (path) =>
				step(`open ${path}`, async () => {
					const url = `${base}/${path}`;
					const page = await launched.newPage(url);
					const tabId = await launch.tabIdOf(control, page, url);
					opened.set(page, { h: harness, tabId });
					return { page, tabId };
				}),
			stop: cleanUp,
		};
		return harness;
	} catch (error) {
		await cleanUp();
		throw error;
	}
}

export function startHarness(binary: string): Promise<Harness> {
	return start(binary, {
		options: { test: true, minify: false },
		browser: (outdir) => Browser.launch(binary, outdir),
		async extensionId(_browser, _outdir, built) {
			if (built.id === undefined) throw new Error("test build without a key");
			return built.id;
		},
		tabIdOf: (control, _page, url) =>
			control.eval<number>(
				`chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url === ${JSON.stringify(url)})?.id)`,
			),
	});
}

/**
 * The store package as it ships: minified, the real manifest, no host access.
 * Extension pages see no tab's address, so `open` brings the tab to the front.
 */
export function startShipped(binary: string): Promise<Harness> {
	return start(binary, {
		options: { store: true },
		browser: () => Browser.launchPiped(binary),
		extensionId: (browser, outdir) => browser.loadExtension(outdir),
		async tabIdOf(control, page) {
			await page.activate();
			return control.eval<number>(
				`chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.id)`,
			);
		},
	});
}
