/**
 * A mark's link (DEC-050): the page where it was made, with its query, and,
 * when the tab in front is on another host, the same path and query there.
 * Pure: the view shows them, main.ts opens them in the tab in front.
 */

import {
	type Case,
	exactPage,
	hashRoute,
	isWebPage,
	type Mark,
	markAddress,
	onPageInFront,
} from "../lib/case.ts";
import type { MarkMatch } from "../lib/messages.ts";

export interface MarkTargets {
	/** Where the mark was made: its screenshot's address with its query. */
	made: string;
	/** The same path, query and hash route on the origin of the tab in front. */
	here?: string;
	/**
	 * That origin as the link names it, never to be taken for the mark's
	 * own: the host with its port (`localhost:3000`), and the scheme too
	 * where host and port are the mark's (`http://shop.example`).
	 */
	host?: string;
}

/**
 * Where a mark's link may go; none for a mark of no web page (an imported
 * file's). The second target is offered on any web page in front, also one
 * that is none of the case's: opening a case elsewhere is deliberate, and a
 * developer on `localhost:3000/` goes to the case's `/cart` there (DEC-050).
 */
export function markTargets(
	c: Case,
	a: Mark,
	tabUrl: string | undefined,
): MarkTargets | undefined {
	const made = markAddress(c, a);
	if (!isWebPage(made)) return undefined;
	if (tabUrl === undefined || !isWebPage(tabUrl)) return { made };
	const front = new URL(tabUrl);
	const at = new URL(made);
	if (front.origin === at.origin) return { made };
	return {
		made,
		here: `${front.origin}${at.pathname}${at.search}${at.hash}`,
		host:
			front.host === at.host ? `${front.protocol}//${front.host}` : front.host,
	};
}

/**
 * `shop.example/search?q=shoes`: an address as the panel shows a mark's, with
 * its query (unlike `shortUrl`, which names a page).
 */
export function shortAddress(address: string): string {
	try {
		const u = new URL(address);
		const route = hashRoute(u.hash);
		const bare = u.pathname === "/" && route === "" && u.search === "";
		return `${u.host}${bare ? "" : u.pathname}${u.search}${route}`;
	} catch {
		return address;
	}
}

/**
 * A mark's link was clicked: once the tab has loaded `url` and its marks are
 * drawn there, that mark is brought into view and outlined; held until
 * `until` (a page that never comes, a sign-in in between).
 */
export interface PendingShow {
	tabId: number;
	caseId: string;
	markId: string;
	/** `markKey`: the mark meant, whatever number it has by then. */
	mark: string;
	url: string;
	until: number;
	/** Set by a mark's Show while the marks were not drawn: it says how it went. */
	say?: (text: string) => void;
	/** Held for that one press: a failed draw, a closed case or a stopped load drops it. */
	fromShow?: true;
}

/**
 * A mark's Show may draw the case's marks and show the mark (the row offered
 * it) only if the case is still the one shown and the tab in front is a web
 * page that is the mark's. Checked again when the press is answered: the tab
 * may have gone elsewhere meanwhile.
 */
export function mayLoadAndShow(
	c: Case,
	a: Mark,
	tabUrl: string | undefined,
	shownCase: boolean,
): tabUrl is string {
	return (
		shownCase &&
		tabUrl !== undefined &&
		isWebPage(tabUrl) &&
		onPageInFront(c, a, tabUrl)
	);
}

/** What is pending once a draw is over: a press's own goes if nothing was drawn. */
export function pendingAfterDraw(
	mine: PendingShow,
	current: PendingShow | undefined,
	drawn: boolean,
): PendingShow | undefined {
	return !drawn && current === mine ? undefined : current;
}

/** What the panel's draw found on a tab, as `showPending` reads it. */
export interface DrawnOn {
	tabId: number;
	caseId: string;
	url: string;
	matches: ReadonlyMap<string, MarkMatch>;
	settling?: boolean;
}

/**
 * Try to show the mark a link waits for, after a draw (`loaded`): `keep`
 * while it may still come (not that tab or page yet, the mark not found
 * while the draw looks again, the page busy or not answering `case:show`);
 * given up once `until` has passed; done once the page showed it (`shown`,
 * the page's word for the mark now). `show` asks the page.
 */
export async function tryShow(
	p: PendingShow | undefined,
	loaded: DrawnOn | undefined,
	now: number,
	show: (p: PendingShow) => Promise<MarkMatch | { error: string } | null>,
): Promise<{ keep: boolean; shown?: MarkMatch }> {
	if (p === undefined || now > p.until) return { keep: false };
	if (
		loaded === undefined ||
		loaded.tabId !== p.tabId ||
		loaded.caseId !== p.caseId ||
		!exactPage(loaded.url, p.url)
	)
		return { keep: true };
	const m = loaded.matches.get(p.markId);
	if (m === undefined) return { keep: true };
	const found = m.status !== "lost" && m.status !== "no-element";
	if (!found && m.status !== "no-element" && loaded.settling)
		return { keep: true };
	const shown = await show(p).catch(() => null);
	// Busy with a mark, or no answer: the next draw tries again.
	if (shown === null || "error" in shown) return { keep: true };
	return { keep: false, shown };
}

/**
 * What a mark's link does on the tab (`tabUrl`, and the case its page
 * shows, `pageCase`): at another address it goes there (`navigate`); at that
 * very address it never loads the page again (its form fields and scroll
 * would go): it shows the mark where the page holds the case (`show`, also
 * when an AI app's load_case drew it), else draws the case there (`draw`).
 */
export function linkStep(
	tabUrl: string | undefined,
	url: string,
	caseId: string,
	pageCase: string | undefined,
): "navigate" | "show" | "draw" {
	if (tabUrl !== url) return "navigate";
	return pageCase === caseId ? "show" : "draw";
}
