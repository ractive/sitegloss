/**
 * What differs between Chrome and Firefox (`src/lib/browser.ts`): the unit
 * tests run as Chrome, without the build's define; Firefox's parts that take
 * their inputs are tested with them.
 */

import { describe, expect, test } from "bun:test";
import {
	askDataConsent,
	BACKGROUND_PAGE,
	BROWSER,
	CANNOT_RUN_TEXT,
	DATA_COLLECTION,
	dataConsent,
	FIREFOX,
	fromBackground,
	notificationOptions,
	openSidebar,
	PANEL,
	type SidebarAction,
} from "../src/lib/browser.ts";
import { windowParam } from "../src/sidepanel/window.ts";
import type { QuestionView } from "../src/worker/protocol.ts";
import {
	FIREFOX_ANSWER,
	MAX_NOTIFICATION_MESSAGE,
	NOTIFICATION_BUTTONS,
	notificationText,
} from "../src/worker/questions.ts";

describe("without the build's define it is Chrome", () => {
	test("Chrome's names and words", () => {
		expect(FIREFOX).toBe(false);
		expect(BROWSER).toBe("Chrome");
		expect(PANEL).toBe("side panel");
		expect(CANNOT_RUN_TEXT).toContain("Chrome Web Store");
	});

	test("notifications keep their buttons and stay until answered", () => {
		const options: chrome.notifications.NotificationCreateOptions = {
			type: "basic",
			iconUrl: "icon.png",
			title: "t",
			message: "m",
			buttons: [{ title: "Allow" }],
			requireInteraction: true,
		};
		expect(notificationOptions(options)).toBe(options);
	});

	test("no data collection consent to ask for: always given", async () => {
		expect(await dataConsent()).toBe(true);
		expect(await askDataConsent()).toBe(true);
		// What Firefox's would cover: the pages' content and their addresses.
		expect([...DATA_COLLECTION]).toEqual([
			"websiteContent",
			"browsingActivity",
		]);
	});
});

describe("Firefox's sidebar", () => {
	const action = (openIn: number | undefined) => {
		const calls: string[] = [];
		const a: SidebarAction = {
			open: async () => {
				calls.push("open");
			},
			isOpen: async ({ windowId }) => {
				calls.push(`isOpen ${windowId}`);
				return windowId === openIn;
			},
		};
		return { a, calls };
	};

	test("opens at once, then checks the window it was meant for", async () => {
		const { a, calls } = action(3);
		const opening = openSidebar(a, 3);
		// In the gesture: before anything is awaited.
		expect(calls).toEqual(["open"]);
		await opening;
		expect(calls).toEqual(["open", "isOpen 3"]);
	});

	test("rejects when it opened in another window, or there is no sidebar", async () => {
		await expect(openSidebar(action(4).a, 3)).rejects.toThrow("another window");
		await expect(openSidebar(undefined, 3)).rejects.toThrow("no sidebarAction");
	});

	test("without a window: the one in front, unchecked", async () => {
		const { a, calls } = action(undefined);
		await openSidebar(a);
		expect(calls).toEqual(["open"]);
	});
});

describe("Firefox's notifications of a question", () => {
	const view: QuestionView = {
		id: "q",
		app: "Claude (claude.ai)",
		tool: "set_summary",
		title: "Record the summary",
		lines: ["Case: “Checkout” (example.com/cart, 2 marks)."],
		args: "{}",
		expiresAt: 0,
	};

	test("no buttons: they say where to answer, and the whole of it fits", () => {
		const text = notificationText(view, '{"summary":"x"}', true);
		expect(text.buttons).toEqual([]);
		expect(text.message).toEndWith(FIREFOX_ANSWER);
		expect(text.message).toContain("Case: “Checkout”");
		expect(text.message.length).toBeLessThanOrEqual(MAX_NOTIFICATION_MESSAGE);
		expect(text.contextMessage).toBe("Sitegloss · answer in its sidebar");
		// Only the icon opens Firefox's sidebar: a notification's click cannot.
		expect(FIREFOX_ANSWER).toContain("click the Sitegloss icon");
		expect(text.message).not.toContain("click this");
		const long = notificationText(
			{ ...view, lines: ["x".repeat(1000)] },
			"{}",
			true,
		);
		expect(long.message.length).toBeLessThanOrEqual(MAX_NOTIFICATION_MESSAGE);
		expect(long.message).toEndWith(FIREFOX_ANSWER);
	});

	test("Chrome's keep Allow and Always allow", () => {
		expect(notificationText(view, "{}").buttons).toBe(NOTIFICATION_BUTTONS);
	});
});

describe("the panel's window in Firefox's test build", () => {
	test("?window= names a window by its number only", () => {
		expect(windowParam("?window=31")).toBe(31);
		expect(windowParam("")).toBeUndefined();
		expect(windowParam("?window=")).toBeUndefined();
		expect(windowParam("?window=-1")).toBeUndefined();
		expect(windowParam("?window=3x")).toBeUndefined();
		expect(windowParam("?other=1")).toBeUndefined();
	});
});

describe("a message from the background only (review of DEC-050)", () => {
	const runtime = {
		id: "ext",
		getURL: (path: string) => `chrome-extension://ext/${path}`,
	};
	test("the worker's address, no tab, this extension; nothing else", () => {
		const worker = { id: "ext", url: "chrome-extension://ext/background.js" };
		expect(BACKGROUND_PAGE).toBe("background.js");
		expect(fromBackground(worker, runtime)).toBe(true);
		// Another window's panel, the offscreen document: extension pages, no tab.
		for (const page of ["sidepanel/index.html", "offscreen/index.html"])
			expect(
				fromBackground(
					{ id: "ext", url: `chrome-extension://ext/${page}` },
					runtime,
				),
			).toBe(false);
		// A content script has a tab; another extension another id.
		expect(fromBackground({ ...worker, tab: { id: 3 } }, runtime)).toBe(false);
		expect(fromBackground({ ...worker, id: "other" }, runtime)).toBe(false);
		expect(fromBackground({ id: "ext" }, runtime)).toBe(false);
	});
});
