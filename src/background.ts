/**
 * The service worker: a click on the icon (or Alt+Shift+O) opens the side
 * panel and injects the content script into that tab (the click grants
 * `activeTab`). It captures screenshots and writes cases for the content
 * script, which runs in the page's origin and cannot reach the extension's
 * storage. And it holds the connection to the AI app (DEC-015), so that it
 * stays while the side panel is closed.
 *
 * Every listener is added here, at the top level, so that its event wakes
 * the worker; each worker start connects again if the user left AI access on.
 * With "Keep AI access on" that holds after a browser start, an update or a
 * reload; without it AI access is on only until the browser closes or the
 * extension is updated, reloaded or disabled, which clear
 * `chrome.storage.session`.
 *
 * It also writes the cases for the sync (DEC-021, DEC-025), to Downloads or
 * to the folder the user chose, after every change and at each start,
 * whoever made the change, and puts "!" on the icon while the sync needs the
 * user.
 *
 * And, for someone signed in to sitegloss.dev, it syncs the cases with their
 * team both ways and holds the tokens (DEC-039, `worker/cloud.ts`).
 */

import { PAIRING_PORT, pagePort } from "@ractive-ch/tab-mcp-client/extension";
import { BAR_PLACE_KEY, storedBarPlace } from "./lib/bar-place.ts";
import {
	BROWSER,
	FIREFOX,
	FIREFOX_KEEPALIVE_MS,
	openPanel,
	PANEL,
	signInRedirect,
} from "./lib/browser.ts";
import { isSafeId, pendingImage } from "./lib/case.ts";
import { CLOUD_DATABASE } from "./lib/cloud/book.ts";
import {
	cropImages,
	drawMarks,
	PENDING_QUALITY,
	screenshotToWebp,
} from "./lib/images.ts";
import { kvWhenOpen, openKv } from "./lib/kv.ts";
import {
	type BarPlaceAnswer,
	type Broadcast,
	type CaptureResult,
	type ContentRequest,
	IMAGES_FOR_KEY,
	type ImagesFor,
	type ImagesForAnswer,
	isCloudRequest,
	isWorkerRequest,
	type NumberCheck,
	PANEL_MARK_WHAT,
	type SaveResult,
	type UndoResult,
	type WorkerRequest,
	type WorkerResponse,
} from "./lib/messages.ts";
import { fromPage, numberFree, saveCase, undoAdd } from "./lib/save.ts";
import { IdbStore, PENDING_MAX_AGE_MS } from "./lib/store.ts";
import {
	type ChosenFolder,
	downloadsTarget,
	folderTarget,
	kvSyncStore,
	PENDING_DOWNLOAD_KEY,
	type PendingDownload,
	SYNC_DATABASE,
	Sync,
	type SyncTarget,
} from "./lib/sync.ts";
import { injectOnClick } from "./lib/tabs.ts";
import { testWait } from "./lib/test-waits.ts";
import { AddLedger } from "./lib/undo.ts";
import { badge } from "./worker/badge.ts";
import { Cloud } from "./worker/cloud.ts";
import { ALARM, Connection } from "./worker/connection.ts";
import { chromeDownloads } from "./worker/downloads.ts";
import {
	isPanelSender,
	PANEL_PORT,
	type WorkerMessage,
} from "./worker/protocol.ts";
import { TabCases } from "./worker/tab-cases.ts";
import {
	boundsFor,
	openViewer,
	rememberFrame,
	viewerLayoutOk,
	windowClosed,
} from "./worker/viewer-window.ts";

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;
declare const SITEGLOSS_FIREFOX: boolean | undefined;

/**
 * A test build keeps what the worker reports as wrong, for the end-to-end
 * tests: Firefox's event page has a console no automation reaches, and it is
 * discarded after 30 s idle, so the record is in `storage.session`
 * (`siteglossTestLog`), which outlasts it, one line each, `error: …` (errors,
 * unhandled rejections, console.error) or `warn: …` (console.warn). (The
 * define itself: other builds drop it.)
 */
