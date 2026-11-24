import { type Case, isOfferedOn } from "../lib/case";

/**
 * What "This page" shows of the cases the page in front has (DEC-050): only
 * the open ones are promoted (the sentence, their cards, the primary
 * "Open this case"); the closed ones are filed in a folded "Closed" section
 * under it, as the list below files its own.
 */
export function pageCases(
	cases: Case[],
	url: string | undefined,
): { open: Case[]; closed: Case[] } {
	const offered = url ? cases.filter((c) => isOfferedOn(c, url)) : [];
	return {
		open: offered.filter((c) => c.closed === undefined),
		closed: offered.filter((c) => c.closed !== undefined),
	};
}

/**
 * What the list says once, when the person's own press on "Close case" has
 * brought them back to it. Both places a closed case can stand are headed
 * "Closed".
 */
export function closedSaid(c: Case): string {
	return `\u201c${c.title}\u201d is closed. It is under Closed.`;
}
