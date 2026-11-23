/**
 * What comes next on the open case (DEC-069): one sentence on where the case
 * stands and the actions that move it on. Pure, so the rule can be tested
 * over every state; `next-step-view.ts` draws it.
 *
 * It knows what this browser knows: the marks' states, whether the case is
 * the team's or this browser's, the sync's state, and which cases the server
 * has as the sync itself last knew it (`atTeam`, from its books: a synced
 * case with the server's copy, and the team it is in). Only such a case gets
 * its link: an address that does not open yet is worse than none. Nothing
 * of the case itself counts as proof (a file's marks name their makers too).
 * The counts stand right above it, so the sentence does not repeat them.
 *
 * In the team's case it also says who has it and whose turn it is
 * (DEC-071): the open marks are the assignee's to fix, the fixed ones the
 * reporter's (who started the case) to verify, a settled case the
 * reporter's to close; in the service's words (sitegloss.dev's
 * `apps/app/src/lib/next-step.ts`), kept in step by hand.
 */

import { caseInstructions } from "../lib/agent-instructions.ts";
import {
	assigneeOf,
	type Case,
	caseCounts,
	type Mark,
	markStatus,
	type UserRef,
} from "../lib/case.ts";
import { caseSync, teamOf } from "./cloud-view.ts";
import type { PanelState } from "./state.ts";

type Cloud = PanelState["cloud"];

/** What the block offers. Each but the copies and Start verifying is the same action as elsewhere in the panel. */
export type StepAction =
	| "add-marks"
	| "share"
	| "export"
	| "copy-link"
	| "copy-ai"
	| "verify"
	| "close"
	/** The Assign menu: the team's members, and Nobody (DEC-071). */
	| "assign";

export interface NextStep {
	text: string;
	actions: StepAction[];
}

/** Where the case is, as far as this browser knows. */
export type Where =
	/** Only in this browser; and how it could be shared. */
	| {
			kind: "browser";
			share: "sign-in" | "choose-team" | "may" | "may-not";
			team?: string;
	  }
	/** The sign-in ran out: nothing goes to the team until it is renewed. */
	| { kind: "signed-out" }
	/** The team's, and the sync does not know the server to have it (yet). */
	| { kind: "sending"; why: "syncing" | "offline" | "problem" | "next" }
	/**
	 * The server has it in the team chosen: `link` is its page in the web
	 * app, `mcp` the MCP server. `offline`: the server cannot be reached now
	 * (what changes here waits).
	 */
	| {
			kind: "team";
			team: string;
			link: string | undefined;
			mcp: string;
			offline?: true;
	  };

/** The case's page in the web app, as the web app makes it for a member. */
export function caseAddress(
	server: string,
	slug: string,
	caseId: string,
): string {
	return new URL(
		`/t/${encodeURIComponent(slug)}/cases/${encodeURIComponent(caseId)}`,
		server,
	).href;
}

/** The service's MCP server, as the web app names it (`mcpResource`). */
export const mcpAddress = (server: string): string =>
	new URL("/api/mcp", server).href;

export function whereIs(cloud: Cloud, c: Case): Where {
	const account = cloud.account;
	if (account?.expired) return { kind: "signed-out" };
	const sync = caseSync(cloud, c.id);
	if (sync.kind === "off")
		return {
			kind: "browser",
			share: account === undefined ? "sign-in" : "choose-team",
		};
	if (sync.kind === "local")
		return {
			kind: "browser",
			share: sync.mayShare ? "may" : "may-not",
			...(sync.team === undefined ? {} : { team: sync.team }),
		};
	const team = teamOf(cloud);
	// The sync's own word that the server has this case, in this very team:
	// after a switch of team, a case of the one before is not offered.
	if (
		team !== undefined &&
		account !== undefined &&
		cloud.atTeam[c.id] === team.id
	) {
		const server = account.server;
		return {
			kind: "team",
			team: team.name,
			link:
				team.slug === undefined
					? undefined
					: caseAddress(server, team.slug, c.id),
			mcp: mcpAddress(server),
			...(cloud.status?.state === "offline" ? { offline: true as const } : {}),
		};
	}
	const status = cloud.status;
	return {
		kind: "sending",
		why:
			status?.state === "syncing"
				? "syncing"
				: status?.state === "offline"
					? "offline"
					: status?.state === "problem" ||
							status?.problems.some((p) => p.caseId === c.id)
						? "problem"
						: "next",
	};
}

