/**
 * The open case's mark list by page: all pages, the page the tab in front
 * shows ("This page", which follows the tab), or one page of the case. The
 * panel's state for the open case only: not stored in the case, not synced.
 * It changes the list, never what is drawn on the page.
 */

import {
	type Case,
	type CasePage,
	casePages,
	GROUP_OF,
	type Mark,
	markStatus,
	pageInFront,
	pageKey,
	type StatusGroup,
} from "../lib/case.ts";

/** "here": the page in front, whichever it is; else a page of the case, by `pageKey`. */
export type PageChoice = "here" | { page: string };

export interface ChosenPage {
	caseId: string;
	choice: PageChoice;
	/**
	 * The highest mark number when it was chosen: a mark added since, by
	 * whatever way (the toolbar, an AI app, the team's sync), shows; so the
	 * filter ends then, as the status filter does.
	 */
	upTo: number;
}

export interface PageFilter {
	/** What is chosen, while it holds; none: all pages. */
	choice?: PageChoice;
	/** The case's page meant; none for "here" on a page that is none of the case's. */
	page?: CasePage;
	/** "here", and the panel cannot read the tab's address: which page it shows is not known. */
	unread?: true;
	/** Whether the mark shows. */
	shows: (a: Mark) => boolean;
}

const ALL: PageFilter = { shows: () => true };

/**
 * Each mark's page key, as `marksByPage` counts it: by its screenshot, a
 * map built once, not a search of the pages per mark.
 */
export function pageOfMark(c: Case): (a: Mark) => string {
	const first = pageKey(c.page.url);
	const ofShot = new Map(
		c.shots.map((s) => [s.id, s.url === undefined ? first : pageKey(s.url)]),
	);
	return (a) => ofShot.get(a.shot) ?? first;
}

/** The highest mark number of the case: 0 without marks. */
export const highestMark = (c: Case): number =>
	c.marks.reduce((n, a) => Math.max(n, a.number), 0);

/**
 * Whether `chosen` no longer holds for `c`: another case's, its page left
 * the case, the case has one page left (no control would show it), or a
 * mark was added since. Then it is let go.
 */
export function pageFilterEnds(
	c: Case,
	chosen: ChosenPage | undefined,
): boolean {
	if (chosen === undefined) return false;
	if (chosen.caseId !== c.id) return true;
	const pages = casePages(c);
	if (pages.length < 2 || highestMark(c) > chosen.upTo) return true;
	const { choice } = chosen;
	return (
		choice !== "here" && !pages.some((p) => pageKey(p.url) === choice.page)
	);
}

/**
 * The filter for `c` with `chosen` and the tab in front at `tabUrl` ("" when
 * the panel may not read it). One that ended (`pageFilterEnds`) is none.
 */
export function pageFilter(
	c: Case,
	chosen: ChosenPage | undefined,
	tabUrl: string | undefined,
): PageFilter {
	if (chosen === undefined || pageFilterEnds(c, chosen)) return ALL;
	const { choice } = chosen;
	const of = pageOfMark(c);
	if (choice === "here") {
		if (tabUrl === undefined || tabUrl === "")
			return { choice, unread: true, shows: () => false };
		// The page found once; a mark is its page's by the same key (DEC-050).
		const page = pageInFront(c, tabUrl);
		const key = page === undefined ? undefined : pageKey(page.url);
		return {
			choice,
			...(page !== undefined ? { page } : {}),
			shows: (a) => key !== undefined && of(a) === key,
		};
	}
	const page = casePages(c).find((p) => pageKey(p.url) === choice.page);
	if (page === undefined) return ALL;
	return { choice, page, shows: (a) => of(a) === choice.page };
}

/**
 * Whether the status filter `group` still has marks under the page filter:
 * a page set with none of them ends it (it would come back by itself when
 * the page changes again).
 */
export function statusLeft(
	c: Case,
	chosen: ChosenPage | undefined,
	tabUrl: string | undefined,
	group: StatusGroup,
): boolean {
	const { shows } = pageFilter(c, chosen, tabUrl);
	return c.marks.some((a) => shows(a) && GROUP_OF[markStatus(a)] === group);
}
