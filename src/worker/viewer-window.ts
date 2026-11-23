/**
 * The picture viewer's window (DEC-064): a small window of the extension's
 * own (`type: "popup"`), centred over the browser window the panel belongs
 * to; it sizes itself to the picture once loaded. One per browser window:
 * a second picture is shown in it. It closes with its browser window. Kept
 * in session storage: the worker may sleep between a picture and the next.
 */

import { viewerBounds } from "../viewer/layout.ts";
import { viewerPath } from "../viewer/pictures.ts";

const KEY = "sitegloss.viewers";

/** By browser window: its viewer's window and tab. */
type Viewers = Record<string, { windowId: number; tabId: number }>;

async function viewers(): Promise<Viewers> {
	const kept = await chrome.storage.session.get(KEY);
	return (kept[KEY] as Viewers | undefined) ?? {};
}

const keep = (all: Viewers) => chrome.storage.session.set({ [KEY]: all });

/** The viewer's address: the picture, and the browser window it is over. */
export function viewerUrl(
	caseId: string,
	markId: string,
	pictureId: string,
	from: number,
): string {
	return chrome.runtime.getURL(
		`${viewerPath(caseId, markId, pictureId)}&window=1&from=${from}`,
	);
}

/** A window's size and place as the panel worked it out (`viewerBounds`). */
export interface ViewerBounds {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** What the panel tells of the picture, the browser window and the screen. */
export interface ViewerLayout {
	picture?: { width: number; height: number };
	over: ViewerBounds;
	screen: ViewerBounds;
}

const number = (n: unknown) =>
	typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100_000;
const box = (b: unknown) => {
	const x = b as Partial<ViewerBounds> | undefined;
	return (
		x !== undefined &&
		[x.left, x.top, x.width, x.height].every(number) &&
		(x.width ?? 0) > 0 &&
		(x.height ?? 0) > 0
	);
};

/** Numbers within reason, from the panel: nothing else goes on to Chrome. */
export function viewerLayoutOk(l: ViewerLayout): boolean {
	const p = l.picture;
	return (
		box(l.over) &&
		box(l.screen) &&
		(p === undefined ||
			(number(p.width) && number(p.height) && p.width > 0 && p.height > 0))
	);
}

const FRAME_KEY = "sitegloss.viewerFrame";

/** The frame above the viewer's page, as the last viewer measured it. */
export async function rememberFrame(height: number): Promise<void> {
	if (!Number.isInteger(height) || height < 0 || height > 400) return;
	await chrome.storage.local.set({ [FRAME_KEY]: height });
}

/** The window's bounds for a layout: `viewerBounds` with the frame last measured. */
export async function boundsFor(layout: ViewerLayout): Promise<ViewerBounds> {
	const kept = await chrome.storage.local.get(FRAME_KEY).catch(() => ({}));
	const frame = (kept as Record<string, unknown>)[FRAME_KEY];
	return viewerBounds(
		layout.picture,
		layout.over,
		layout.screen,
		typeof frame === "number" ? frame : undefined,
	);
}

/** One after the other per browser window: two quick clicks, one window. */
const queues = new Map<number, Promise<unknown>>();

/** Show the picture in the browser window's viewer, opening one if it has none. */
export function openViewer(
	caseId: string,
	markId: string,
	pictureId: string,
	from: number,
	bounds?: ViewerBounds,
): Promise<number> {
	const before = queues.get(from) ?? Promise.resolve();
	const next = before
		.catch(() => undefined)
		.then(() => showInViewer(caseId, markId, pictureId, from, bounds));
	queues.set(from, next);
	// Cleaned up either way; a failed open is the caller's to handle, not
	// an uncaught rejection of this chain (DEC-064's second review).
	const cleanup = () => {
		if (queues.get(from) === next) queues.delete(from);
	};
	next.then(cleanup, cleanup);
	return next;
}

async function showInViewer(
	caseId: string,
	markId: string,
	pictureId: string,
	from: number,
	bounds: ViewerBounds | undefined,
): Promise<number> {
	const url = viewerUrl(caseId, markId, pictureId, from);
	const all = await viewers();
	const open = all[String(from)];
	if (open !== undefined) {
		// Only the tab still in the viewer's window: one moved out of it (to a
		// window of its own) is the person's now, not navigated.
		const tab = await chrome.tabs.get(open.tabId).catch(() => undefined);
		const shown =
			tab?.windowId === open.windowId &&
			(await Promise.all([
				// The picture and the window's size change together: the new
				// page shows its picture only once decoded (DEC-064).
				chrome.tabs.update(open.tabId, { url }),
				chrome.windows.update(open.windowId, {
					...(bounds ?? {}),
					focused: true,
				}),
			])
				.then(() => true)
				.catch(() => false));
		if (shown) return open.windowId;
	}
	// At its size and place in one step, as the panel worked it out from
	// the picture's size and the screen: no resize once it is shown.
	const place =
		bounds ??
		(await (async () => {
			const browser = await chrome.windows.get(from);
			const width = Math.round(Math.min(1280, (browser.width ?? 1280) * 0.85));
			const height = Math.round(Math.min(900, (browser.height ?? 900) * 0.85));
			return {
				width,
				height,
				left: Math.round(
					(browser.left ?? 0) + ((browser.width ?? width) - width) / 2,
				),
				top: Math.round(
					(browser.top ?? 0) + ((browser.height ?? height) - height) / 2,
				),
			};
		})());
	const made = await chrome.windows.create({
		url,
		type: "popup",
		...place,
		focused: true,
	});
	const tabId = made?.tabs?.[0]?.id;
	if (made?.id === undefined || tabId === undefined)
		throw new Error("the viewer's window did not open");
	await keep({
		...(await viewers()),
		[String(from)]: { windowId: made.id, tabId },
	});
	return made.id;
}

/** A window closed: a browser window takes its viewer with it; a viewer is forgotten. */
export async function windowClosed(windowId: number): Promise<void> {
	const all = await viewers();
	let changed = false;
	for (const [from, viewer] of Object.entries(all)) {
		if (Number(from) === windowId) {
			await chrome.windows.remove(viewer.windowId).catch(() => undefined);
			delete all[from];
			changed = true;
		} else if (viewer.windowId === windowId) {
			delete all[from];
			changed = true;
		}
	}
	if (changed) await keep(all);
}