if (typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD) {
	const key = "siteglossTestLog";
	const text = (value: unknown) =>
		value instanceof Error ? value.message : String(value);
	let writing: Promise<unknown> = Promise.resolve();
	const log = (kind: "error" | "warn", parts: unknown[]) => {
		const line = `${kind}: ${parts.map(text).join(" ")}`;
		writing = writing
			.then(() => chrome.storage.session.get(key))
			.then((stored) =>
				chrome.storage.session.set({
					[key]: [...((stored[key] as string[] | undefined) ?? []), line],
				}),
			)
			.catch(() => undefined);
	};
	globalThis.addEventListener("error", (e) =>
		log("error", [(e as ErrorEvent).error ?? (e as ErrorEvent).message]),
	);
	globalThis.addEventListener("unhandledrejection", (e) =>
		log("error", [(e as PromiseRejectionEvent).reason]),
	);
	const error = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		log("error", args);
		error(...args);
	};
	const warn = console.warn.bind(console);
	console.warn = (...args: unknown[]) => {
		log("warn", args);
		warn(...args);
	};
}

const store = new IdbStore();
const added = new AddLedger(chrome.storage.session);
/** The cases each tab's page was handed: a save adds to no other. */
const tabCases = new TabCases(chrome.storage.session);

/**
 * The one writer of the sync (DEC-021, DEC-025). To Downloads it writes
 * whenever it likes, with the panel closed too. To a folder Chrome lets it
 * write only while an extension page (the side panel) is open and the user
 * allowed the folder; otherwise it says "paused" and writes what changed
 * meanwhile once the panel asks again. It runs at each start, so the icon's
 * "!" is there after a browser restart before the panel is opened.
 */
const syncKv = kvWhenOpen(() => openKv(SYNC_DATABASE));

/**
 * The end-to-end tests' folder is one of the private file system, which
 * never needs Chrome's OK: in a test build, `test:access` set to "prompt" in
 * the sync's database makes the worker see a folder that needs it again.
 */
function testFolder(chosen: ChosenFolder): SyncTarget {
	const target = folderTarget(chosen, store);
	return {
		...target,
		permission: async () =>
			(await syncKv.get("test:access")) !== "prompt" && target.permission(),
	};
}

const sync = new Sync({
	cases: store,
	store: kvSyncStore(syncKv),
	downloads: downloadsTarget(chromeDownloads(syncKv, store)),
	// Saves in a row are one download per case, not one each (a burst of
	// Chrome's download bubble). Short in the test build (DEC-053).
	quietMs:
		typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
			? 200
			: 2000,
	// The define itself, so other builds drop the test's folder.
	...(typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? { folder: testFolder }
		: {}),
	notify: (status) => {
		badge.sync(status);
		void broadcast({ type: "sync:changed" });
	},
});
void sync.request();

/**
 * The sync with a team at sitegloss.dev (DEC-039), for whoever is signed in:
 * it runs after every change, at each start, when a panel asks, and on an
 * alarm every few minutes. Nobody signed in: it does nothing. A case it
 * changed here is told as any other change (the panels show it, the folder
 * sync writes it), but not back to itself.
 */
const cloudKv = kvWhenOpen(() => openKv(CLOUD_DATABASE));
const cloud = new Cloud({
	store,
	kv: cloudKv,
	changed: (caseId) => void tell({ type: "cases:changed", caseId }),
	news: () => void tell({ type: "cloud:changed" }),
	redirect: signInRedirect,
	alarms: chrome.alarms,
	keepAlive: () => void chrome.runtime.getPlatformInfo().catch(() => {}),
});
cloud.start();

/**
 * The end of a download the sync waits for wakes the worker, should it have
 * stopped meanwhile: its run settles it. At the top level where Sitegloss has
 * the (optional) permission, and once it is given.
 */
let hearingDownloads = false;
function hearDownloads(): void {
	if (hearingDownloads || chrome.downloads?.onChanged === undefined) return;
	hearingDownloads = true;
	chrome.downloads.onChanged.addListener((delta) => {
		if (delta.state === undefined) return;
		void syncKv.get(PENDING_DOWNLOAD_KEY).then(
			(p) => {
				if ((p as PendingDownload | undefined)?.id === delta.id)
					void sync.request();
			},
			() => undefined,
		);
	});
}
hearDownloads();
// The downloads permission taken back, or given; in Firefox, the data
// collection consent taken back ends AI access (`consentChanged`).
chrome.permissions.onRemoved.addListener(() => {
	void sync.request();
	if (FIREFOX) withConnection((c) => void c.consentChanged());
	// Without that consent nothing may go to sitegloss.dev either.
	void cloud.consentChanged();
});
chrome.permissions.onAdded.addListener(() => {
	hearDownloads();
	void sync.request();
});

