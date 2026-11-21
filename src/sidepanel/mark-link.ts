/**
 * A mark's link (DEC-050): the page where it was made, with its query, and,
 * when the tab in front is on another host, the same path and query there.
 * Pure: the view shows them, main.ts opens them in the tab in front.
 */

import {
	type Annotation,
	type Case,
	hashRoute,
	isWebPage,
	markAddress,
} from "../lib/case.ts";

export interface MarkTargets {
	/** Where the mark was made: its screenshot's address with its query. */
	made: string;
	/** The same path, query and hash route on the host of the tab in front. */
	here?: string;
	/** That host, to name it (`localhost:3000`). */
	host?: string;
}

/** Where a mark's link may go; none for a mark of no web page (an imported file's). */
export function markTargets(
	c: Case,
	a: Annotation,
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
		host: front.host,
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
