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

import { type Case, markStatus, onPageInFront } from "../lib/case.ts";
import {
	assignedTo,
	type CaseState,
	handOverKnown,
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
 * Whether the team's server assigns cases (DEC-071): it answered the
 * members' list (`GET …/members`; a server from before answers 404, stored
 * as none). Only then is anything about assignees or My cases shown: on a
 * server without them every case would read as unassigned.
 */
export function teamAssigns(cloud: Cloud): boolean {
	return (
		cloud.account !== undefined &&
		!cloud.account.expired &&
		teamOf(cloud) !== undefined &&
		cloud.members !== undefined
	);
}

/**
 * Whether a case is the person's, for the list's filter; `undefined`: no
 * filter here (nobody signed in, no team chosen, the sign-in ran out, or a
 * server that assigns no cases).
 */
export function mineTest(cloud: Cloud): ((c: Case) => boolean) | undefined {
	const me = cloud.account?.userId;
	if (me === undefined || !teamAssigns(cloud)) return undefined;
	return (c) => mineFor(c, me, caseSync(cloud, c.id).kind === "synced");
}

/** What a card says of the hand-over: the state's badge, and who has it where that helps. */
export interface CardHandOver {
	/**
	 * The badge, where it adds to the counts beside it: New, In progress.
	 * None where the counts say it (To verify, Settled, an empty case) or the
	 * card has its own (Closed).
	 */
	state: string | undefined;
	/** "Assigned to you", "Assigned to Dana", "Nobody assigned": with open marks in the team's case only. */
	assignee: string | undefined;
}

export function cardHandOver(c: Case, cloud: Cloud): CardHandOver {
	const state = stateOf(c);
	const me = cloud.account?.userId;
	const team = teamAssigns(cloud) && caseSync(cloud, c.id).kind === "synced";
	// Who has it, while its open marks wait for someone, and the server told.
	const told = handOverKnown(c);
	const open = state === "new" || state === "in progress";
	const who = assignedTo(c);
	return {
		state: open ? STATE_LABEL[state] : undefined,
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

/** What "My cases" says when the person's cases all stand under "This page". */
export const NO_OTHER_MINE = "No other case waits for you.";

/** What "My cases" says when it leaves nothing in the list. */
export const NONE_MINE =
	"Nothing waits for you: no open case is assigned to you, and none you started waits for you to hand it over, check it or close it.";

/**
 * What "This page" says of a case that waits for this person to verify it
 * (DEC-079); `undefined`: it does not, and the ordinary sentence stays. The
 * team's case: it is "to verify" and they started it (the reporter's turn is
 * theirs). A case of this browser only, or anyone's while signed out or with
 * a server that assigns nothing: fixed marks on the page in front. `here`
 * counts the marks to verify on the page at `url`, `elsewhere` the rest.
 */
export function waitsToVerify(
	c: Case,
	url: string,
	cloud: Cloud,
): { here: number; elsewhere: number } | undefined {
	const fixed = c.marks.filter((a) => markStatus(a) === "fixed");
	const here = fixed.filter((a) => onPageInFront(c, a, url)).length;
	const counts = { here, elsewhere: fixed.length - here };
	const me = cloud.account?.userId;
	if (teamAssigns(cloud) && caseSync(cloud, c.id).kind === "synced")
		return stateOf(c) === "to verify" &&
			me !== undefined &&
			c.createdBy?.id === me
			? counts
			: undefined;
	return c.closed === undefined && here > 0 ? counts : undefined;
}

/** "3 marks wait for you to verify on this page." */
export function waitsText(n: { here: number; elsewhere: number }): string {
	const marks = (k: number) => (k === 1 ? "1 mark waits" : `${k} marks wait`);
	return n.here > 0
		? `${marks(n.here)} for you to verify on this page.`
		: `${marks(n.elsewhere)} for you to verify, on other pages of this case.`;
}
