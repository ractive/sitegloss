/**
 * A page asks about a mark of the case drawn on it (DEC-027): which panel
 * answers, and for which mark. Pure, so the rule can be tested.
 */

import { type Case, type Mark, markFor } from "../lib/case.ts";
import type { MarkRequest } from "../lib/messages.ts";

export interface Showing {
	/** The case open in this panel, if its view is the case's. */
	open: Case | undefined;
	/** Where this panel drew a case's marks itself. */
	loaded: { caseId: string; tabId: number } | undefined;
	/**
	 * The tab in front of this panel's window and the case its page says it
	 * shows: a panel opened again finds the marks there without drawing them.
	 */
	front: { tabId: number; loadedCase: string | undefined } | undefined;
}

/**
 * The mark a page's request is about. `undefined`: not this panel's to answer
 * (the request is not from a tab, or the tab is neither the one this panel
 * drew its open case on nor the tab in front showing it): a page reaches no
 * other case, and none that is not open. The marks the panel redraws and
 * hides are the same two (`redrawLoaded`). `"gone"`: this panel's, but the
 * case has no such mark any more.
 */
export function markAsked(
	showing: Showing,
	request: Pick<MarkRequest, "caseId" | "markId" | "mark">,
	tabId: number | undefined,
): Mark | "gone" | "changed" | undefined {
	const { open, loaded, front } = showing;
	if (tabId === undefined || open === undefined || open.id !== request.caseId)
		return undefined;
	const drewIt = loaded?.caseId === open.id && loaded.tabId === tabId;
	const inFront = front?.tabId === tabId && front.loadedCase === open.id;
	if (!drewIt && !inFront) return undefined;
	// The page says which mark its popover was opened on (`markKey`): the id
	// alone is another mark's after the team's sync renumbered (DEC-039).
	if (request.mark === undefined)
		return open.marks.find((a) => a.id === request.markId) ?? "gone";
	const now = markFor(open, request.markId, request.mark);
	return now === "ambiguous" ? "changed" : (now ?? "gone");
}
