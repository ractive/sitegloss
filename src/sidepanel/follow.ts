/**
 * The open case's marks follow it to the tab in front (DEC-022): what the
 * panel does when a case opens, another tab comes to the front, or the tab in
 * front loads; and whether what the draw found says the case is for another
 * page. Pure: main.ts carries the steps out.
 */

import {
	type Case,
	markUrl,
	pageInFront,
	samePage,
	samePath,
} from "../lib/case.ts";
import type { AnnotationMatch } from "../lib/messages.ts";
import { shortUrl } from "./dom.ts";
import type { Loaded } from "./state.ts";

/** Where the panel's own marks of a case are drawn. */
export interface Drawn {
	tabId: number;
	caseId: string;
}

export interface FollowInput {
	/** The case open in the panel, once read. */
	caseId: string | undefined;
	/**
	 * The tab in front; `url` is empty where Chrome hides it (Sitegloss may not
	 * run there yet), `loading` while it loads.
	 */
	tab: { id: number; url: string; loading: boolean } | undefined;
	/** Where the panel drew marks last, and they may still be. */
	drawn: Drawn | undefined;
	/** The case whose marks the page in front shows (the page says so). */
	pageCase: string | undefined;
	/** Tabs the user took the open case's marks off ("Hide marks on this tab"). */
	hidden: ReadonlySet<number>;
}

export interface FollowStep {
	/** Take these marks off first: they are on a tab no longer in front. */
	clear: Drawn | undefined;
	/**
	 * `draw`: find the case's marks on the tab in front and draw them;
	 * `wait`: Sitegloss may not run there, the icon's click or "Allow on all
	 * sites" lets it (the panel says so); `none`: leave the tab as it is.
	 */
	action: "draw" | "wait" | "none";
}

/** Pages a content script can run on, given access. */
export function canDrawOn(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return (
			protocol === "https:" || protocol === "http:" || protocol === "file:"
		);
	} catch {
		return false;
	}
}

/** What to do for the open case and the tab in front. */
export function followStep(input: FollowInput): FollowStep {
	const { caseId, tab, drawn } = input;
	const action = nextAction(input);
	// A draw on the same tab replaces what is there; marks anywhere else go.
	const clear =
		drawn !== undefined &&
		(drawn.tabId !== tab?.id || (drawn.caseId !== caseId && action !== "draw"))
			? drawn
			: undefined;
	return { clear, action };
}

function nextAction({
	caseId,
	tab,
	drawn,
	pageCase,
	hidden,
}: FollowInput): FollowStep["action"] {
	// No case open: the panel draws nothing.
	if (caseId === undefined || tab === undefined) return "none";
	if (hidden.has(tab.id)) return "none";
	// A tab that is still loading is drawn on once it has.
	if (tab.loading) return "none";
	if (tab.url === "") return "wait";
	if (!canDrawOn(tab.url)) return "none";
	// The page shows the case: the panel's draw, or an AI app's load_case. A
	// draw again would drop the candidates chosen; a change of the address
	// within the page (a hash, pushState) keeps the marks.
	if (pageCase === caseId) return "none";
	// The panel drew it there, and the page shows another case since: an AI
	// app put it there, leave it. A page with none has loaded again.
	if (
		drawn?.tabId === tab.id &&
		drawn.caseId === caseId &&
		pageCase !== undefined
	)
		return "none";
	return "draw";
}

/**
 * Whether news from the overlay of tab `from` should make the open case
 * follow: Sitegloss runs there now, so the icon was clicked on it. The tab
 * the open case waits for (`pending`), or the tab in front whose address
 * Chrome hid from Sitegloss until now (`front`): the news can come before
 * `follow` has found out that it waits, for it reads the tab twice first.
 */
export function newsLetsIn(
	from: number | undefined,
	pending: number | undefined,
	front: { id: number; url: string } | undefined,
): boolean {
	if (from === undefined) return false;
	return from === pending || (from === front?.id && front.url === "");
}

/** A match that has its element on the page, sure or not. */
export const isFound = (m: AnnotationMatch): boolean =>
	m.status !== "lost" && m.status !== "no-element";

/**
 * A match drawn dashed on the page (review.ts): its element is only probable
 * or one of several, or the mark recorded none and sits where it was.
 */
export const isUnsure = (m: AnnotationMatch): boolean =>
	m.status === "no-element" ||
	// Found on a page that is not the mark's own: maybe only a look-alike.
	m.otherPage === true ||
	(m.status !== "lost" &&
		!(m.status !== "ambiguous" && m.candidates[m.current]?.found === true));

/**
 * Whether the draw of `c`'s marks on the page at `url` drew a dashed one, as
 * review.ts and the overlay do it: an unsure mark has a dashed stroke, but a
 * note is its pin alone, and a mark without an element is drawn only on the
 * route its screenshot was taken on.
 */
export function dashDrawn(
	c: Case,
	matches: readonly AnnotationMatch[],
	url: string,
): boolean {
	return matches.some((m) => {
		if (!isUnsure(m)) return false;
		const a = c.annotations.find((x) => x.id === m.annotationId);
		if (a === undefined || a.shape.kind === "note") return false;
		if (m.status !== "no-element") return true;
		return samePath(markUrl(c, a), url);
	});
}

