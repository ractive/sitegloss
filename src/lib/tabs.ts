/**
 * Talking to the content script of a tab from an extension page or the
 * service worker, injecting it first when it is not there yet.
 */

import { FIREFOX } from "./browser.ts";
import {
	CONTENT_SCRIPT,
	type ContentAnswer,
	type ContentRequest,
} from "./messages.ts";

/** Sitegloss may not run on this tab (no click on the icon, no host access). */
export class NoAccessError extends Error {
	override name = "NoAccessError";
}

/**
 * The content script's file as `executeScript` takes it: Chrome reads it
 * from the extension's root, Firefox from the calling page's folder unless
 * the path starts with "/" (the side panel's would be `sidepanel/content.js`).
 */
const SCRIPT_FILE = FIREFOX ? `/${CONTENT_SCRIPT}` : CONTENT_SCRIPT;

/** Inject the content script; it ignores a second injection. */
export async function inject(tabId: number): Promise<void> {
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId },
			files: [SCRIPT_FILE],
		});
		// Firefox reports a script that did not run in the result, not by
		// rejecting as Chrome does.
		const failed = FIREFOX
			? (results as { error?: unknown }[]).find((r) => r.error !== undefined)
			: undefined;
		if (failed !== undefined) throw failed.error;
	} catch (error) {
		throw new NoAccessError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

/** How long a click waits for a page that is still on its way. */
export const CLICK_LOAD_WAIT_MS = 30_000;

/** After a refusal right after a click, the wait before one more try. */
export const CLICK_RETRY_MS = 250;

/**
 * Resolves once the tab's new page is there: it has loaded, or the address
 * the tab was on its way to (`pendingUrl`, as the click saw it) has become
 * its address, which Chrome says only while Sitegloss may see it: that page
 * committed, and `executeScript` waits for it to be idle by itself. Another
 * address (a redirect, the old page's own `pushState`) waits for the load.
 * `false` if the tab was closed first or neither came within `timeoutMs`.
 * Best effort: the listeners live in the worker, and a worker Chrome stops
 * meanwhile takes them along (then nothing is injected again, as before).
 */
function loaded(
	tabId: number,
	pendingUrl: string | undefined,
	timeoutMs: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		const done = (ok: boolean) => {
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(updated);
			chrome.tabs.onRemoved.removeListener(removed);
			resolve(ok);
		};
		const updated = (id: number, info: { status?: string; url?: string }) => {
			if (id !== tabId) return;
			if (
				info.status === "complete" ||
				(pendingUrl !== undefined && info.url === pendingUrl)
			)
				done(true);
		};
		const removed = (id: number) => {
			if (id === tabId) done(false);
		};
		const timer = setTimeout(() => done(false), timeoutMs);
		chrome.tabs.onUpdated.addListener(updated);
		chrome.tabs.onRemoved.addListener(removed);
		// It may have come before the listeners were there.
		chrome.tabs.get(tabId).then(
			(tab) => {
				if (
					tab.status === "complete" ||
					(pendingUrl !== undefined && tab.url === pendingUrl)
				)
					done(true);
			},
			() => done(false),
		);
	});
}

/**
 * Inject after a click on the icon, which grants the tab's page to
 * Sitegloss. Two things in Chrome make one try not enough:
 *
 * - Clicked while the tab loads, the page the script would go into is the
 *   one on its way out, and the next one comes without it. The grant holds
 *   across a navigation within the origin (a reload, a link on the same
 *   scheme, host and port), so once the new page is there the script goes
 *   in again. A page of another origin is not granted, and is refused
 *   quietly: a new tab's first page, or a redirect to another host of the
 *   same site (example.com to www.example.com, http to https). The panel
 *   then asks for the click again, and the user clicks again.
 * - Right after a click on a loaded page Chrome now and then refuses the
 *   script; a moment later it lets it in.
 */
export async function injectOnClick(
	tab: Pick<chrome.tabs.Tab, "id" | "status" | "pendingUrl">,
	options: { loadWaitMs?: number; retryMs?: number } = {},
): Promise<void> {
	const { loadWaitMs = CLICK_LOAD_WAIT_MS, retryMs = CLICK_RETRY_MS } = options;
	const id = tab.id;
	if (id === undefined) return;
	if (tab.status === "loading") {
		const first = await inject(id).then(
			() => undefined,
			(error: unknown) => error,
		);
		if (!(await loaded(id, tab.pendingUrl, loadWaitMs))) {
			if (first !== undefined) throw first;
			return;
		}
		return inject(id);
	}
	try {
		await inject(id);
	} catch {
		// No content script yet: once more after a pause.
		await new Promise((resolve) => setTimeout(resolve, retryMs));
		await inject(id);
	}
}

/**
 * Ask the tab's content script, without injecting it: rejects where there
 * is none.
 */
export function askTab<R extends ContentRequest>(
	tabId: number,
	request: R,
): Promise<ContentAnswer<R>> {
	return chrome.tabs.sendMessage(tabId, request);
}

/** Send a request to the tab's content script, injecting it if needed. */
export async function sendToTab<R extends ContentRequest>(
	tabId: number,
	request: R,
): Promise<ContentAnswer<R>> {
	try {
		return await askTab(tabId, request);
	} catch {
		// No content script yet (or the page navigated): inject and try once more.
		await inject(tabId);
		return await askTab(tabId, request);
	}
}
