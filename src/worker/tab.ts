/**
 * The tab the AI app's tools act on, from the service worker: the active
 * tab of the last focused normal window (the side panel's window no longer
 * applies, DEC-015).
 */

import { PANEL } from "../lib/browser.ts";
import { debugLog } from "../lib/debug.ts";
import { handedCase } from "../lib/messages.ts";
import { NoAccessError, sendToTab } from "../lib/tabs.ts";
import type { TabBridge } from "./tools.ts";

/** An access problem gets a hint for the AI app; other errors stay as they are. */
function accessError(message: string): Error {
	return /permission|cannot access|activeTab|all_urls/i.test(message)
		? new Error(
				`Sitegloss may not take a screenshot of this tab (${message}). The user can click the Sitegloss icon on the tab, or turn on "Allow on all sites" in the ${PANEL}.`,
			)
		: new Error(message);
}

/** The worker's screenshot of a tab that must be in front of its window (a PNG data URL). */
export type Capture = (tabId: number, windowId: number) => Promise<string>;

/** The tab in front, if there is one. */
export async function tabInFront(): Promise<chrome.tabs.Tab | undefined> {
	const win = await chrome.windows
		.getLastFocused({ windowTypes: ["normal"] })
		.catch((error: unknown) => debugLog("front window", error));
	if (win?.id === undefined) return undefined;
	const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
	return tab;
}

export function workerTab(
	capture: Capture,
	/** The page is handed the case (tab-cases.ts): before it gets it. */
	handed?: (tabId: number, caseId: string, adding: boolean) => Promise<void>,
): TabBridge {
	return {
		async current() {
			const tab = await tabInFront();
			if (tab?.id === undefined || tab.windowId === undefined)
				throw new Error("No tab is in front.");
			return {
				id: tab.id,
				windowId: tab.windowId,
				url: tab.url ?? "",
				title: tab.title ?? "",
			};
		},
		async send(tabId, request) {
			const given = handedCase(request);
			if (given !== undefined)
				await handed?.(tabId, given.caseId, given.adding).catch(
					(error: unknown) => debugLog("hand case to worker", error),
				);
			try {
				return await sendToTab(tabId, request);
			} catch (error) {
				throw error instanceof NoAccessError
					? accessError(error.message)
					: error;
			}
		},
		async capture(tab) {
			// The worker's queue keeps to Chrome's two captures a second, and
			// checks that the tab is in front before and after.
			let dataUrl: string;
			try {
				dataUrl = await capture(tab.id, tab.windowId);
			} catch (error) {
				throw accessError(
					error instanceof Error ? error.message : String(error),
				);
			}
			return await (await fetch(dataUrl)).blob();
		},
	};
}
