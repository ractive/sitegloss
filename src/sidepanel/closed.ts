import type { Case } from "../lib/case";
import { isOfferedOn } from "../lib/case";

/**
 * What the list says once, when the person's own press on "Close case" has
 * brought them back to it. A closed case stands under Closed, except one of
 * the page in front, which stays under "This page" (DEC-050).
 */
export function closedSaid(c: Case, url: string | undefined): string {
	const where = url && isOfferedOn(c, url) ? "This page" : "Closed";
	return `\u201c${c.title}\u201d is closed. It is under ${where}.`;
}
