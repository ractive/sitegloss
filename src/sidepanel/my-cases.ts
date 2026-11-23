/**
 * "My cases" in the list of cases, and what a card says of the hand-over
 * (DEC-071). Pure: the list draws it (view.ts).
 *
 * Mine, for whoever is signed in with a team chosen: the team's open cases
 * where it is their turn (`mineFor`: assigned to them with open marks, or
 * started by them and empty, to verify, settled or waiting to be handed
 * over), and every open case kept only in this browser, which nobody else
 * has. Not signed in, or no team: no filter, and nothing about assignees.
 */

import type { Case } from "../lib/case.ts";
import {
	assignedTo,
	type CaseState,
	mineFor,
	stateOf,
} from "../lib/case-state.ts";
import { caseSync, teamOf } from "./cloud-view.ts";
import type { PanelState } from "./state.ts";

type Cloud = PanelState["cloud"];

/** The state as a card's badge says it. */
export const STATE_LABEL: Record<CaseState, string> = {
	empty: "Empty",
	new: "New",
	"in progress": "In progress",
	"to verify": "To verify",
	settled: "Settled",
	closed: "Closed",
};

/**
 * Whether a case is the person's, for the list's filter; `undefined`: no
 * filter here (nobody signed in, no team chosen, the sign-in ran out).
 */
export function mineTest(cloud: Cloud): ((c: Case) => boolean) | undefined {
	const me = cloud.account?.userId;
	if (me === undefined || cloud.account?.expired || teamOf(cloud) === undefined)
		return undefined;
	return (c) => mineFor(c, me, caseSync(cloud, c.id).kind === "synced");
}

/** What a card says of the hand-over: the state's badge, and who has it where that helps. */
export interface CardHandOver {
	/** The badge; none for a closed case, which has its own. */
	state: string | undefined;
	/** "Assigned to you", "Assigned to Dana", "Nobody assigned": with open marks in the team's case only. */
	assignee: string | undefined;
}

export function cardHandOver(c: Case, cloud: Cloud): CardHandOver {
	const state = stateOf(c);
	const me = cloud.account?.userId;
	const team =
		me !== undefined &&
		teamOf(cloud) !== undefined &&
		!cloud.account?.expired &&
		caseSync(cloud, c.id).kind === "synced";
	// Who has it, while its open marks wait for someone, and the server told.
	const told = c.assign !== undefined || c.assignee !== undefined;
	const open = state === "new" || state === "in progress";
	const who = assignedTo(c);
	return {
		state:
			state === "closed" || state === "empty" ? undefined : STATE_LABEL[state],
		assignee:
			!team || !told || !open
				? undefined
				: who === null
					? "Nobody assigned"
					: who.id === me
						? "Assigned to you"
						: `Assigned to ${who.name}`,
	};
}

/** What "My cases" says when it leaves nothing in the list. */
export const NONE_MINE =
	"Nothing waits for you: no open case is assigned to you, and none you started waits for you to hand it over, check it or close it.";
