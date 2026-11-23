/**
 * The picture viewer's window (DEC-064): a small window of the extension's
 * own (`type: "popup"`), centred over the browser window the panel belongs
 * to; it sizes itself to the picture once loaded. One per browser window:
 * a second picture is shown in it. It closes with its browser window. Kept
 * in session storage: the worker may sleep between a picture and the next.
 */

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

/** Show the picture in the browser window's viewer, opening one if it has none. */
export async function openViewer(
	caseId: string,
	markId: string,
	pictureId: string,
	from: number,
): Promise<number> {
	const url = viewerUrl(caseId, markId, pictureId, from);
	const all = await viewers();
	const open = all[String(from)];
	if (open !== undefined) {
		const shown = await chrome.tabs
			.update(open.tabId, { url })
			.then(() => chrome.windows.update(open.windowId, { focused: true }))
			.then(() => true)
			.catch(() => false);
		if (shown) return open.windowId;
	}
	const browser = await chrome.windows.get(from);
	const width = Math.round(Math.min(1280, (browser.width ?? 1280) * 0.85));
	const height = Math.round(Math.min(900, (browser.height ?? 900) * 0.85));
	const made = await chrome.windows.create({
		url,
		type: "popup",
		width,
		height,
		left: Math.round(
			(browser.left ?? 0) + ((browser.width ?? width) - width) / 2,
		),
		top: Math.round(
			(browser.top ?? 0) + ((browser.height ?? height) - height) / 2,
		),
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