/**
 * What a draw on the page at `url` says, mark by mark (DEC-038 and its
 * review): `own`, the marks of that page, which are what the page is judged
 * by; `also`, marks of other pages whose element was found here all the same
 * (a header every page has, or a look-alike: never sure, never counted as
 * found); `elsewhere`, marks of other pages that are not here, which nobody
 * expected. On a page that is none of the case's, every mark is looked for
 * and counted, as in a case of one page. A page is the case's by its path,
 * whatever the host (`pageInFront`, DEC-050).
 */
export function findsOn(
	c: Case,
	matches: readonly AnnotationMatch[],
	url: string,
): { own: AnnotationMatch[]; also: number; elsewhere: number } {
	if (pageInFront(c, url) === undefined)
		return { own: [...matches], also: 0, elsewhere: 0 };
	const pageOf = new Map(c.annotations.map((a) => [a.id, a]));
	const own: AnnotationMatch[] = [];
	let also = 0;
	let elsewhere = 0;
	for (const m of matches) {
		const a = pageOf.get(m.annotationId);
		if (a === undefined || samePath(markUrl(c, a), url)) own.push(m);
		else if (isFound(m)) also++;
		else elsewhere++;
	}
	return { own, also, elsewhere };
}

/** The matches of the marks whose page is the page at `url` (`findsOn`). */
export function matchesHere(
	c: Case,
	matches: readonly AnnotationMatch[],
	url: string,
): AnnotationMatch[] {
	return findsOn(c, matches, url).own;
}

/**
 * The search found none of the marks the page at `url` should have: of its
 * own marks, or, on a page that is none of the case's, of all of them. A
 * mark of another page found here does not make up for them.
 */
export function noneHere(
	c: Case,
	matches: readonly AnnotationMatch[],
	url: string,
): boolean {
	return noneFound(findsOn(c, matches, url).own);
}

/**
 * The tab went on to another page while the case stayed drawn on it (a
 * single-page app's next route): what the panel knows of the draw is about
 * the page before, or was dropped (Chrome says "loading" for a pushState
 * too, and what was found is forgotten then), and has to be read again.
 */
export function movedOn(
	loaded: Pick<Loaded, "caseId" | "tabId" | "url"> | undefined,
	caseId: string,
	tab: { id: number; url: string } | undefined,
	pageCase: string | undefined,
): boolean {
	if (tab === undefined || tab.url === "" || pageCase !== caseId) return false;
	if (loaded === undefined) return true;
	return (
		loaded.caseId === caseId &&
		loaded.tabId === tab.id &&
		!samePage(loaded.url, tab.url)
	);
}

/**
 * What a draw found, in the case's This-tab block; `page` is the page's short
 * address, `matches` the page's own marks (`findsOn`), `also` and `elsewhere`
 * the other pages' marks that are and are not here. The page shows the rest:
 * a mark's colour is its status, and only the dash needs a word, where one
 * was drawn (`dashed`, see `dashDrawn`).
 */
export function foundText(
	matches: readonly AnnotationMatch[],
	page: string,
	dashed: boolean,
	elsewhere = 0,
	also = 0,
): string {
	const maybe =
		also === 0
			? ""
			: ` ${also} of the case's other pages may be here too (dashed).`;
	const found = matches.filter(isFound).length;
	const said = `${found} of ${matches.length} marks found on ${page}.`;
	// The marks of the case's other pages, not expected here (DEC-038).
	const rest =
		elsewhere === 0
			? ""
			: ` ${elsewhere} more ${elsewhere === 1 ? "is" : "are"} on other pages of the case.`;
	return `${said}${dashed ? " Dashed: unsure." : ""}${maybe}${rest}`;
}

/**
 * The line under the case's buttons for what the panel's draw of `c` found
 * (`foundText`), from its matches as they are now: a mark saved to the case
 * since counts, as the next draw would count it. None where none was found
 * and the search is over (the case view says so), and none for a case
 * without marks yet (just created, DEC-026).
 */
export function foundLine(
	c: Case,
	loaded: Pick<Loaded, "matches" | "url" | "settling">,
): string | undefined {
	const all = [...loaded.matches.values()];
	const { own, also, elsewhere } = findsOn(c, all, loaded.url);
	if (all.length === 0 || (noneHere(c, all, loaded.url) && !loaded.settling))
		return undefined;
	return foundText(
		own,
		shortUrl(loaded.url),
		dashDrawn(c, own, loaded.url),
		elsewhere,
		also,
	);
}

/**
 * None of the case's marks was found on the page: at least one mark recorded
 * an element, and none of those is there. Resolved marks count as any other.
 * A case of marks without elements (boxes, arrows on nothing) says nothing
 * about the page.
 */
export function noneFound(matches: readonly AnnotationMatch[]): boolean {
	const withElement = matches.filter((m) => m.status !== "no-element");
	return withElement.length > 0 && !withElement.some(isFound);
}
