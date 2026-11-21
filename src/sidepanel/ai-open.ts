/**
 * Whether the panel may open a case for an AI app's `open_case` (DEC-050):
 * never at the cost of anything a person typed or a decision they have to
 * make. Pure: main.ts asks the tabs and carries the switch out.
 */

import type { TabAnswer } from "./fresh.ts";
import type { PanelState } from "./state.ts";

/** Why the panel stays where it is; none: it may open the case. */
export type AiOpenRefusal =
	/** The toolbar on the AI app's tab adds marks to another case. */
	| { reason: "adding"; caseId: string }
	/** The open case is in the middle of something a person does. */
	| { reason: "busy"; caseId: string; why: string };

/**
 * What stands in the way of opening `caseId` for the AI app on tab `tabId`,
 * with what every tab says of its toolbar (`answers`, by tab id). On Home,
 * or with that case open already, only a toolbar on the AI app's tab adding
 * to another case does. With another case open, leaving it has to lose
 * nothing and need no decision: no mark's form open, no rename or link
 * being typed, no "← All cases" under way, no toolbar of it on any tab.
 */
export function aiOpenRefusal(
	state: Pick<
		PanelState,
		"view" | "markEdit" | "renaming" | "linking" | "leaving"
	>,
	caseId: string,
	tabId: number,
	answers: ReadonlyMap<number, TabAnswer>,
): AiOpenRefusal | undefined {
	const toolbar = (answer: TabAnswer | undefined) =>
		answer !== undefined &&
		answer !== "none" &&
		answer !== "unsure" &&
		answer.visible
			? answer.target?.caseId
			: undefined;
	const open = state.view.kind === "case" ? state.view.id : undefined;
	if (open !== undefined && open !== caseId) {
		const busy = (why: string): AiOpenRefusal => ({
			reason: "busy",
			caseId: open,
			why,
		});
		if (state.leaving !== undefined)
			return busy(
				state.leaving.phase === "blocked"
					? "it is being closed, and a mark of its toolbar is not in it yet"
					: "it is being closed",
			);
		if (state.markEdit !== undefined)
			return busy("a mark's form is open there, with what is typed in it");
		if (state.renaming?.caseId === open)
			return busy("its title is being changed");
		if (state.linking?.caseId === open)
			return busy("its link is being changed");
		for (const answer of answers.values())
			if (toolbar(answer) === open)
				return busy("its toolbar is up on a tab, adding marks to it");
	}
	const here = toolbar(answers.get(tabId));
	if (here !== undefined && here !== caseId)
		return { reason: "adding", caseId: here };
	return undefined;
}

/**
 * Whether what the panel knows of a draw (`loaded`) still says what the
 * page shows once `open_case` opens `caseId` on tab `tabId`: only a draw of
 * that case on that tab. Of another case, or of the same case on another
 * tab, it is dropped, or the panel would show that tab's statuses and "This
 * tab" line for the one the AI app opened it on.
 */
export function keepsLoaded(
	loaded: { caseId: string; tabId: number } | undefined,
	caseId: string,
	tabId: number,
): boolean {
	return (
		loaded !== undefined && loaded.caseId === caseId && loaded.tabId === tabId
	);
}
