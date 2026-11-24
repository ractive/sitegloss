/**
 * Sitegloss's access to the pages, as the panel says it (DEC-076): what it
 * offers while it may not run on all sites, what it says where the tab in
 * front has no access, and the texts. Pure: `view.ts` draws it, the tests
 * check it for each state and both browsers.
 *
 * Sitegloss installs with `activeTab` only; `<all_urls>` is optional
 * (DEC-003, DEC-022). Without it, the browser hides a tab's address until
 * the icon is clicked on that tab, so the panel knows only "this tab: yes or
 * not yet", unless the browser's refusal itself says the page is one no
 * extension may run on (`refusalKind`). With it, a tab whose address is
 * still hidden is such a page too (the browser's own pages, or a file
 * without file access); so are the stores' pages, whose address shows.
 */

import type { PanelState } from "./state.ts";

/**
 * Whether Sitegloss may run on the tab in front, as far as the panel knows:
 * the browser tells the address only of a tab it may run on (a tab still
 * loading has none yet, and counts as yes). `ask`: not yet, the icon's click
 * or all sites lets it in. `never`: not even with all sites.
 */
export type TabAccess = "yes" | "ask" | "never";

/** Which browser's rules apply: the build says Firefox, the brands Edge (DEC-076). */
export type BrowserKind = "chrome" | "edge" | "firefox";

/**
 * Addresses no extension may run on in that browser (its restricted hosts),
 * matched on the address's start; the address shows only where Sitegloss may
 * see the tab. Only that browser's: in another, these are ordinary sites.
 */
const RESTRICTED_HOSTS: Record<BrowserKind, readonly string[]> = {
	chrome: [
		"https://chromewebstore.google.com/",
		"https://chrome.google.com/webstore",
	],
	edge: [
		"https://chromewebstore.google.com/",
		"https://chrome.google.com/webstore",
		"https://microsoftedge.microsoft.com/addons",
	],
	// Firefox's `extensions.webextensions.restrictedDomains`.
	firefox: [
		"https://accounts-static.cdn.mozilla.net/",
		"https://accounts.firefox.com/",
		"https://addons.cdn.mozilla.net/",
		"https://addons.mozilla.org/",
		"https://api.accounts.firefox.com/",
		"https://content.cdn.mozilla.net/",
		"https://discovery.addons.mozilla.org/",
		"https://install.mozilla.org/",
		"https://oauth.accounts.firefox.com/",
		"https://profile.accounts.firefox.com/",
		"https://support.mozilla.org/",
		"https://sync.services.mozilla.com/",
	],
};

/** The browsers' own pages and views, where an address shows at all. */
const RESTRICTED_SCHEMES = [
	"about:",
	"chrome:",
	"edge:",
	"view-source:",
	"devtools:",
];

/** Whether a visible address is one no extension may run on in this browser. */
export function isRestrictedUrl(url: string, browser: BrowserKind): boolean {
	return (
		RESTRICTED_SCHEMES.some((scheme) => url.startsWith(scheme)) ||
		RESTRICTED_HOSTS[browser].some((start) => url.startsWith(start))
	);
}

/**
 * From what is true now only (DEC-076): the address, the probe's answer of
 * this moment (`tab.cannotRun`), all sites. A refused action is no memory:
 * an error page, a tab still loading or a discarded one is back to normal
 * once the page is.
 */
export function tabAccess(
	tab: PanelState["tab"],
	allSites: boolean,
	browser: BrowserKind,
): TabAccess {
	if (tab === undefined) return "yes";
	if (tab.cannotRun !== undefined) return "never";
	if (tab.url !== "")
		return isRestrictedUrl(tab.url, browser) ? "never" : "yes";
	if (tab.loading) return "yes";
	return allSites ? "never" : "ask";
}

/**
 * What the browser's refusal to run on a tab says: `no-access` (no click on
 * the icon, no host access: the ways help), `cannot` (a page no extension
 * may run on: they do not), or nothing it recognises. The messages are the
 * browsers' own, tried on Chrome and Firefox (DEC-076).
 */