const LIST = "Team in the list of cases";

const SENDING: Record<Extract<Where, { kind: "sending" }>["why"], string> = {
	syncing: "It is being sent to the team; its link works once it is there.",
	offline:
		"It is not with the team yet: the server cannot be reached, and Sitegloss tries again by itself.",
	problem: `The team does not have it yet: ${LIST} says why.`,
	next: "It goes to the team with the next sync; its link works once it is there.",
};

/** For the open marks: what it says, and what it offers, by where the case is. */
function forOpen(where: Where): NextStep {
	const only = "It is only in this browser.";
	switch (where.kind) {
		case "team":
			return where.link === undefined
				? {
						text: "Send the case to whoever fixes the open marks: it is in the team's cases in the web app.",
						actions: [],
					}
				: {
						text: "Send the case to whoever fixes the open marks.",
						actions: ["copy-link", "copy-ai"],
					};
		case "sending":
			return { text: SENDING[where.why], actions: [] };
		case "signed-out":
			return {
				text: `Your sign-in ran out, so changes stay in this browser: sign in again under ${LIST}.`,
				actions: [],
			};
	}
	switch (where.share) {
		case "may":
			return {
				text: `${only} Share it so whoever fixes it can open it.`,
				actions: ["share"],
			};
		case "may-not":
			return {
				text: `${only} Your role in “${where.team ?? "the team"}” does not let you share it: export it to send it as a file.`,
				actions: ["export"],
			};
		case "choose-team":
			return {
				text: `${only} Export it to send it as a file, or choose a team under ${LIST} to share it.`,
				actions: ["export"],
			};
		default:
			return {
				text: `${only} Export it to send it as a file, or sign in under ${LIST} to share it with a team.`,
				actions: ["export"],
			};
	}
}

/**
 * For the open marks of the team's case whose assignee the server told
 * (DEC-071): who has them and what is the viewer's to do. `me`: the viewer.
 */
function forAssignee(
	where: Extract<Where, { kind: "team" }>,
	assignee: UserRef | null,
	me: string,
	mayAssign: boolean,
): NextStep {
	const copies: StepAction[] =
		where.link === undefined ? [] : ["copy-link", "copy-ai"];
	const menu: StepAction[] = mayAssign ? ["assign"] : [];
	if (assignee === null)
		return mayAssign
			? {
					text: "Nobody is on it yet: assign it to whoever fixes the open marks.",
					actions: [...menu, ...copies],
				}
			: {
					text: "Nobody is on it yet: send the case to whoever fixes the open marks.",
					actions: copies,
				};
	if (assignee.id === me)
		return {
			text: "Assigned to you: fix the open marks, and set each one fixed.",
			actions: [
				...(where.link === undefined ? [] : ["copy-ai" as const]),
				...menu,
			],
		};
	return {
		text: `Assigned to ${assignee.name}: the open marks are theirs to fix.`,
		actions: [
			...(where.link === undefined ? [] : ["copy-link" as const]),
			...menu,
		],
	};
}

/** Said where the reporter's turn is nobody's: they left the team (DEC-071, the service's words). */
const GONE = "and whoever started the case is no longer in the team";

/** Whether whoever started `c` left the team, as far as its members are known. */
export const reporterGoneFrom = (
	c: Case,
	members: readonly { id: string }[] | undefined,
): boolean =>
	members !== undefined &&
	members.length > 0 &&
	c.createdBy !== undefined &&
	!members.some((m) => m.id === c.createdBy?.id);

/** What the block says of an assignment made here that the server does not have yet (DEC-071). */
export const assignWaits = (where: Where): string =>
	where.kind === "team" && where.offline
		? "The change waits here until the server can be reached."
		: "The change goes to the team with the next sync.";

/**
 * The next step for case `c` at `where`; `undefined`: none (a closed case).
 * `adding`: the toolbar adds to it on the tab in front, so Add marks is in
 * hand already. `mayClose`: the role lets the user close it. Fixed marks and
 * open ones are both said, each with its actions: Start verifying first.
 *
 * In the team's case, with `me` (who is signed in): whose turn it is
 * (DEC-071). `mayAssign`: the role lets them change the case and the team's
 * members are known, so the Assign menu is offered with the open marks.
 * `reporterGone`: whoever started the case is no member of the team any
 * more, so their turn is nobody's and whoever may takes it.
 */
