/**
 * What differs between Chrome (and Edge) and Firefox, in one place: Chrome's
 * side panel is Firefox's sidebar, Firefox's notifications have no buttons,
 * Firefox has no offscreen documents, and the pages and settings the texts
 * name are other ones. The build decides (`scripts/build.ts --firefox`, a
 * `define`), never the user agent; without it (the unit tests) it is Chrome.
 *
 * The bundler does not inline these constants across modules: a branch on
 * them elsewhere stays in every build, never taken where it does not apply.
 * Code that must not be in a build at all (a test build's hooks) tests the
 * defines themselves where it is, as `background.ts` does.
 */

declare const SITEGLOSS_FIREFOX: boolean | undefined;
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** `true` in the Firefox build only. */
export const FIREFOX: boolean =
	typeof SITEGLOSS_FIREFOX !== "undefined" && SITEGLOSS_FIREFOX;

/** The browser's name, in the texts the user reads. */
export const BROWSER: string = FIREFOX ? "Firefox" : "Chrome";

/** What the panel is called: Chrome's side panel, Firefox's sidebar. */
export const PANEL: string = FIREFOX ? "sidebar" : "side panel";

/** The browser's own pages and store, which no extension may run on. */
export const CANNOT_RUN_TEXT: string = FIREFOX
	? "Sitegloss cannot run on this tab: Firefox keeps its own pages (about:) and addons.mozilla.org off limits to extensions."
	: "Sitegloss cannot run on this tab: Chrome keeps its own pages and the Chrome Web Store off limits to extensions.";

/**
 * The data Sitegloss hands to the AI app once AI access is on (Firefox's
 * data collection consent, `browser_specific_settings.gecko`): the pages'
 * content (marks, comments, screenshots, element details) and their
 * addresses. Nothing goes anywhere before AI access is turned on.
 */
export const DATA_COLLECTION = ["websiteContent", "browsingActivity"] as const;

/**
 * `permissions.request`, which shows the browser's prompt only during the
 * user's click: call it in the click, before any await. Firefox's test
 * build first sees whether it has them already (granted at install):
 * automation's clicks are no user input to Firefox, which refuses a request
 * outside one even for what it has.
 */
export function requestPermissions(
	permissions: chrome.permissions.Permissions,
): Promise<boolean> {
	// The defines themselves, not the constants: other builds drop it.
	if (
		typeof SITEGLOSS_FIREFOX !== "undefined" &&
		SITEGLOSS_FIREFOX &&
		typeof SITEGLOSS_TEST_BUILD !== "undefined" &&
		SITEGLOSS_TEST_BUILD
	)
		return chrome.permissions
			.contains(permissions)
			.then((yes) => yes || chrome.permissions.request(permissions));
	return chrome.permissions.request(permissions);
}

/** Firefox's `permissions` with the data collection consent. */
interface FirefoxPermissions {
	request(p: { data_collection: readonly string[] }): Promise<boolean>;
	contains(p: { data_collection: readonly string[] }): Promise<boolean>;
}

const firefoxPermissions = (): FirefoxPermissions =>
	chrome.permissions as unknown as FirefoxPermissions;

/**
 * Whether the user agreed that the AI app gets the pages' content and
 * addresses: always in Chrome, which asks nothing of the kind; in Firefox,
 * the data collection consent.
 */
export async function dataConsent(): Promise<boolean> {
	if (!FIREFOX) return true;
	return firefoxPermissions().contains({ data_collection: DATA_COLLECTION });
}

/**
 * Ask Firefox for the data collection consent; `true` at once in Chrome. It
 * needs the user's click: call it in the click, before any `await`.
 */
export function askDataConsent(): Promise<boolean> {
	if (!FIREFOX) return Promise.resolve(true);
	const wanted = { data_collection: DATA_COLLECTION };
	// The test build has it at install (see `requestPermissions`).
	if (typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD)
		return firefoxPermissions()
			.contains(wanted)
			.then((yes) => yes || firefoxPermissions().request(wanted));
	return firefoxPermissions().request(wanted);
}

/**
 * The same, where Sitegloss may not read files either: where the user lets
 * it (Firefox lets no extension open its add-ons page, so the text says the
 * way there).
 */