export function refusalKind(
	message: string,
): "no-access" | "cannot" | undefined {
	if (CANNOT.some((r) => r.test(message))) return "cannot";
	if (NO_ACCESS_RE.some((r) => r.test(message))) return "no-access";
	return undefined;
}

const CANNOT = [
	// Chrome and Edge: their own pages and other extensions' ("Cannot access a
	// chrome:// URL", tried), the store once Sitegloss may see it ("The
	// extensions gallery cannot be scripted.").
	/Cannot access an? [a-z-]+:\/\/ URL/i,
	/cannot be scripted/i,
];

// Without access the browsers say only that (tried: Chrome says it for the
// store and a PDF too, Firefox for addons.mozilla.org): no access yet.
const NO_ACCESS_RE = [
	/Cannot access contents of/i,
	/must request permission/i,
	/Missing host permission/i,
];

/** What the panel shows about access, for one state. */
export interface AccessPlan {
	/**
	 * The first-use offer of all sites (with Not now) at the top of Home:
	 * `for-tab` headed that this tab has no access yet, with the one-tab way
	 * (and no notice besides); `general` otherwise, also on a page no
	 * extension may run on, where the notice says that.
	 */
	offer: "general" | "for-tab" | undefined;
	/**
	 * Home's notice, in place of "New case for this page": `no-access`, with
	 * both ways on; `cannot`, a page no extension may run on, with no way.
	 */
	notice: "no-access" | "cannot" | undefined;
	/** The same in the open case's tool bar, in place of Add marks and Show/Hide marks. */
	inCase: "no-access" | "cannot" | undefined;
	/**
	 * What needs the page is there: New case for this page, Add marks,
	 * Show/Hide marks, a mark's Show. Absent otherwise, the sentence in its
	 * place: never a control that does nothing.
	 */
	pageControls: boolean;
}

export function accessPlan(input: {
	tab: TabAccess;
	allSites: boolean;
	/** "Not now" was pressed on the offer, or all sites was taken back. */
	declined: boolean;
	/**
	 * Whether the browser has said yet if Sitegloss may run on all sites: no
	 * offer before, so it does not flash for someone who allowed it.
	 */
	known: boolean;
}): AccessPlan {
	const { tab, allSites, declined, known } = input;
	const offering = known && !allSites && !declined;
	const inCase =
		tab === "never" ? "cannot" : tab === "ask" ? "no-access" : undefined;
	return {
		offer: !offering ? undefined : tab === "ask" ? "for-tab" : "general",
		notice: offering && tab === "ask" ? undefined : inCase,
		inCase,
		pageControls: tab === "yes",
	};
}

/** How the texts name the browser, its keys and its rules. */
export interface Words {
	firefox: boolean;
	/** "Chrome", "Edge", "Firefox"; `undefined`: another browser ("your browser"). */
	browser: string | undefined;
	/** The shortcut that clicks the icon, as the browser has it; `undefined`: none set. */
	shortcut: string | undefined;
}

/** The browser's name at the start of a sentence. */
const Browser = (w: Words) => w.browser ?? "Your browser";

/** The button that asks the browser for all sites, wherever it stands. */
export const ALLOW_ALL_SITES = "Allow on all sites";
/** The same where the tab is missing something: the recommendation goes with it. */
export const ALLOW_ALL_SITES_RECOMMENDED = "Allow on all sites (recommended)";
/** The option's label in Options (the owner's words: "highly recommended"). */
export const ALL_SITES_OPTION = "Allow on all sites (highly recommended)";

/** Why something is missing on Home: the tab in front has no access yet. */
export const NO_ACCESS_HOME =
	"Sitegloss has no access to this tab yet, so it cannot start a case or show marks here.";

/** Why the open case shows nothing on the tab in front. */
export const NO_ACCESS_CASE =
	"Sitegloss has no access to this tab yet, so this case's marks are not drawn here and cannot be shown or added.";

/**
 * The one-tab way. The icon is in the toolbar's Extensions menu (the puzzle
 * piece) in Chrome, Edge and Firefox until the person pins it; Firefox's
 * sidebar has an icon of Sitegloss too, which only opens the sidebar.
 */
export function oneTabWay(w: Words): string {
	return `For this tab only: ${clickTheIcon(w)}`;
}

