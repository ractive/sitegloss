/**
 * What comes next on the open case (DEC-069): one sentence on where the case
 * stands and the one or two actions that move it on. Pure, so the rule can
 * be tested over every state; `next-step-view.ts` draws it.
 *
 * It knows what this browser knows: the marks' states, whether the case is
 * the team's or this browser's, and the sync's state as the worker last
 * wrote it. The panel does not read the sync's books per case, so whether
 * the team has the case is said only where it is certain: a mark of it came
 * from the server, or the last sync ended with nothing waiting after the
 * case last changed. Until then no link is offered: it would not open.
 */

import { type Case, caseCounts } from "../lib/case.ts";
import type { CloudStatus } from "../lib/cloud/book.ts";
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
	| "close";

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
	/** The team's, and the team does not have it yet (or this browser cannot tell). */
	| { kind: "sending"; why: "syncing" | "offline" | "problem" | "next" }
	/** The team has it: `link` is its page in the web app, `mcp` the MCP server. */
	| { kind: "team"; team: string; link: string | undefined; mcp: string };

/** The case's page in the web app, as the web app makes it for a member. */
export function caseAddress(
	server: string,
	slug: string,
	caseId: string,
): string {
	return `${server}/t/${encodeURIComponent(slug)}/cases/${encodeURIComponent(caseId)}`;
}

/** The service's MCP server, as the web app names it (`mcpResource`). */
export const mcpAddress = (server: string): string => `${server}/api/mcp`;

/**
 * Whether the team has the case for certain: a mark of it carries the
 * server's record of who made it, or the last sync ended with nothing left
 * to send, no problem with this case, after it last changed here.
 */
export function teamHasIt(c: Case, status: CloudStatus | undefined): boolean {
	if (c.marks.some((a) => a.createdBy !== undefined)) return true;
	if (status?.state !== "synced" || (status.waiting ?? 0) > 0) return false;
	if (status.problems.some((p) => p.caseId === c.id)) return false;
	const at = status.lastSyncedAt;
	return at !== undefined && Date.parse(c.updatedAt) <= Date.parse(at);
}

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
	const status = cloud.status;
	if (!teamHasIt(c, status))
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
	const team = teamOf(cloud);
	const server = account?.server ?? cloud.server;
	return {
		kind: "team",
		team: team?.name ?? "",
		link:
			team?.slug === undefined
				? undefined
				: caseAddress(server, team.slug, c.id),
		mcp: mcpAddress(server),
	};
}

const marks = (n: number) => `${n} mark${n === 1 ? "" : "s"}`;
const are = (n: number) => (n === 1 ? "is" : "are");

const LIST = "Team in the list of cases";

const SENDING: Record<Extract<Where, { kind: "sending" }>["why"], string> = {
	syncing: "It is being sent to the team; its link works once it is there.",
	offline: `It is not with the team yet: the server cannot be reached, and Sitegloss tries again by itself.`,
	problem: `The team does not have it yet: ${LIST} says why.`,
	next: "It goes to the team with the next sync; its link works once it is there.",
};

/** Only in this browser: what it says, and what it offers. */
function inBrowser(where: Extract<Where, { kind: "browser" }>): NextStep {
	const only = "It is only in this browser.";
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
 * The next step for case `c` at `where`; `undefined`: none (a closed case).
 * `adding`: the toolbar adds to it on the tab in front, so Add marks is in
 * hand already. `mayClose`: the role lets the user close it.
 */
export function nextStep(
	c: Case,
	where: Where,
	{ adding, mayClose }: { adding: boolean; mayClose: boolean },
): NextStep | undefined {
	if (c.closed !== undefined) return undefined;
	if (c.marks.length === 0)
		return {
			text: "Mark what is wrong on the page.",
			actions: adding ? [] : ["add-marks"],
		};
	const n = caseCounts(c);
	if (n.open === 0 && n.toVerify === 0)
		return {
			text: "Every mark is settled.",
			actions: mayClose ? ["close"] : [],
		};
	if (n.toVerify > 0) {
		const onward: StepAction[] =
			n.open === 0
				? []
				: where.kind === "team" && where.link !== undefined
					? ["copy-link"]
					: where.kind === "browser" && where.share === "may"
						? ["share"]
						: [];
		return {
			text: `${marks(n.toVerify)} ${are(n.toVerify)} fixed and ${n.toVerify === 1 ? "waits" : "wait"} to be checked on the page that has the fix.`,
			actions: ["verify", ...onward],
		};
	}
	const open = `${marks(n.open)} ${are(n.open)} open.`;
	switch (where.kind) {
		case "browser":
			return inBrowser(where);
		case "signed-out":
			return {
				text: `${open} Your sign-in ran out, so changes stay in this browser: sign in again under ${LIST}.`,
				actions: [],
			};
		case "sending":
			return { text: `${open} ${SENDING[where.why]}`, actions: [] };
		default:
			return where.link === undefined
				? {
						text: `${open} Send the case to whoever fixes them: it is in the team's cases in the web app.`,
						actions: [],
					}
				: {
						text: `${open} Send the case to whoever fixes them.`,
						actions: ["copy-link", "copy-ai"],
					};
	}
}

/** What "Copy link" says it did: for whom the link works, and what to do for anyone else. */
export const linkCopied = (team: string): string =>
	`Link copied. It opens the case for the members of “${team}”. For someone outside the team, use Share… on the case's page in the web app.`;

/** What "Copy for your AI app" says it did: the web app's words. */
export const AI_COPIED =
	"Instructions for this case copied. Paste them into your AI app.";

/** A copy the browser did not allow. */
export const COPY_FAILED =
	"Copying did not work: the browser did not allow it. Try again.";
