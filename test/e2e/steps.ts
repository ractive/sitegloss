/** Steps the end-to-end tests share: the toolbar, a case, reading the database. */

import { join } from "node:path";
import { type Case, newId, type PageInfo } from "../../src/lib/case.ts";
import type { OverlayState } from "../../src/lib/messages.ts";
import { DB_VERSION } from "../../src/lib/store.ts";
import type { TestWait } from "../../src/lib/test-waits.ts";
import { newCase } from "../../src/sidepanel/fresh.ts";
import type { Page } from "./browser.ts";
import { type Harness, opened } from "./harness.ts";
import { step } from "./trace.ts";

export const HOST = `document.getElementById("sitegloss-root")`;

/**
 * Shorten some of the extension's waits for this test, in the context `page`
 * is (the panel's page, or the worker): src/lib/test-waits.ts. Until that
 * page is loaded again.
 */
export const testWaits = (
	page: Page,
	waits: Partial<Record<TestWait, number>>,
): Promise<unknown> =>
	page.eval(`globalThis.siteglossTestWaits = ${JSON.stringify(waits)}`);

/** An element inside Sitegloss's shadow root. */
export const shadow = (selector: string) =>
	`${HOST}.shadowRoot.querySelector(${JSON.stringify(selector)})`;

export const READ_DB = `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss");
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		let tx;
		// No stores (nobody made the database yet): an error, not a wait.
		try { tx = open.result.transaction(["cases", "images"]); } catch (e) { return reject(e); }
		const cases = tx.objectStore("cases").getAll();
		const images = tx.objectStore("images").getAll();
		const keys = tx.objectStore("images").getAllKeys();
		// Beside the images the store keeps the record of each deleted case
		// ("!deleted/<id>"): no image, and listed by itself.
		tx.oncomplete = () => {
			const all = keys.result.map((key, i) => ({ key, value: images.result[i] }));
			resolve({
				cases: cases.result,
				images: all.filter((e) => !e.key.startsWith("!")).map((e) => ({ key: e.key, size: e.value.blob.size, type: e.value.blob.type })),
				deleted: all.filter((e) => e.key.startsWith("!deleted/")).map((e) => e.key.slice(9)),
			});
		};
	};
})`;

/**
 * Put cases into the extension's database, from the control page. If it
 * gets there before the extension made the database, it makes it as the
 * extension's store does (`IdbStore`): opened without a version it would
 * make one with no stores, its transaction would throw in the handler, and
 * the promise would wait for ever.
 */
export function putCases(h: Harness, cases: Case[]): Promise<unknown> {
	return step("put the cases", () =>
		h.control.eval(`new Promise((resolve, reject) => {
			const open = indexedDB.open("sitegloss", ${DB_VERSION});
			open.onupgradeneeded = () => {
				open.result.createObjectStore("cases", { keyPath: "id" });
				open.result.createObjectStore("images");
			};
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				try {
					const tx = open.result.transaction("cases", "readwrite");
					for (const c of ${JSON.stringify(cases)}) tx.objectStore("cases").put(c);
					tx.oncomplete = () => { open.result.close(); resolve(); };
					tx.onerror = () => reject(tx.error);
				} catch (error) {
					open.result.close();
					reject(error);
				}
			};
		})`),
	);
}

export interface Db {
	cases: {
		id: string;
		title: string;
		lastNumber?: number;
		link?: string;
		page: {
			url: string;
			title: string;
			viewport: { width: number; height: number };
		};
		shots: { id: string; scrollY: number }[];
		marks: {
			id: string;
			number: number;
			shot: string;
			comment: string;
			shape: { kind: string };
			element: { tag: string; text?: string; name?: string } | null;
		}[];
	}[];
	images: { key: string; size: number; type: string }[];
}

/** Read until `done` holds for the answer. */
export async function until<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	timeoutMs = 5000,
): Promise<T> {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (done(value)) return value;
		if (Date.now() > end)
			throw new Error(`timed out; last: ${JSON.stringify(value)}`);
		await Bun.sleep(50);
	}
}

