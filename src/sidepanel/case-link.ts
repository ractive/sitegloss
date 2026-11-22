/**
 * What the case link's field holds (DEC-028): the link to store, none when
 * it is empty (that removes it), or why it is no link, said under the field.
 */

import { cleanLink, linkProblem, MAX_LINK } from "../lib/case.ts";

/** Under the link's field for a text that is no link. */
const NOT_A_LINK = "A link starts with https:// or http://";
const LINK_TOO_LONG = `A link has at most ${MAX_LINK} characters.`;

export function linkFromField(
	text: string,
): { link: string | undefined } | { error: string } {
	if (text.trim() === "") return { link: undefined };
	const link = cleanLink(text);
	if (link !== undefined) return { link };
	return { error: linkProblem(text) === "long" ? LINK_TOO_LONG : NOT_A_LINK };
}