export function nextStep(
	c: Case,
	where: Where,
	{
		adding,
		mayClose,
		me,
		mayAssign = false,
		reporterGone = false,
	}: {
		adding: boolean;
		mayClose: boolean;
		me?: string;
		mayAssign?: boolean;
		reporterGone?: boolean;
	},
): NextStep | undefined {
	if (c.closed !== undefined) return undefined;
	if (c.marks.length === 0)
		return {
			text: "Draw on the page and say what is wrong.",
			actions: adding ? [] : ["add-marks"],
		};
	const n = caseCounts(c);
	const assignee = assigneeOf(c);
	// The team's case with a known assignee: whose turn it is. The reporter
	// not known yet (on its way to the server) is the viewer: it was made here.
	const turns =
		where.kind === "team" && me !== undefined && assignee !== undefined;
	// Whoever started it left the team: their turn is nobody's, and whoever
	// may does it (the service's rule, DEC-042).
	const gone = turns && reporterGone;
	const reporter =
		turns && !gone && c.createdBy !== undefined && c.createdBy.id !== me
			? c.createdBy
			: undefined;
	const left = gone ? `, ${GONE}` : "";
	const waits = turns && c.assign !== undefined ? ` ${assignWaits(where)}` : "";
	if (n.open === 0 && n.toVerify === 0)
		return reporter === undefined
			? {
					text: turns
						? `Every mark is settled${left}: close the case.`
						: "Every mark is settled.",
					actions: mayClose ? ["close"] : [],
				}
			: {
					text: `Every mark is settled: ${reporter.name} closes the case.`,
					actions: [],
				};
	const open =
		n.open === 0
			? undefined
			: turns
				? forAssignee(where, assignee, me, mayAssign)
				: forOpen(where);
	if (n.toVerify === 0 && open !== undefined)
		return { text: `${open.text}${waits}`, actions: open.actions };
	if (reporter !== undefined)
		return open === undefined
			? {
					text: `Every open mark is fixed: ${reporter.name} checks and verifies them.${waits}`,
					actions: [],
				}
			: { text: `${open.text}${waits}`, actions: open.actions };
	const check =
		turns && open === undefined
			? `Every open mark is fixed${left}: check them on the page that has the fix, and verify them.`
			: "Check the fixed marks on the page that has the fix.";
	return {
		text: `${open === undefined ? check : `${check} ${open.text}`}${waits}`,
		actions: ["verify", ...(open?.actions ?? [])],
	};
}

/** The mark "Start verifying" goes to: the lowest-numbered of those to verify. */
export function firstToVerify(c: Case): Mark | undefined {
	return [...c.marks]
		.sort((x, y) => x.number - y.number)
		.find((a) => markStatus(a) === "fixed");
}

/** What a copy did, said in the block while the step still offers that copy. */
export interface Copied {
	what: "copy-link" | "copy-ai";
	text: string;
}

/** What "Copy link" says it did: for whom the link works, and what to do for anyone else. */
export const linkCopied = (team: string): string =>
	`Link copied. It opens the case for the members of “${team}”; for anyone else, use Share… in the web app.`;

/** What "Copy for your AI app" says it did: the web app's words. */
export const AI_COPIED =
	"Instructions for this case copied. Paste them into your AI app.";

/** A copy the browser refused: mostly because the panel did not have the focus. */
export const COPY_FAILED =
	"Copying did not work. Click in the side panel and try again.";

/**
 * The copies: the case's address in the web app, or the instructions for
 * an AI app with it, given to `write` (the clipboard, in the click). Only
 * where the server has the case; `undefined`: nothing to copy.
 */
export async function copyStep(
	c: Case,
	where: Where,
	what: Copied["what"],
	write: (text: string) => Promise<void>,
): Promise<Copied | undefined> {
	if (where.kind !== "team" || where.link === undefined) return undefined;
	const text =
		what === "copy-link"
			? where.link
			: caseInstructions({
					id: c.id,
					title: c.title,
					url: where.link,
					mcpUrl: where.mcp,
				});
	try {
		await write(text);
	} catch {
		return { what, text: COPY_FAILED };
	}
	return {
		what,
		text: what === "copy-link" ? linkCopied(where.team) : AI_COPIED,
	};
}
