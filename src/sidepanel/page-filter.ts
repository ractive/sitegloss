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
	type Mark,
	markUrl,
	onPageInFront,
	pageInFront,
	pageKey,
} from "../lib/case.ts";

/** "here": the page in front, whichever it is; else a page of the case, by `pageKey`. */
export type PageChoice = "here" | { page: string };

export interface ChosenPage {
	caseId: string;
	choice: PageChoice;
}

export interface PageFilter {
	/** What is chosen, while it holds; none: all pages. */
	choice?: PageChoice;
	/** The case's page meant; none for "here" on a page that is none of the case's. */
	page?: CasePage;
	/** Whether the mark shows. */
	shows: (a: Mark) => boolean;
}

const ALL: PageFilter = { shows: () => true };

/**
 * The filter for `c` with `chosen` and the tab in front at `tabUrl`. A
 * choice of another case, or of a page no longer in the case, is none.
 */
export function pageFilter(
	c: Case,
	chosen: ChosenPage | undefined,
	tabUrl: string | undefined,
): PageFilter {
	if (chosen === undefined || chosen.caseId !== c.id) return ALL;
	const { choice } = chosen;
	if (choice === "here") {
		const page = tabUrl === undefined ? undefined : pageInFront(c, tabUrl);
		return {
			choice,
			...(page !== undefined ? { page } : {}),
			// As the drawing decides it (DEC-050).
			shows: (a) =>
				page !== undefined &&
				tabUrl !== undefined &&
				onPageInFront(c, a, tabUrl),
		};
	}
	const page = casePages(c).find((p) => pageKey(p.url) === choice.page);
	if (page === undefined) return ALL;
	return {
		choice,
		page,
		shows: (a) => pageKey(markUrl(c, a)) === choice.page,
	};
}

/** Whether `chosen` names a page that has left the case: then it is let go. */
export function pageGone(c: Case, chosen: ChosenPage | undefined): boolean {
	if (chosen === undefined || chosen.caseId !== c.id) return false;
	const { choice } = chosen;
	return (
		choice !== "here" &&
		!casePages(c).some((p) => pageKey(p.url) === choice.page)
	);
}