export const CANNOT_RUN_FILES_TEXT: string = FIREFOX
	? "Sitegloss cannot run on this tab. A page of Firefox's own (about:) or addons.mozilla.org is off limits to extensions. For a file on your computer, turn on “Access local files on your computer” in Firefox's Add-ons and themes: Sitegloss, Permissions and data."
	: "Sitegloss cannot run on this tab. A page of Chrome's own or the Chrome Web Store is off limits to extensions. A file on your computer needs “Allow access to file URLs” in Sitegloss's details.";

/** Firefox's `browser.sidebarAction`, the part used here. */
export interface SidebarAction {
	open(): Promise<void>;
	isOpen(details: { windowId?: number }): Promise<boolean>;
}

/**
 * Open Firefox's sidebar: `open()` takes no window and opens it in the
 * window in front, which need not be `windowId`. Rejects unless `windowId`'s
 * sidebar is open after it (no window given: the one in front's is meant).
 * `open()` is called at once, in the gesture.
 */
export function openSidebar(
	action: SidebarAction | undefined,
	windowId?: number,
): Promise<void> {
	if (action === undefined)
		return Promise.reject(new Error("no sidebarAction"));
	return action.open().then(async () => {
		if (windowId !== undefined && !(await action.isOpen({ windowId })))
			throw new Error("the sidebar opened in another window");
	});
}

/**
 * Open the panel for `tabId` in `windowId`: Chrome's side panel, or
 * Firefox's sidebar. Both need the user's gesture (Firefox only takes one
 * from a user input handler, such as the icon's click): no `await` before
 * this.
 */
export function openPanel(options: {
	tabId?: number;
	windowId: number;
}): Promise<void> {
	if (FIREFOX)
		return openSidebar(
			(globalThis as { browser?: { sidebarAction?: SidebarAction } }).browser
				?.sidebarAction,
			options.windowId,
		);
	return chrome.sidePanel.open(
		options.tabId === undefined
			? { windowId: options.windowId }
			: { tabId: options.tabId, windowId: options.windowId },
	);
}

/** `identity`, the part used here: the same calls in Chrome and Firefox. */
interface Identity {
	getRedirectURL(path?: string): string;
	launchWebAuthFlow(details: {
		url: string;
		interactive: boolean;
	}): Promise<string | undefined>;
}

const identity = (): Identity =>
	(chrome as unknown as { identity: Identity }).identity;

/**
 * Where the browser's sign-in window ends for this extension (DEC-039): a
 * address no site has, which the browser keeps to itself. Chrome's is
 * `https://<extension id>.chromiumapp.org/`; Firefox's is
 * `https://<hash of the add-on's id>.extensions.allizom.org/`. The server
 * allows both, by name.
 */
/**
 * The page of the extension's background, as a message's `sender.url` names
 * it: Chromium's service worker (`background.js`); in Firefox the event page
 * the browser makes for `background.scripts`.
 */
export const BACKGROUND_PAGE: string = FIREFOX
	? "_generated_background_page.html"
	: "background.js";

/**
 * A message from this extension's background, and only from there: not a
 * content script (it has a tab), not another extension page (another
 * window's panel, the offscreen document).
 */
export function fromBackground(
	sender: { id?: string; url?: string; tab?: unknown },
	runtime: { id: string; getURL(path: string): string } = chrome.runtime,
): boolean {
	return (
		sender.id === runtime.id &&
		sender.tab === undefined &&
		sender.url === runtime.getURL(BACKGROUND_PAGE)
	);
}

export function signInRedirect(): string {
	return identity().getRedirectURL();
}

/**
 * Open the browser's own sign-in window on `url` and answer the address it
 * ended on (`identity.launchWebAuthFlow`, the same in both browsers).
 * Rejects when the user closes the window. Called from the side panel, a
 * page that stays open while the user signs in.
 */
export function webAuthFlow(url: string): Promise<string | undefined> {
	return identity().launchWebAuthFlow({ url, interactive: true });
}

/** A notification's options; Firefox takes no buttons and no `requireInteraction`. */
export function notificationOptions(
	options: chrome.notifications.NotificationCreateOptions,
): chrome.notifications.NotificationCreateOptions {
	if (!FIREFOX) return options;
	const { buttons: _b, requireInteraction: _r, ...rest } = options;
	return rest;
}
