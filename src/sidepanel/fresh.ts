/**
 * A case starts the moment "New case for this page" is clicked (DEC-026): stored
 * at once, with the page's title as its title and no marks. One that is left
 * as it was made goes again, silently, so trying the button leaves no empty
 * case behind. Pure: main.ts creates and deletes.
 */

import {
	CASE_FORMAT,
	type Case,
	cleanTitle,
	cutText,
	MAX_TITLE,
	type PageInfo,
	plainUrl,
	validateCase,
} from "../lib/case.ts";
import type { OverlayState } from "../lib/messages.ts";
import { shortUrl } from "./dom.ts";

/** A new case's title: the page's title, else its short address. */
export function firstTitle(page: Pick<PageInfo, "url" | "title">): string {
	const title = cutText(cleanTitle(page.title), MAX_TITLE);
	if (title !== "") return title;
	const address = cutText(shortUrl(page.url).trim(), MAX_TITLE);
	return address === "" ? "Untitled case" : address;
}

/** The case "New case for this page" stores: the page's, no marks, no screenshots. */
export function newCase(id: string, page: PageInfo, now: string): Case {
	const kept = { ...page, url: plainUrl(page.url) };
	return validateCase({
		format: CASE_FORMAT,
		id,
		title: firstTitle(kept),
		createdAt: now,
		updatedAt: now,
		page: kept,
		pages: [{ url: kept.url, title: kept.title, lang: kept.lang }],
		shots: [],
		marks: [],
		verdict: null,
	});
}

/**
 * The case is as "New case for this page" made it: no marks and no screenshots,
 * no mark ever stored (`lastNumber`: a delete in the panel and the toolbar's
 * Undo both set it), not from a file, no link (DEC-028), no summary stored
 * or typed (`typed`, the summary not saved yet), and the title it was
 * given, with no other typed in Rename and not saved yet (`typedTitle`). A
 * case that has once had a mark, a rename, a link or a summary is the
 * user's, and it stays.
 */
export function isUntouched(
	c: Case,
	typed?: string,
	typedTitle?: string,
	typedLink?: string,
): boolean {
	const title = cleanTitle(typedTitle ?? "");
	return (
		c.marks.length === 0 &&
		c.shots.length === 0 &&
		c.lastNumber === undefined &&
		c.importedAt === undefined &&
		c.link === undefined &&
		(c.verdict ?? "").trim() === "" &&
		(typed ?? "").trim() === "" &&
		// A link being typed in the form, not saved yet (DEC-028).
		(typedLink ?? "").trim() === "" &&
		(title === "" || title === c.title) &&
		c.title === firstTitle(c.page)
	);
}

/**
 * What a tab said when asked whether it holds anything of a case: its
 * overlay's state, `none` (no content script there: nothing of Sitegloss's),
 * or `unsure` (it did not answer in time: frozen, in a dialog, busy).
 */
export type TabAnswer = OverlayState | "none" | "unsure";

/**
 * Whether a page may still hold something of the case: a toolbar adding to
 * it (with a mark being typed, on its way, or failed), or a tab that did not
 * answer. An untouched case is deleted only when no tab may (DEC-026: never
 * delete on doubt; an empty case left in the list is the cheap mistake).
 */
export function mayHold(
	answers: readonly TabAnswer[],
	caseId: string,
): boolean {
	return answers.some(
		(a) => a === "unsure" || (a !== "none" && a.target?.caseId === caseId),
	);
}