/** The click that lets Sitegloss onto the tab in front, as the browser shows it. */
function clickTheIcon(w: Words): string {
	const key = w.shortcut === undefined ? "" : ` or press ${w.shortcut}`;
	return w.firefox
		? `click Sitegloss under the puzzle piece in the toolbar (or its icon, if pinned)${key}. Firefox lets it in until the tab goes to another page.`
		: `click the Sitegloss icon in the toolbar (under the puzzle piece until you pin it)${key}.`;
}

/** What the browser's prompt calls the permission (Chromium's words outside Firefox). */
export function promptName(firefox: boolean): string {
	return firefox
		? "Access your data for all websites"
		: "Read and change all your data on all websites";
}

/**
 * The first-use offer's head and sentence. On a tab without access the head
 * is that (with the warning sign): the reason something is missing comes
 * first, the offer is the way out.
 */
export function offerText(
	forTab: boolean,
	w: Words,
): { head: string; text: string } {
	return forTab
		? {
				head: "Sitegloss has no access to this tab yet",
				text: `Allowed on all sites (recommended), it works on every tab without a click on its icon first, and an open case's marks show wherever you go. ${Browser(w)} asks you first.`,
			}
		: {
				head: "Let Sitegloss work on every tab (recommended)",
				text: `Allowed on all sites, Sitegloss works on every tab without a click on its icon first, and an open case's marks show wherever you go. ${Browser(w)} asks you first.`,
			};
}

/**
 * Under the option: what happens without it, and what allowing it means.
 * Checked against the code and PRIVACY.md: no script goes into a page by
 * itself; with all sites the panel reads and draws on the tab in front when
 * a case is open or the person marks, and, while AI access is on, an AI
 * app's read tools (a screenshot, an element's details) work on whatever tab
 * is in front without a question (changes are asked). Not "the tab in front
 * only": "Fill in the code for me", when it is on, reads the relay's pairing
 * page in whichever tab an AI app opened it. Nothing leaves the computer
 * because of the permission.
 */
export function optionNote(w: Words): string {
	return `Without it, Sitegloss works on a tab only after you click its icon there${w.firefox ? ", until the tab goes to another page" : ""}; on other tabs your marks are not drawn and cannot be shown. With it, Sitegloss can read the page in front whenever you use it and, while AI access is on, whenever a connected AI app asks (a screenshot, an element's details), on any site. It sends nothing anywhere by itself. ${Browser(w)} asks first (“${promptName(w.firefox)}”).`;
}

/** A hint after an action that needed the page found no access. */
export function noAccessHint(w: Words): string {
	return `Sitegloss has no access to this tab yet. Allow it on all sites (under Options), or ${clickTheIcon(w)}`;
}

/**
 * What a refused action says (DEC-076), from what is true now and nothing
 * remembered: the browser's own "cannot" words; else, where the ways cannot
 * help (all sites is allowed, or the browser let Sitegloss see the tab, so a
 * click is in already), that the page could not be reached and to reload
 * it; else no access yet, with the ways.
 */
export function refusalHint(
	message: string,
	now: { allSites: boolean; addressShown: boolean },
): "cannot" | "unreachable" | "no-access" {
	if (refusalKind(message) === "cannot") return "cannot";
	if (now.allSites || now.addressShown) return "unreachable";
	return "no-access";
}

/** Sitegloss could not reach a page the ways cannot help with: reload, nothing more. */
export function unreachableText(w: Words): string {
	return `Sitegloss could not reach this page. Reload it and try again.${w.firefox ? " (A PDF in Firefox's viewer refuses every extension.)" : ""}`;
}

/** The page is one no extension may run on: no way helps. */
export function cannotRunText(w: Words): string {
	return w.firefox
		? "Sitegloss cannot work on this kind of page: Firefox keeps its own pages (about:), addons.mozilla.org and PDFs in its viewer off limits to extensions."
		: `Sitegloss cannot work on this kind of page: ${w.browser ?? "the browser"} keeps its own pages, other extensions' pages and its extension store off limits to extensions.`;
}

