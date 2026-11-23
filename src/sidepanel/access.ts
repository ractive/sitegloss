/**
 * Sitegloss's access to the pages, as the panel says it (DEC-076): what it
 * offers while it may not run on all sites, what it says where the tab in
 * front has no access, and the texts. Pure: `view.ts` draws it, the tests
 * check it for each state and both browsers.
 *
 * Sitegloss installs with `activeTab` only; `<all_urls>` is optional
 * (DEC-003, DEC-022). Without it, the browser hides a tab's address until
 * the icon is clicked on that tab, so the panel knows only "this tab: yes or
 * not yet". With it, a tab whose address is still hidden is one no extension
 * may run on (the browser's own pages, its store, or a file without file
 * access).
 */

import type { PanelState } from "./state.ts";

/**
 * Whether Sitegloss may run on the tab in front, as far as the panel knows:
 * the browser tells the address only of a tab it may run on (a tab still
 * loading has none yet, and counts as yes). `ask`: not yet, the icon's click
 * or all sites lets it in. `never`: not even with all sites.
 */
export type TabAccess = "yes" | "ask" | "never";

export function tabAccess(
	tab: PanelState["tab"],
	allSites: boolean,
): TabAccess {
	if (tab === undefined || tab.url !== "" || tab.loading) return "yes";
	return allSites ? "never" : "ask";
}

/** What the panel shows about access, for one state. */
export interface AccessPlan {
	/**
	 * At the top of Home's "This page": `offer`, the first-use offer of all
	 * sites (with Not now); `no-access`, the sentence that this tab has no
	 * access yet, with both ways on; `cannot`, a tab no extension may run on.
	 */
	home: "offer" | "no-access" | "cannot" | undefined;
	/** The offer also says that this tab has no access yet, and the one-tab way. */
	offerForTab: boolean;
	/**
	 * In the open case's tool bar, in place of Add marks and Show/Hide marks:
	 * the sentence that this tab has no access yet, or that no extension may
	 * run on it.
	 */
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
	const offer = known && !allSites && !declined;
	return {
		home:
			tab === "never"
				? "cannot"
				: offer
					? "offer"
					: tab === "ask"
						? "no-access"
						: undefined,
		offerForTab: offer && tab === "ask",
		inCase:
			tab === "never" ? "cannot" : tab === "ask" ? "no-access" : undefined,
		pageControls: tab === "yes",
	};
}

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
 * piece) in both browsers until the person pins it; Firefox's sidebar has
 * an icon of Sitegloss too, which only opens the sidebar.
 */
export function oneTabWay(firefox: boolean): string {
	return `For this tab only: ${clickTheIcon(firefox)}`;
}

/** The click that lets Sitegloss onto the tab in front, as the browser shows it. */
function clickTheIcon(firefox: boolean): string {
	return firefox
		? "click Sitegloss under the puzzle piece in the toolbar (or its icon, if pinned) or press Alt+Shift+O. Firefox lets it in until the tab goes to another page."
		: "click the Sitegloss icon in the toolbar (under the puzzle piece until you pin it) or press Alt+Shift+O.";
}

/** What the browser's prompt calls the permission. */
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
	firefox: boolean,
): { head: string; text: string } {
	const browser = firefox ? "Firefox" : "Chrome";
	return forTab
		? {
				head: "Sitegloss has no access to this tab yet",
				text: `Allowed on all sites (recommended), it works on every tab without a click on its icon first, and an open case's marks show wherever you go. ${browser} asks you first.`,
			}
		: {
				head: "Let Sitegloss work on every tab (recommended)",
				text: `Allowed on all sites, Sitegloss works on every tab without a click on its icon first, and an open case's marks show wherever you go. ${browser} asks you first.`,
			};
}

/**
 * Under the option: what happens without it, and what allowing it means.
 * True to PRIVACY.md: no script goes into a page by itself; Sitegloss acts on
 * the tab in front (the open case's marks, marking, an AI app's tools), and
 * the permission sends nothing anywhere.
 */
export function optionNote(firefox: boolean): string {
	const browser = firefox ? "Firefox" : "Chrome";
	return `Without it, Sitegloss works on a tab only after you click its icon there${firefox ? ", until the tab goes to another page" : ""}; on other tabs your marks are not drawn and cannot be shown. ${browser} asks first (“${promptName(firefox)}”). Sitegloss uses it on the tab in front only and sends nothing anywhere by itself.`;
}

/** A hint after an action that needed the page found no access. */
export function noAccessHint(firefox: boolean): string {
	return `Sitegloss has no access to this tab yet. Allow it on all sites (under Options), or ${clickTheIcon(firefox)}`;
}

/** Where this browser keeps "Not now": its own storage, not a case, not synced. */
const DECLINED = "sitegloss.allSitesDeclined";

/** Whether the person said "Not now" to all sites, or took it back, in this browser. */
export function declinedBefore(storage: Pick<Storage, "getItem">): boolean {
	try {
		return storage.getItem(DECLINED) !== null;
	} catch {
		return false;
	}
}

/** "Not now", or all sites taken back: the offer does not come again. */
export function rememberDeclined(storage: Pick<Storage, "setItem">): void {
	try {
		storage.setItem(DECLINED, new Date().toISOString());
	} catch {
		// No storage (a private window that refuses it): offered again next time.
	}
}

/**
 * All sites went from allowed to not allowed (unticked here, or taken back
 * in the browser's settings): a decision, so no offer comes after it.
 */
export function tookBack(was: boolean | undefined, now: boolean): boolean {
	return was === true && !now;
}