interface DomNode {
	backendNodeId: number;
	attributes?: string[];
	children?: DomNode[];
	shadowRoots?: DomNode[];
}

function hostNode(node: DomNode): DomNode | undefined {
	const at = node.attributes?.indexOf("id") ?? -1;
	if (at >= 0 && node.attributes?.[at + 1] === "sitegloss-root") return node;
	for (const child of node.children ?? []) {
		const found = hostNode(child);
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * Wait until the side panel has taken its width from the page and the
 * viewport keeps its size: the panel takes it a moment after the icon's
 * click, and a click measured before that lands beside the element (on Linux
 * in CI, past the overlay onto the page).
 */
export async function viewportSettled(page: Page): Promise<void> {
	// The panel is at least this wide (Chrome's minimum is 320 px).
	const PANEL_MIN = 200;
	const size = () =>
		page.eval<{ inner: number; outer: number; height: number }>(
			"({ inner: innerWidth, outer: outerWidth, height: innerHeight })",
		);
	const end = Date.now() + 5000;
	let last = await size();
	let steady = 0;
	while (last.outer - last.inner < PANEL_MIN || steady < 3) {
		if (Date.now() > end)
			throw new Error(
				`the viewport did not settle beside the side panel: ${JSON.stringify(last)}`,
			);
		await Bun.sleep(150);
		const now = await size();
		steady =
			now.inner === last.inner && now.height === last.height ? steady + 1 : 0;
		last = now;
	}
}

/**
 * Let `shadow` reach the overlay of a build that ships: its shadow root is
 * closed to the page, but not to CDP. Afterwards the host's `shadowRoot`
 * answers, for the page's world only.
 */
export async function reachOverlay(page: Page): Promise<void> {
	await page.waitFor(HOST);
	const { root } = (await page.send("DOM.getDocument", {
		depth: -1,
		pierce: true,
	})) as { root: DomNode };
	const shadowRoot = hostNode(root)?.shadowRoots?.[0];
	if (shadowRoot === undefined)
		throw new Error("the overlay has no shadow root");
	const { object } = (await page.send("DOM.resolveNode", {
		backendNodeId: shadowRoot.backendNodeId,
	})) as { object: { objectId: string } };
	await page.send("Runtime.callFunctionOn", {
		objectId: object.objectId,
		functionDeclaration: `function () { Object.defineProperty(this.host, "shadowRoot", { value: this }); }`,
	});
}

/** A content request to the tab, injecting the content script first if needed. */
const toTab = (tabId: number, message: object) =>
	`chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(message)}).catch(() => chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ["content.js"] }).then(() => chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(message)})))`;

/**
 * Store a case from the control page, and tell the worker and other panels.
 * Opened as `putCases` opens it: the stores made if the extension has not.
 */
export const PUT_CASE = (c: Case) => `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss", ${DB_VERSION});
	open.onupgradeneeded = () => {
		open.result.createObjectStore("cases", { keyPath: "id" });
		open.result.createObjectStore("images");
	};
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const tx = open.result.transaction("cases", "readwrite");
		tx.objectStore("cases").put(${JSON.stringify(c)});
		tx.oncomplete = () => {
			open.result.close();
			chrome.runtime.sendMessage({ type: "cases:changed", caseId: ${JSON.stringify(c.id)} }).catch(() => undefined);
			resolve(true);
		};
		tx.onerror = () => reject(tx.error);
	};
})`;

/**
 * Show the toolbar as "New case for this page" does (DEC-026): a new case with
 * the page's title and info, stored at once, and the toolbar adding to it.
 * A side panel on Home opens it, as it opens the case any toolbar on the tab
 * in front adds to (DEC-023). Answers the case's id.
 */
export async function showToolbar(
	h: Harness,
	page: Page,
	tabId: number,
): Promise<string> {
	await page.activate();
	await besideSidePanel(h, page, tabId);
	const info = await h.control.eval<PageInfo>(
		toTab(tabId, { type: "page:info" }),
	);
	const c = newCase(newId("c"), info, new Date().toISOString());
	await h.control.eval(PUT_CASE(c));
	await h.control.eval(
		toTab(tabId, {
			type: "overlay:show",
			target: { caseId: c.id, title: c.title, nextMark: 1 },
		}),
	);
	await page.waitFor(shadow('[data-action="tool-box"]'));
	return c.id;
}

/**
 * Until the page has the room its window's side panel leaves it, 3 s at
 * most. Chrome lays out a tab that comes to the front at the window's full
 * width and gives the panel its room only a moment later (0.7 s after a new
 * tab, seen here): a toolbar shown meanwhile sits in the middle of the wider
 * page and moves when the page narrows, so a click aimed at one of its
 * buttons presses beside it. (`tabSettled` in ai.ts, after the panel opens,
 * waits for three equal reads; a new tab keeps its full width longer.)
 */
async function besideSidePanel(
	h: Harness,
	page: Page,
	tabId: number,
): Promise<void> {
	// The window's width, and whether the extension's side panel is open in
	// it, asked of its view: runtime.getContexts gives a panel no window.
	const win = await h.control.eval<{ width: number; panel: boolean }>(
		`chrome.tabs.get(${tabId}).then(async (t) => {
			const w = await chrome.windows.get(t.windowId);
			const panels = await Promise.all(chrome.extension.getViews().map(async (v) => {
				if (v === window || v.location.pathname !== "/sidepanel/index.html") return false;
				// A tab showing the panel's page is no side panel.
				if ((await v.chrome.tabs.getCurrent()) !== undefined) return false;
				return (await v.chrome.windows.getCurrent()).id === w.id;
			}));
			return { width: w.width, panel: panels.includes(true) };
		})`,
	);
	if (!win.panel) return;
	// A panel is at least 320 px wide. Not narrowed in time: go on, and say
	// so, as a press beside a button later has this cause.
	let last = 0;
	await until(
		async () => {
			last = await page.eval<number>("innerWidth");
			return last;
		},
		(width) => win.width - width >= 200,
		3000,
	).catch(() =>
		console.warn(
			`the page did not narrow beside the side panel within 3 s: window ${win.width} px, page ${last} px`,
		),
	);
}

/**
 * Move the control page (a side panel document too) into a window of its
 * own: a test that uses the real side panel then has one panel in the test's
 * window, not two that each open and draw the case the toolbar adds to.
 */
export async function parkControl(h: Harness): Promise<void> {
	await h.control.eval(
		`chrome.tabs.getCurrent().then((tab) => chrome.windows.create({ tabId: tab.id, focused: false }))`,
	);
}

/** The page's toolbar and marks as the side panel hears of them. */
export const overlayOf = (h: Harness, tabId: number) =>
	h.control.eval<OverlayState | null>(
		`chrome.tabs.sendMessage(${tabId}, { type: "overlay:state" }).catch(() => null)`,
	);

/** Finish the open comment field with `text`. */
export async function comment(page: Page, text: string): Promise<void> {
	await page.waitFor(shadow(".popover textarea"));
	await page.type(text);
	await page.click(shadow('[data-action="comment-done"]'));
}

/** Pick the element `selector` with the Element tool and comment it. */
export async function markElement(
	page: Page,
	selector: string,
	text: string,
): Promise<void> {
	await page.eval(
		`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" })`,
	);
	const pressed = await page.eval<string>(
		`${shadow('[data-action="tool-element"]')}.getAttribute("aria-pressed")`,
	);
	const tool = shadow('[data-action="tool-element"]');
	if (pressed !== "true") {
		// What the toolbar heard, said if the tool does not come on: the
		// clicks inside it and the tool's aria-pressed as it changed.
		await page.eval(`(() => {
			const root = ${HOST}.shadowRoot;
			globalThis.siteglossHeard = [];
			const heard = (what) => globalThis.siteglossHeard.push(Math.round(performance.now()) + " " + what);
			root.addEventListener("click", (e) => heard("click " + (e.target.closest?.("[data-action]")?.dataset.action ?? e.target.tagName)), true);
			new MutationObserver((list) => list.forEach((m) => heard("pressed " + m.target.dataset.action + "=" + m.target.getAttribute("aria-pressed")))).observe(${shadow(".toolbar")}, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
		})()`);
		await page.click(tool);
	}
	// Without the tool, the click below would go to the page itself.
	await page
		.waitFor(`${tool}.getAttribute("aria-pressed") === "true"`)
		.catch(async (error: unknown) => {
			const heard = await page
				.eval<string[]>("globalThis.siteglossHeard ?? []")
				.catch(() => []);
			throw new Error(
				`the element tool did not come on; the toolbar heard: ${heard.join("; ") || "nothing"}`,
				{ cause: error },
			);
		});
	// Near the left edge: the toolbar sits in the middle at the bottom.
	const where = `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2 }; })()`;
	// The page may still be moving (the scroll above, the side panel taking
	// its width): pressed at once, the click lands on what was at that spot
	// before, and the mark is another element's (the filler above the
	// footer). So the element has to have stayed put for two frames first.
	let at = await page.eval<{ x: number; y: number }>(where);
	for (let tries = 0; tries < 40; tries++) {
		await page.eval(
			"new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 200); })",
		);
		const now = await page.eval<{ x: number; y: number }>(where);
		const stayed = now.x === at.x && now.y === at.y;
		at = now;
		if (stayed) break;
	}
	await page.mouse("mouseMoved", at.x, at.y);
	await page.clickAt(at.x, at.y);
	await comment(page, text);
}

/**
 * What "Save case…" with a title was before DEC-026: every mark drawn is in
 * the case the toolbar adds to (a comment still open is done first; nothing
 * is clicked for them, and a mark waiting for "Add mark N" fails the step:
 * a test about that button clicks it itself), then the case is named `title`
 * with the Rename of the side panel that shows it (`panel`, else the control
 * page). A test with no panel showing the case names it with `nameCase`.
 */
export async function saveAs(
	page: Page,
	title: string,
	panel?: Page,
): Promise<void> {
	const owner = opened.get(page);
	if (owner === undefined)
		throw new Error("saveAs: a page the harness did not open");
	await renameInPanel(panel ?? owner.h.control, await marksIn(page), title);
}

/**
 * Until every mark drawn on `page` is in the case its toolbar adds to (a
 * comment still open is done first); answers that case's id. Nothing is
 * clicked: a mark whose screenshot the page's moving gave up is taken again
 * by itself (DEC-026), and one that waits for "Add mark N" fails the step.
 */
export async function marksIn(page: Page): Promise<string> {
	const owner = opened.get(page);
	if (owner === undefined)
		throw new Error("marksIn: a page the harness did not open");
	const { h, tabId } = owner;
	await page.eval(
		`(() => { const p = ${shadow(".popover")}; if (p && !p.hidden) ${shadow('[data-action="comment-done"]')}?.click(); })()`,
	);
	const retry = shadow('[data-action="retry"]');
	const end = Date.now() + 30_000;
	let state = await overlayOf(h, tabId);
	while (
		!(state?.target !== undefined && state.drafts === 0 && !state.saving)
	) {
		const said = async () =>
			await page.eval(`${shadow(".toolbar")}?.textContent`);
		if (
			state?.saving === false &&
			(await page.eval<boolean>(`${retry} !== null`))
		)
			throw new Error(
				`a mark waits for Add mark N; the toolbar says: ${await said()}`,
			);
		if (Date.now() > end)
			throw new Error(
				`the marks are not in the case; the toolbar says: ${await said()}`,
			);
		await Bun.sleep(250);
		state = await overlayOf(h, tabId);
	}
	return state.target.caseId;
}

/**
 * Rename the case in `panel`, a side panel that shows it (it opens the case
 * a toolbar adds to a moment after the page shows it, DEC-023): Rename, the
 * title, Enter, as the user does. Waits until it is stored so.
 */
export async function renameInPanel(
	panel: Page,
	caseId: string,
	title: string,
): Promise<void> {
	const shown = `(!document.getElementById("case-view")?.hidden && document.getElementById("verdict")?.dataset.case === ${JSON.stringify(caseId)} && document.getElementById("rename-case") !== null)`;
	await panel.waitFor(shown, 10_000).catch(async () => {
		const shows = await panel
			.eval<string>(
				`document.getElementById("case-view")?.hidden === false ? "case " + document.getElementById("verdict")?.dataset.case : "home"`,
			)
			.catch(() => "no panel");
		throw new Error(
			`renameInPanel: no side panel shows the case ${caseId} (it shows: ${shows}); name it with nameCase where the test has none`,
		);
	});
	await panel.eval(`document.getElementById("rename-case").click()`);
	await panel.waitFor(`!document.getElementById("rename").hidden`);
	await panel.eval(`(() => {
		const field = document.getElementById("rename-field");
		field.value = ${JSON.stringify(title)};
		field.dispatchEvent(new Event("input"));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
	})()`);
	await panel.waitFor(
		`document.querySelector("#case-view .case-title")?.textContent === ${JSON.stringify(title)}`,
		10_000,
	);
	await until(
		() => panel.eval<Db>(READ_DB),
		(db) => db.cases.some((x) => x.id === caseId && x.title === title),
		10_000,
	);
}

/**
 * Setup, not the product's path: name a case in the store, where a test has
 * no side panel showing it, and tell the toolbar on `tabId` and the panels.
 */
export async function nameCase(
	h: Harness,
	caseId: string,
	title: string,
	tabId?: number,
): Promise<void> {
	const { cases } = await h.control.eval<{ cases: Case[] }>(READ_DB);
	const c = cases.find((x) => x.id === caseId);
	if (c === undefined) throw new Error(`nameCase: no case ${caseId}`);
	await h.control.eval(
		PUT_CASE({ ...c, title, updatedAt: new Date().toISOString() }),
	);
	if (tabId !== undefined)
		await h.control.eval(
			`chrome.tabs.sendMessage(${tabId}, ${JSON.stringify({ type: "overlay:title", caseId, title })}).catch(() => undefined)`,
		);
}

/** Run `body` (an expression using `image`, the stored `{ blob, width, height }`) on a case's image. */
function withImage(title: string, path: string, body: string): string {
	return `new Promise((resolve, reject) => {
	const open = indexedDB.open("sitegloss");
	open.onerror = () => reject(open.error);
	open.onsuccess = () => {
		const tx = open.result.transaction(["cases", "images"]);
		const cases = tx.objectStore("cases").getAll();
		tx.oncomplete = () => {
			const c = cases.result.find((x) => x.title === ${JSON.stringify(title)});
			if (!c) return reject(new Error("no case " + ${JSON.stringify(title)}));
			const get = open.result.transaction("images").objectStore("images").get(c.id + "/" + ${JSON.stringify(path)});
			get.onsuccess = async () => { try { const image = get.result; resolve(await (${body})); } catch (e) { reject(e); } };
			get.onerror = () => reject(get.error);
		};
	};
})`;
}

/** A stored image's bytes (base64) and the size the store recorded. */
export function imageBytes(
	control: Page,
	title: string,
	path: string,
): Promise<{ base64: string; width: number; height: number }> {
	return control.eval(
		withImage(
			title,
			path,
			`image.blob.arrayBuffer().then((b) => { let s = ""; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return { base64: btoa(s), width: image.width, height: image.height }; })`,
		),
	);
}

/** How many pixels of a stored image are within `tolerance` of a colour. */
export function countColour(
	control: Page,
	title: string,
	path: string,
	[r, g, b]: [number, number, number],
	tolerance = 12,
): Promise<number> {
	return control.eval(
		withImage(
			title,
			path,
			`createImageBitmap(image.blob).then((bitmap) => {
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const ctx = canvas.getContext("2d");
				ctx.drawImage(bitmap, 0, 0);
				const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
				let n = 0;
				for (let i = 0; i < data.length; i += 4)
					if (Math.abs(data[i] - ${r}) <= ${tolerance} && Math.abs(data[i + 1] - ${g}) <= ${tolerance} && Math.abs(data[i + 2] - ${b}) <= ${tolerance}) n++;
				return n;
			})`,
		),
	);
}

/**
 * The worker's settings database (`src/worker/kv.ts`), read or changed in an
 * extension page or the worker: `KV(code)` runs `code` with `store`, the
 * object store, in a transaction of `mode`, and answers every entry after it.
 */
export const KV = (code = "", mode: "readonly" | "readwrite" = "readonly") =>
	`new Promise((resolve, reject) => {
		const open = indexedDB.open("sitegloss-settings", 1);
		open.onupgradeneeded = () => open.result.createObjectStore("settings");
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const tx = open.result.transaction("settings", ${JSON.stringify(mode)});
			const store = tx.objectStore("settings");
			${code};
			const keys = store.getAllKeys();
			const values = store.getAll();
			tx.oncomplete = () => {
				open.result.close();
				resolve(Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]])));
			};
			tx.onerror = () => reject(tx.error);
		};
	})`;

/** The worker's settings now, read in the control page (the same origin). */
export const settingsOf = (h: Harness) =>
	h.control.eval<Record<string, unknown>>(KV());

/** A session on the extension's service worker, which starts it if needed. */
export async function worker(h: Harness): Promise<Page> {
	await h.control.eval(WAKE_WORKER);
	const { targetId } = await workerTarget(h);
	return h.browser.attach(targetId);
}

/** A message the worker answers without doing anything: it starts it, though. */
const WAKE_WORKER = `chrome.runtime.sendMessage({ type: "images:discard", caseId: "c_none", shotIds: [] })`;

const workerTarget = (h: Harness) =>
	h.browser.waitForTarget(
		(t) =>
			t.type === "service_worker" &&
			t.url === `chrome-extension://${h.extensionId}/background.js`,
	);

/** Stop the service worker, as Chrome does when it is idle, and wake it again. */
export async function restartWorker(h: Harness): Promise<void> {
	await h.control.eval(WAKE_WORKER);
	const { targetId } = await workerTarget(h);
	await h.browser.send("Target.closeTarget", { targetId });
	await until(
		() => h.browser.targets(),
		(targets) => !targets.some((t) => t.targetId === targetId),
	);
	await h.control.eval(WAKE_WORKER);
	await until(
		() => workerTarget(h),
		(target) => target.targetId !== targetId,
	);
}

/**
 * Before a test: no page left from the tests before (a tab is found by its
 * address, and a page left with a toolbar or a case's marks is someone
 * else's state), and every side panel document (the control page, a real
 * side panel, one opened in a tab) on Home with no case open. A case left
 * open in one follows to the test's tab, draws its marks and hides its new
 * case's toolbar (DEC-023), so one failing test would take the ones after
 * it along. Pages close without the question unsaved marks ask.
 */
export async function resetPanel(h: Harness): Promise<void> {
	const panelUrl = `chrome-extension://${h.extensionId}/sidepanel/index.html`;
	const pages = async () =>
		(await h.browser.targets()).filter((t) => t.type === "page");
	const closing = (await pages())
		.filter((t) => /^(https?|file):/.test(t.url))
		.map((t) => t.targetId);
	for (const targetId of closing)
		await h.browser
			.send("Target.closeTarget", { targetId })
			.catch(() => undefined);
	await until(pages, (now) => !now.some((t) => closing.includes(t.targetId)));
	const home = `!document.getElementById("home").hidden && document.getElementById("back").hidden`;
	await h.control.goto(panelUrl);
	await h.control.waitFor(home);
	for (const t of await pages()) {
		if (t.targetId === h.control.targetId || !t.url.startsWith(panelUrl))
			continue;
		const other = await h.browser.attachPage(t.targetId);
		await other.goto(panelUrl);
		await other.waitFor(home);
	}
}

/** The side panel's document in the control page, in front, on its home view. */
export async function panelHome(h: Harness): Promise<Page> {
	await h.control.goto(
		`chrome-extension://${h.extensionId}/sidepanel/index.html`,
	);
	await h.control.activate();
	// The list moves what is below it when it arrives.
	const { cases } = await h.control.eval<Db>(READ_DB);
	await h.control.waitFor(
		cases.length === 0
			? `document.getElementById("cases").childElementCount > 0`
			: `document.querySelectorAll("[data-case]").length === ${cases.length}`,
	);
	return h.control;
}

/** Open the case `title` from the side panel's list. */
export async function openCase(panel: Page, title: string): Promise<void> {
	const item = `[...document.querySelectorAll("[data-case]")].find((e) => e.textContent.includes(${JSON.stringify(title)}))`;
	await panel.waitFor(item);
	await panel.click(item);
	await panel.waitFor(`document.getElementById("export-case")`);
}

/**
 * Click Export on the open case; answers the path the panel shows (the test
 * build has "downloads").
 */
export function exportOpenCase(h: Harness, panel: Page): Promise<string> {
	return downloadShown(
		h,
		panel,
		`document.getElementById("export-case")`,
		"export-saved",
	);
}

/**
 * Click the button `button` (an expression) that saves through the
 * `downloads` API (DEC-020), into Chrome's own downloads folder; answers the
 * path the panel shows in `saved` (an element's id) once the file is there.
 */
export async function downloadShown(
	h: Harness,
	panel: Page,
	button: string,
	saved: string,
): Promise<string> {
	// Chrome's own way, by its settings: CDP's "allow" names a file by a GUID.
	await h.browser.send("Browser.setDownloadBehavior", { behavior: "default" });
	await panel.click(button);
	const code = `document.querySelector("#${saved} code")?.textContent`;
	await panel.waitFor(code, 15_000);
	const path = await panel.eval<string>(code);
	if (Bun.file(path).size === 0) throw new Error(`${path} is empty or missing`);
	return path;
}

/**
 * Click the button `button` (an expression) that saves a file; answers its
 * path in `folder` once Chrome has written it.
 */
export async function download(
	h: Harness,
	panel: Page,
	folder: string,
	button: string,
): Promise<string> {
	await h.browser.send("Browser.setDownloadBehavior", {
		behavior: "allow",
		downloadPath: folder,
		eventsEnabled: true,
	});
	const begun = h.browser.event("Browser.downloadWillBegin");
	await panel.click(button);
	const { suggestedFilename } = (await begun) as { suggestedFilename: string };
	const path = join(folder, suggestedFilename);
	// Chrome may still be writing it: it is done when it has stopped growing.
	let size = -1;
	await until(
		async () => {
			const before = size;
			size = Bun.file(path).size;
			await Bun.sleep(200);
			return before;
		},
		(before) => before > 0 && before === size,
	);
	return path;
}

/** Choose `file` through the side panel's Import button and file input. */
export async function importFile(panel: Page, file: string): Promise<void> {
	await panel.send("Page.setInterceptFileChooserDialog", { enabled: true });
	const chooser = panel.event("Page.fileChooserOpened");
	await panel.click(`document.getElementById("import")`);
	const { backendNodeId } = (await Promise.race([
		chooser,
		Bun.sleep(5000).then(() => {
			throw new Error("the Import button opened no file chooser");
		}),
	])) as { backendNodeId: number };
	await panel.send("DOM.setFileInputFiles", { files: [file], backendNodeId });
	await panel.send("Page.setInterceptFileChooserDialog", { enabled: false });
}

/** Keys of the images store under a case. */
export const imagesOf = (db: Db, caseId: string) =>
	db.images
		.filter((i) => i.key.startsWith(`${caseId}/`))
		.map((i) => i.key.slice(caseId.length + 1))
		.sort();