// Screenshots of saves that never finished (the tab was closed or navigated
// while saving) would otherwise stay in storage unseen.
void store
	.sweepPending(Date.now() - PENDING_MAX_AGE_MS)
	.catch((error: unknown) => console.warn("Sitegloss: sweep", error));

// A tab that closes was handed nothing any more.
chrome.tabs.onRemoved.addListener((tabId) => {
	void tabCases.forget(tabId).catch(() => undefined);
});

// A browser window that closes takes its picture viewer with it (DEC-064).
chrome.windows.onRemoved.addListener((windowId) => {
	void windowClosed(windowId).catch((error: unknown) =>
		console.warn("Sitegloss: viewer window", error),
	);
});

chrome.action.onClicked.addListener((tab) => {
	if (tab.id === undefined) return;
	// `sidePanel.open` (Firefox: `sidebarAction.open`) needs the click's user
	// gesture: call it before any await. With the tab, not only the window:
	// over another extension's panel for this tab (Claude in Chrome's, say),
	// `open({ windowId })` resolves and shows nothing. The panel stays the
	// global one, for every tab without a panel of its own.
	void openPanel({ tabId: tab.id, windowId: tab.windowId }).catch(
		(error: unknown) => console.warn("Sitegloss: side panel", error),
	);
	void injectOnClick(tab).catch((error: unknown) =>
		console.warn("Sitegloss: cannot run on this tab", error),
	);
});

/** Chrome allows two `captureVisibleTab` calls a second. */
const CAPTURE_GAP_MS = 600;
let lastCapture = 0;
let captureQueue: Promise<unknown> = Promise.resolve();

/** Chrome can leave a capture unanswered, and the next ones wait in the queue. */
const CAPTURE_TIMEOUT_MS = 8000;

/** The tab must still be the one in front of its window, or the capture would show another. */
async function ensureInFront(tabId: number, windowId: number): Promise<void> {
	const tab = await chrome.tabs.get(tabId);
	if (!tab.active || tab.windowId !== windowId)
		throw new Error(
			"The tab is no longer in front of its window; switch back to it and try again.",
		);
}

/** Capture the tab, which must be the one in front of its window before and after. */
function capture(tabId: number, windowId: number): Promise<string> {
	const run = async () => {
		const wait = lastCapture + CAPTURE_GAP_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		try {
			await ensureInFront(tabId, windowId);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const image = await Promise.race([
				chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() =>
							reject(new Error(`${BROWSER} did not deliver the screenshot.`)),
						testWait("captureMs", CAPTURE_TIMEOUT_MS),
					);
				}),
			]).finally(() => clearTimeout(timer));
			await ensureInFront(tabId, windowId);
			return image;
		} finally {
			lastCapture = Date.now();
		}
	};
	const next = captureQueue.then(run, run);
	captureQueue = next.catch(() => undefined);
	return next;
}

/** Tell the panels, and the folder sync of a case that changed. */
async function tell(message: Broadcast): Promise<void> {
	if (message.type === "cases:changed") void sync.request();
	try {
		await chrome.runtime.sendMessage(message);
	} catch {
		// No side panel open.
	}
}

/** A case changed here: the panels, the folder sync and the team hear of it. */
async function broadcast(message: Broadcast): Promise<void> {
	if (message.type === "cases:changed") cloud.request();
	await tell(message);
}

