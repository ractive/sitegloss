/**
 * Where a case stands, and whose turn it is (DEC-071): worked out, never
 * stored, from the case's marks counted by status group and whether it is
 * closed. The server's rule (`caseState`, `caseTurn` and `isMine` in
 * sitegloss.dev's `packages/api/src/v1/case-state.ts`), kept here as its own
 * code; `test/case-state.json` is a byte copy of the server's vectors, copied
 * again when they change (as `pageKey`'s are).
 *
 * | State         | When                                                                 |
 * |---------------|----------------------------------------------------------------------|
 * | `empty`       | no marks, not closed                                                 |
 * | `new`         | marks, at least one open, none fixed, verified or dismissed yet       |
 * | `in progress` | at least one open mark, and at least one fixed, verified or dismissed |
 * | `to verify`   | no open mark, at least one fixed and waiting to be verified           |
 * | `settled`     | every mark verified or dismissed, not closed                         |
 * | `closed`      | the case is closed                                                   |
 */

import {
	assigneeOf,
	type Case,
	type CaseCounts,
	caseCounts,
	type UserRef,
} from "./case.ts";

export const CASE_STATES = [
	"empty",
	"new",
	"in progress",
	"to verify",
	"settled",
	"closed",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

/** Whose move it is: the assignee's, the reporter's (who started the case), or nobody's. */
export const TURNS = ["assignee", "reporter", "nobody"] as const;
export type Turn = (typeof TURNS)[number];

/** The case's state from its marks' counts and whether it is closed. */
export function caseState(counts: CaseCounts, closed: boolean): CaseState {
	if (closed) return "closed";
	const settled = counts.toVerify + counts.verified + counts.dismissed;
	if (counts.open + settled === 0) return "empty";
	if (counts.open > 0) return settled === 0 ? "new" : "in progress";
	return counts.toVerify > 0 ? "to verify" : "settled";
}

/**
 * Whose turn it is in `state`: `new` and `in progress` the assignee's,
 * nobody's while there is none (the case is unassigned); `empty`,
 * `to verify` and `settled` the reporter's; `closed` nobody's.
 */
export function caseTurn(state: CaseState, assigned: boolean): Turn {
	switch (state) {
		case "new":
		case "in progress":
			return assigned ? "assignee" : "nobody";
		case "closed":
			return "nobody";
		default:
			return "reporter";
	}
}

/**
 * Whether a case is among a person's cases: an open case where it is their
 * turn. Assigned to them and `new` or `in progress`; started by them and
 * `empty`, `to verify` or `settled`; or started by them, with open marks and
 * nobody assigned: it waits for them to hand it over.
 */
export function isMine(
	state: CaseState,
	who: { assignee: boolean; reporter: boolean; assigned: boolean },
): boolean {
	switch (state) {
		case "new":
		case "in progress":
			return who.assigned ? who.assignee : who.reporter;
		case "closed":
			return false;
		default:
			return who.reporter;
	}
}

/** Where case `c` stands, from its marks here. */
export const stateOf = (c: Case): CaseState =>
	caseState(caseCounts(c), c.closed !== undefined);

/** Who it is assigned to as shown here (`assigneeOf`), `null` for nobody or not known. */
export const assignedTo = (c: Case): UserRef | null => assigneeOf(c) ?? null;

/** Whose turn it is on case `c`, as this browser knows it. */
export const turnOf = (c: Case): Turn =>
	caseTurn(stateOf(c), assignedTo(c) !== null);

/**
 * Whether case `c` is one of the cases of the person signed in as `me`
 * ("My cases"). `team`: the case is the team's; a case only in this browser
 * is theirs by definition (nobody else has it) while it is open. The
 * reporter of a team's case not known yet (it is on its way to the server,
 * which records who started it) is taken to be `me`: it was made here.
 */
export function mineFor(c: Case, me: string, team: boolean): boolean {
	const state = stateOf(c);
	if (!team) return state !== "closed";
	const assignee = assignedTo(c);
	return isMine(state, {
		assigned: assignee !== null,
		assignee: assignee?.id === me,
		reporter: c.createdBy === undefined || c.createdBy.id === me,
	});
}
