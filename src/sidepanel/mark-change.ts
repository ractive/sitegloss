/**
 * What a command in the page's popover does to the case (DEC-027): the same
 * change the panel's own buttons make, or why it is refused before anything
 * is stored. `main.ts` stores it (`changeMark`) and answers the page.
 */

import {
	type Case,
	MAX_COMMENT,
	withChoice,
	withComment,
	withoutMark,
	withReopen,
	withVerified,
} from "../lib/case.ts";
import type { MarkRequest } from "../lib/messages.ts";

/** A change of the case, for the mark whose id is `id` in it now. */
export type CaseChange = (
	current: Case,
	id: string,
) => { value: Case; images?: string[] };

/** The change a popover's command makes at `now`, or why it is refused. */
export function markChange(
	request: Exclude<MarkRequest, { type: "mark:picked" }>,
	now: string,
): { change: CaseChange } | { error: string } {
	switch (request.type) {
		case "mark:comment":
			if (request.text.length > MAX_COMMENT)
				return { error: "That comment is too long." };
			return {
				change: (current, id) => ({
					value: withComment(current, id, request.text, now),
				}),
			};
		case "mark:resolve":
			return {
				change: (current, id) => ({
					value: withChoice(current, id, request.kind, request.note, now),
				}),
			};
		case "mark:verify":
			return {
				change: (current, id) => ({
					value: withVerified(current, id, undefined, now),
				}),
			};
		case "mark:reopen":
			// The developer reads it first: a reopen says why, here as in the panel.
			if (request.note.trim() === "")
				return { error: "Say what is still wrong." };
			return {
				change: (current, id) => ({
					// Opened meanwhile: the form stays, and says why.
					value: withReopen(
						current,
						id,
						{ note: request.note, refuseOpen: true },
						now,
					),
				}),
			};
		case "mark:delete":
			return { change: (current, id) => withoutMark(current, id, now) };
	}
}