async function handle(
	request: WorkerRequest,
	sender: chrome.runtime.MessageSender,
): Promise<object> {
	switch (request.type) {
		case "capture": {
			const tab = sender.tab;
			if (tab?.id === undefined) throw new Error("not sent from a tab");
			if (!isSafeId(request.caseId) || !isSafeId(request.shotId))
				throw new Error("invalid id");
			const png = await capture(tab.id, tab.windowId);
			// Encoding takes a while; the page need not stay blurred for it.
			const taken: ContentRequest = { type: "page:captured" };
			void chrome.tabs.sendMessage(tab.id, taken).catch(() => undefined);
			const image = await screenshotToWebp(png, PENDING_QUALITY);
			await store.putImage(request.caseId, pendingImage(request.shotId), {
				...image,
				storedAt: Date.now(),
			});
			return {
				width: image.width,
				height: image.height,
			} satisfies CaptureResult;
		}
		case "case:save": {
			const from = request.request.imagesFrom;
			if (from !== undefined && !isSafeId(from)) throw new Error("invalid id");
			// Only to a case the panel, or an AI app's tool, gave this tab.
			const tabId = sender.tab?.id;
			if (
				tabId === undefined ||
				!(await tabCases.has(tabId, request.request.caseId))
			)
				throw new Error(
					`this page was not given that case; add marks to it from the ${PANEL}.`,
				);
			const saved = await saveCase(
				store,
				fromPage(request.request),
				cropImages,
				new Date(),
				drawMarks,
			);
			// Marks added one by one: the page that added them may undo them.
			if (
				request.request.keepPending &&
				tabId !== undefined &&
				sender.documentId !== undefined
			)
				for (const draft of request.request.marks) {
					const a = saved.marks.find((x) => x.number === draft.number);
					if (a !== undefined)
						await added.record({
							caseId: saved.id,
							markId: a.id,
							shot: a.shot,
							comment: a.comment,
							tabId,
							documentId: sender.documentId,
						});
				}
			await broadcast({ type: "cases:changed", caseId: saved.id });
			return {
				caseId: saved.id,
				title: saved.title,
				marks: saved.marks.length,
			} satisfies SaveResult;
		}
		case "case:number":
			if (!isSafeId(request.caseId)) throw new Error("invalid id");
			return (await numberFree(
				store,
				request.caseId,
				request.number,
			)) satisfies NumberCheck;
		case "case:undo-add": {
			if (!isSafeId(request.caseId) || !isSafeId(request.markId))
				throw new Error("invalid id");
			const mark = await added.find(
				request.caseId,
				request.markId,
				sender.tab?.id,
				sender.documentId,
			);
			if (mark === undefined)
				throw new Error(
					`this page did not add that mark; delete it in the ${PANEL} if it should go.`,
				);
			const result = await undoAdd(store, request.caseId, request.markId, mark);
			await added.remove(mark);
			if (result.removed)
				await broadcast({ type: "cases:changed", caseId: request.caseId });
			return result satisfies UndoResult;
		}
		case "images:discard":
			if (!isSafeId(request.caseId)) throw new Error("invalid id");
			await store.deleteImages(
				request.caseId,
				request.shotIds.filter(isSafeId).map(pendingImage),
			);
			return {};
		case "panel:images": {
			const tab = sender.tab;
			if (
				tab?.id === undefined ||
				!isSafeId(request.caseId) ||
				!Number.isInteger(request.number) ||
				request.number < 1 ||
				(request.what !== undefined && !PANEL_MARK_WHAT.includes(request.what))
			)
				throw new Error("invalid request");
			// Before any await: the click's gesture opens the panel.
			const opened = openPanel({ tabId: tab.id, windowId: tab.windowId });
			await chrome.storage.session.set({
				[IMAGES_FOR_KEY]: {
					caseId: request.caseId,
					number: request.number,
					what: request.what ?? "images",
					tabId: tab.id,
					at: Date.now(),
				} satisfies ImagesFor,
			});
			// A panel already open takes it now; one that opens takes it as
			// it starts.
			chrome.runtime
				.sendMessage({ type: "panel:images" } satisfies Broadcast)
				.catch(() => undefined);
			// Not opened (no gesture left, or another browser's rule): the
			// panel opened later still asks for the images.
			await opened.catch((error: unknown) =>
				console.warn("Sitegloss: side panel", error),
			);
			return {};
		}
		case "viewer:open": {
			// The panel's own: a page does not open windows.
			if (!fromExtensionPage(sender)) throw new Error("not from the panel");
			if (
				!isSafeId(request.caseId) ||
				!isSafeId(request.markId) ||
				!isSafeId(request.pictureId) ||
				!Number.isInteger(request.windowId) ||
				(request.layout !== undefined && !viewerLayoutOk(request.layout))
			)
				throw new Error("invalid request");
			const viewerWindowId = await openViewer(
				request.caseId,
				request.markId,
				request.pictureId,
				request.windowId,
				request.layout && (await boundsFor(request.layout)),
			);
			return { viewerWindowId };
		}
		case "tab:case": {
			// The panel's own: a page may not hand itself a case.
			if (!fromExtensionPage(sender)) throw new Error("not from the panel");
			if (!Number.isInteger(request.tabId) || !isSafeId(request.caseId))
				throw new Error("invalid request");
			await tabCases.record(request.tabId, request.caseId);
			return {};
		}
		case "viewer:frame": {
			if (!fromExtensionPage(sender)) throw new Error("not from the viewer");
			await rememberFrame(request.height);
			return {};
		}
		case "panel:images-take": {
			// The panel's own: a page may not take what another left.
			if (!fromExtensionPage(sender)) throw new Error("not from the panel");
			// The panel beside that tab: another window's panel leaves it.
			const kept = await chrome.storage.session.get(IMAGES_FOR_KEY);
			const images = kept[IMAGES_FOR_KEY] as ImagesFor | undefined;
			if (images === undefined || images.tabId !== request.tabId)
				return {} satisfies ImagesForAnswer;
			await chrome.storage.session.remove(IMAGES_FOR_KEY);
			return { images } satisfies ImagesForAnswer;
		}
		case "bar:place": {
			// Two numbers, or nothing: a page cannot put anything else here.
			if (request.place !== undefined) {
				const place = storedBarPlace(request.place);
				if (place !== undefined)
					await chrome.storage.local.set({ [BAR_PLACE_KEY]: place });
				return {};
			}
			const kept = await chrome.storage.local.get(BAR_PLACE_KEY);
			const place = storedBarPlace(kept[BAR_PLACE_KEY]);
			return (place === undefined ? {} : { place }) satisfies BarPlaceAnswer;
		}
	}
}

