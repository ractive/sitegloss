/**
 * What the parts of the case module share among themselves and nothing
 * outside it uses: `case.ts` does not export it.
 */

import {
	cutText,
	type FindingApp,
	MAX_REOPEN_NOTE,
	type Resolution,
	type UserRef,
} from "./format.ts";

/**
 * The longest finding and the most a mark had (DEC-019), for reading the
 * findings of a stored case or a file: they become comments (DEC-081).
 */
export const MAX_FINDING = 5000;
export const MAX_FINDINGS = 20;

/**
 * A finding of an AI app on a mark, as a stored case or a file from before
 * DEC-081 holds it (DEC-019): it is read only to become a comment on the
 * mark (`findingsAsComments`).
 */
export interface OldFinding {
	id: string;
	text: string;
	app: FindingApp;
	at: string;
	/** When its app last changed its text. */
	editedAt?: string;
	/** Came in from a file: no app's own, whichever app it names. */
	imported?: true;
	/** Whose AI app wrote it, in a case synced with a team (DEC-039). */
	user?: UserRef;
}

/**
 * The resolution a reopen ended, its note cut to a reopen note's length:
 * twenty of them stay per mark, and a mark's history is bounded, or a case
 * outgrows what a file may hold.
 */
export function cutWas(was: Resolution): Resolution {
	return was.note && was.note.length > MAX_REOPEN_NOTE
		? { ...was, note: cutText(was.note, MAX_REOPEN_NOTE) }
		: was;
}