/**
 * Whether opening one of the case's pages asks for its site in the click.
 * Not in Firefox: its prompt belongs to the tab in front, and the click
 * that asks also opens a tab or navigates this one, so Firefox takes the
 * prompt away before anyone sees it and answers no (tested, DEC-076). Not
 * for a site the person said no to while this panel is open.
 */
export function asksForSite(
	pattern: string | undefined,
	declined: ReadonlySet<string>,
	firefox: boolean,
): pattern is string {
	return pattern !== undefined && !declined.has(pattern) && !firefox;
}

// --- what this browser remembers ------------------------------------------------

/** Where this browser keeps "Not now": the panel's own storage, not a case, not synced. */
export const DECLINED = "sitegloss.allSitesDeclined";
/** That all sites was allowed once: a later "not allowed" is a take-back. */
const WAS_ALLOWED = "sitegloss.allSitesWasAllowed";

/** What the panel remembers about all sites in this browser. */
export interface AccessMemory {
	/** "Not now", or all sites taken back: the offer does not come again. */
	declined: boolean;
	/** All sites was allowed when a panel last looked. */
	wasAllowed: boolean;
}

export function readMemory(
	storage: Pick<Storage, "getItem"> | undefined,
): AccessMemory {
	if (storage === undefined) return { declined: false, wasAllowed: false };
	try {
		return {
			declined: storage.getItem(DECLINED) !== null,
			wasAllowed: storage.getItem(WAS_ALLOWED) !== null,
		};
	} catch {
		// No storage (a private window that refuses it): offered again.
		return { declined: false, wasAllowed: false };
	}
}

export function writeMemory(
	storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
	memory: AccessMemory,
): void {
	if (storage === undefined) return;
	try {
		if (memory.declined) storage.setItem(DECLINED, "1");
		else storage.removeItem(DECLINED);
		if (memory.wasAllowed) storage.setItem(WAS_ALLOWED, "1");
		else storage.removeItem(WAS_ALLOWED);
	} catch {
		// No storage: the panel holds it until it closes.
	}
}

/**
 * The browser's answer whether all sites is allowed, against what this
 * browser remembers: allowed once and not now is a take-back (unticked here,
 * or in the browser's settings while no panel was open), which counts as a
 * no, so the offer does not come after it.
 */
export function afterAnswer(
	memory: AccessMemory,
	granted: boolean,
): AccessMemory {
	return {
		declined: memory.declined || (memory.wasAllowed && !granted),
		wasAllowed: granted,
	};
}

// --- the browser's own names ---------------------------------------------------

/**
 * The browser's name in the texts: the build says Firefox; among the
 * Chromium browsers the brands do (Chrome or Edge), and any other is "your
 * browser". It names, it never decides anything (`src/lib/browser.ts`).
 */
export function browserLabel(
	firefox: boolean,
	brands: readonly { brand: string }[] | undefined,
): string | undefined {
	if (firefox) return "Firefox";
	const names = (brands ?? []).map((b) => b.brand);
	if (names.includes("Microsoft Edge")) return "Edge";
	if (names.includes("Google Chrome")) return "Chrome";
	return undefined;
}

/** What tells the keyboard's platform (as `isMac` in `src/content/overlay.ts`). */
export interface Platform {
	platform?: string;
	userAgentData?: { platform?: string };
}

/**
 * The icon's shortcut as the browser keeps it (`commands.getAll()`, the
 * person may have changed it or the browser left it unset), in the panel's
 * style: on a Mac the symbols (⌥⇧O, as "⌘C" elsewhere in the panel).
 * Chrome on a Mac gives the symbols already; Firefox gives "Alt+Shift+O",
 * where Alt is Option and Ctrl is Command.
 */
export function shortcutText(
	raw: string | undefined,
	nav: Platform,
): string | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const mac = /mac/i.test(nav.userAgentData?.platform || nav.platform || "");
	if (!mac || !raw.includes("+")) return raw;
	const symbol: Record<string, string> = {
		Alt: "⌥",
		Option: "⌥",
		Shift: "⇧",
		Ctrl: "⌘",
		Command: "⌘",
		MacCtrl: "⌃",
	};
	return raw
		.split("+")
		.map((part) => symbol[part] ?? part)
		.join("");
}