/** A page of the extension itself (the side panel), not a content script. */
const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
	sender.url?.startsWith(chrome.runtime.getURL("")) === true;

chrome.runtime.onMessage.addListener(
	(request: WorkerRequest | Broadcast, sender, sendResponse) => {
		if (sender.id !== chrome.runtime.id) return false;
		// The side panel changed a case, or opened: the sync folder follows,
		// and the team (DEC-039).
		if (
			(request?.type === "cases:changed" || request?.type === "sync:run") &&
			fromExtensionPage(sender)
		) {
			void sync.request(request.type === "sync:run" && request.force === true);
			if (request.type === "cases:changed") cloud.request();
			return false;
		}
		// The account and the team sync: asked by a page of the extension
		// only, never by a content script (a web page's origin).
		if (isCloudRequest(request)) {
			if (!fromExtensionPage(sender)) return false;
			void cloud.handle(request).then(sendResponse);
			return true;
		}
		if (!isWorkerRequest(request)) return false;
		handle(request, sender).then(
			(result) =>
				sendResponse({ ok: true, ...result } satisfies WorkerResponse),
			(error: unknown) =>
				sendResponse({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				} satisfies WorkerResponse),
		);
		return true; // answers asynchronously
	},
);

// --- The AI app (DEC-015) ---------------------------------------------------

const ready = Connection.start({
	store,
	capture,
	handed: (tabId, caseId) => tabCases.record(tabId, caseId),
	changed: () => {
		void sync.request();
		cloud.request();
	},
	// Whose comments are this app's own, and what deleting a case means,
	// in a case synced with a team (DEC-039).
	me: () => cloud.me().catch(() => undefined),
	team: (caseId) => cloud.teamOf(caseId).catch(() => undefined),
	// Who has a case and whose turn it is (DEC-071).
	handOver: () => cloud.handOver().catch(() => undefined),
});
ready.catch((error: unknown) =>
	console.error("Sitegloss: AI connection", error),
);

const withConnection = (use: (connection: Connection) => void) =>
	void ready.then(use, () => {});

// Commands come only over the side panel's own port; content scripts reach
// `chrome.runtime` too, so its sender is checked, and any other port closed.
chrome.runtime.onConnect.addListener((port) => {
	// The relay's pairing page (DEC-044): taken over at once, before any
	// await, so its first message is not lost while the worker starts; the
	// library checks the sender (this extension's script, top frame, the
	// relay's origin and path) and closes any other.
	if (port.name === PAIRING_PORT) {
		const page = pagePort(port);
		void ready.then(
			(c) => c.pairingPage(page),
			() => page.close(),
		);
		return;
	}
	if (
		port.name !== PANEL_PORT ||
		!isPanelSender(port.sender ?? {}, chrome.runtime.id, {
			origin: chrome.runtime.getURL(""),
			// Firefox's test build: automation cannot reach the sidebar, so
			// the panel's page runs in a tab there.
			// (The defines themselves: other builds drop it.)
			inTab:
				typeof SITEGLOSS_TEST_BUILD !== "undefined" &&
				SITEGLOSS_TEST_BUILD &&
				typeof SITEGLOSS_FIREFOX !== "undefined" &&
				SITEGLOSS_FIREFOX,
		})
	) {
		port.disconnect();
		return;
	}
	// Until the connection has started (a worker that just woke), keep what
	// the panel says: Chrome hands a message only to the listeners there are.
	const early: unknown[] = [];
	const keep = (message: unknown) => void early.push(message);
	let gone = false;
	port.onMessage.addListener(keep);
	port.onDisconnect.addListener(() => {
		gone = true;
	});
	void ready.then(
		(c) => {
			port.onMessage.removeListener(keep);
			if (!gone) c.addPanel(port, early);
		},
		(error: unknown) => {
			// Not silence: the panel says AI access is not available, and why.
			port.onMessage.removeListener(keep);
			const news: WorkerMessage = {
				type: "failed",
				problem: error instanceof Error ? error.message : String(error),
			};
			try {
				if (!gone) port.postMessage(news);
			} catch {
				// Closed meanwhile.
			}
		},
	);
});

// The worker starts for these too, which connects again if AI access was on.
chrome.runtime.onInstalled.addListener(() => withConnection((c) => c.keepUp()));
chrome.runtime.onStartup.addListener(() => withConnection((c) => c.keepUp()));
chrome.alarms.onAlarm.addListener((alarm) => {
	if (cloud.alarm(alarm.name)) return;
	if (alarm.name === ALARM) withConnection((c) => c.keepUp());
});

/**
 * A notification's answer: its button Allow (0) or Always allow (1); a
 * click on its body, or the user closing it, is Don't allow. On the worker's
 * global object too, for the DevTools Protocol, which cannot click a
 * notification: the end-to-end tests answer through the same functions a
 * click calls.
 *
 * Firefox's notifications have no buttons and close by themselves, which
 * fires `onClosed` too, without `byUser`: there a notification only tells,
 * and a close is no answer. The question is answered in the sidebar, which
 * only the icon's click opens: Firefox lets `sidebarAction.open` run only in
 * a user input handler, and a notification's click is none. So a click on
 * one brings the question's window to the front, where the icon shows "?".
 */
function notificationButton(id: string, index: number): void {
	withConnection((c) => c.notificationButton(id, index));
}
function notificationDismissed(id: string): void {
	withConnection((c) => c.notificationDismissed(id));
}
if (FIREFOX)
	chrome.notifications.onClicked.addListener((id) =>
		withConnection((c) => {
			const windowId = c.notificationWindow(id);
			if (windowId !== undefined)
				void chrome.windows
					.update(windowId, { focused: true })
					.catch(() => undefined);
		}),
	);
else {
	chrome.notifications.onButtonClicked.addListener(notificationButton);
	chrome.notifications.onClicked.addListener(notificationDismissed);
	chrome.notifications.onClosed.addListener((id, byUser) => {
		if (byUser) notificationDismissed(id);
	});
}
Object.assign(globalThis, {
	siteglossNotificationButton: notificationButton,
	siteglossNotificationDismissed: notificationDismissed,
});

// Firefox stops an idle event page, its WebSocket to the relay with it:
// while AI access is on, an extension API call every FIREFOX_KEEPALIVE_MS
// keeps it (src/lib/browser.ts).
if (FIREFOX)
	setInterval(
		() =>
			withConnection((c) => {
				if (c.active) void chrome.runtime.getPlatformInfo().catch(() => {});
			}),
		FIREFOX_KEEPALIVE_MS,
	);
