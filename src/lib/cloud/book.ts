/**
 * What the sync with sitegloss.dev keeps beside the cases (DEC-039), in a
 * database of its own (`sitegloss-cloud`): who is signed in and to which
 * team, how far the team's changes were read, and per case what the server
 * last had of it. The cases themselves stay as they are: a case holds nothing
 * of this, so it reads the same with or without an account.
 *
 * Ids: a mark is `m<number>` and a screenshot `s<n>` on this device, which
 * says where it is, not what it is; two devices give the same ids to
 * different things. At the server a mark and a screenshot have ids of their
 * own, made once on the device that made them. `marks` and `shots` say which
 * is which here.
 */

import type { CaseComment, ImageAdded } from "../case.ts";
import type { Kv } from "../kv.ts";
import type {
	ImageRef,
	Op,
	Team,
	WireFinding,
	WireReopen,
	WireResolution,
} from "./api.ts";

export const CLOUD_DATABASE = "sitegloss-cloud";

/**
 * Keys in one server's part of the database (servers.ts: everything here is
 * kept per server; the tokens' keys are in auth.ts).
 */
export const KEYS = {
	account: "account",
	/** The team's revision the changes were read up to. */
	cursor: "cursor",
	/** Operations sent, or about to be, and not confirmed yet. */
	queue: "queue",
	status: "status",
	/** How each case syncs: read by the panel, which needs no more of a book. */
	modes: "modes",
	/** When the team's whole state has to be read again. */
	whole: "whole",
} as const;

/** What a case's book is kept under, before the case's id. */
export const BOOK = "case:";

/**
 * Which cases the database's bookkeeping is for: the store's version 2
 * (DEC-051) starts with no case (store.ts), and `forgetCases` brings this
 * database along once. Not kept per server.
 */
export const CASES_KEY = "cases";
export const CASES = "sitegloss/2";

/** One server's entries that are about cases (beside the books). */
const ABOUT_CASES: ReadonlySet<string> = new Set([
	KEYS.cursor,
	KEYS.queue,
	KEYS.whole,
	KEYS.modes,
	KEYS.status,
]);

/** Whether `forgetCases` has run: the books are this build's. */
export async function casesForgotten(kv: Kv): Promise<boolean> {
	return (await kv.get(CASES_KEY)) === CASES;
}

/**
 * Forget, once, everything the cloud's database kept about the cases of
 * before DEC-051, for every server: the books (which mark here is which
 * there, what was sent), how far the team's changes were read, what waited
 * to be sent, and the deletes an expired sign-in recorded. What is not about
 * cases stays: the server chosen, the account and its team, the tokens.
 *
 * In one transaction (`Kv.update`): the look at the marker, the removals and
 * the marker itself, so a second caller finds the marker and removes
 * nothing, and nothing written after it is touched. Only the service worker
 * calls it, and only once the case store is open at its version 2
 * (`casesReady` in worker/cloud.ts): before that, the cases of before may
 * still be there for a build before this one.
 */
export async function forgetCases(kv: Kv): Promise<void> {
	if (kv.update === undefined)
		throw new Error("forgetCases needs a database that changes in one step");
	await kv.update((entries) => {
		if (entries[CASES_KEY] === CASES) return undefined;
		const remove: string[] = [];
		const set: Record<string, unknown> = { [CASES_KEY]: CASES };
		for (const [key, value] of Object.entries(entries)) {
			const space = key.startsWith("@") ? key.indexOf(" ") : -1;
			const own = space < 0 ? key : key.slice(space + 1);
			// (Keys without a server's scope are as 0.3.0 kept them, before DEC-041.)
			if (own.startsWith(BOOK) || ABOUT_CASES.has(own)) remove.push(key);
			else if (
				own === KEYS.account &&
				typeof value === "object" &&
				value !== null &&
				"liveDeletes" in value
			) {
				const { liveDeletes: _gone, ...account } = value as Account;
				set[key] = account;
			}
		}
		return { set, remove };
	});
}

/** Who is signed in, and where. */
export interface Account {
	server: string;
	user: { id: string; name: string; email: string };
	/** The user's teams, as the server last said, with what they may do in each. */
	teams: Team[];
	/** The team the cases sync to; none: not chosen yet (several teams, or none). */
	teamId?: string;
	/** When the teams were last asked for (ms). */
	checkedAt: number;
	/**
	 * The server refused the tokens: the user has to sign in again. What is
	 * kept (the books, the queue) goes on then.
	 */
	expired?: true;
	/**
	 * With `expired`: the cases whose delete was on record when it ran out,
	 * made while the sign-in was live. A delete made later is not the
	 * team's: it is forgotten at the next sign-in (DEC-041).
	 */
	liveDeletes?: string[];
}

/**
 * `synced`: goes to the team and follows it. `local`: stays on this device
 * (the user's choice, or what signing out leaves). `undecided`: it was here
 * before the team was chosen, and the user has not said yet.
 */
export type SyncMode = "synced" | "local" | "undecided";

/** What of a case a `case.patch` can say. */
/**
 * What of a case a `case.patch` says. Not its pages: the server keeps that
 * list itself, from the screenshots (DEC-039, the pages).
 */
export interface CaseContent {
	title: string;
	link: string | null;
	summary: string | null;
	lastNumber: number;
}

/** What of a mark a `mark.patch` can say. */
export interface MarkContent {
	comment: string;
	author: "user" | "ai";
	resolution: WireResolution | null;
	reopens: WireReopen[];
	findings: WireFinding[];
	/**
	 * The images added to the mark, in order (DEC-058). Absent: not told (a
	 * server from before images, or a shadow written before them), which
	 * reads as none for what is sent and removes nothing here.
	 */
	images?: ContentImage[];
}

/**
 * An image added to a mark, as content: only added or removed, so its id
 * says which; who added it when, for showing; the server's picture (`ref`),
 * where the server named it, to fetch it.
 */
export interface ContentImage {
	id: string;
	added: ImageAdded;
	ref?: ImageRef;
}

/** A mark as the server last had it. */
export interface ShadowMark {
	number: number;
	/** Its screenshot's id at the server. */
	shotId: string;
	content: MarkContent;
	/** What never changes of it (its drawing and element), as one text. */
	fixed: string;
}

/** A case as the server last had it: what changes are found against. */
export interface Shadow {
	case: CaseContent;
	/** By the screenshot's id at the server. */
	/**
	 * `capturedAt`: when it was taken, as sent or received. A screenshot
	 * here is the server's only when that agrees: its id here (`s<n>`) is
	 * given again after an Undo or a delete, to another screenshot.
	 */
	shots: Record<string, { image: ImageRef; capturedAt?: string }>;
	/** By the mark's id at the server. */
	marks: Record<string, ShadowMark>;
	/** Closed at the server (DEC-046); none: open, or a build before it. */
	closed?: boolean;
	/** The thread at the server, by the comment's id (the same here). */
	comments?: Record<string, ShadowComment>;
}

/** A comment as the server last had it. */
export interface ShadowComment {
	text: string;
	/** Who wrote it, by the server's word: only one's own is deleted from here. */
	userId?: string;
}

/** A change the server did not take: not sent again while it is the same. */
export interface Rejected {
	/** The operation without its id, as one short text (`opKey`). */
	key: string;
	/** Why, in words for the user. */
	text: string;
}

/** The bookkeeping of one case. */
export interface CaseBook {
	caseId: string;
	/**
	 * Comments written here that would take the case past the most it holds
	 * (DEC-046): kept, unsent, and said; back in the case when there is room.
	 */
	parkedComments?: CaseComment[];
	mode: SyncMode;
	/** The team it is synced with, or was. */
	teamId?: string;
	/** The mark's id here (`m<number>`) to its id at the server. */
	marks: Record<string, string>;
	/** The screenshot's id here (`s<n>`) to its id at the server. */
	shots: Record<string, string>;
	/** None: the server does not have the case (yet, or any more). */
	shadow?: Shadow;
	/** The case's `updatedAt` here when it last was as the shadow: nothing to send. */
	cleanAt?: string;
	rejected?: Rejected[];
	/**
	 * The changes last sent, as one text, and how often in a row the very
	 * same ones were found again: the server took them and the case came back
	 * as it was, so this device and the server do not agree on something.
	 * They are not sent a fourth time (`MAX_SAME_SENDS`).
	 */
	sent?: { keys: string; times: number };
	/**
	 * Nothing of the case could be sent as it was at `at` (its `updatedAt`),
	 * with what the user may do (`may`): what is left is held back, not
	 * allowed, or lacks its image. Until one of the two changes the case is
	 * passed by, with nothing read, hashed or asked, and `texts` is what
	 * there is to say about it. "Sync now" looks again.
	 */
	idle?: { at: string; may: string; texts: string[] };
	/** Its title, for a sentence about it once it is gone. */
	title?: string;
	/**
	 * The team has a case with this id, and the case here is kept on this
	 * device (or is another server's): nothing of either was taken or sent.
	 * Said in the status; sharing the case joins the two (the team's copy is
	 * read first, then what it lacks is sent). The team's marks as last seen,
	 * by their id there: enough to say how many marks here the team has with
	 * other words, which the join replaces.
	 */
	theirs?: Record<string, TheirMark>;
	/**
	 * The case has to be read from the server, whole, before anything of it
	 * is sent: it is joined with the team's copy, a change of the team's
	 * could not be stored, it is not in the store here, or its book was
	 * taken up again after a time without syncing. Kept across restarts.
	 */
	reread?: Reread;
	/**
	 * Ids of the server's written down before the case that has their marks
	 * and screenshots was stored (should the worker stop between the two,
	 * they are known as the server's), each with what tells whether the
	 * mark or screenshot now under that id here is the one meant: the
	 * mark's drawing (`fixedOf`), the screenshot's time. An id here can
	 * come to mean another mark before the case is stored.
	 */
	announced?: {
		marks: Record<string, string>;
		shots: Record<string, string>;
	};
}

/** A mark of the team's, as much as tells whether a mark here is it and says the same. */
export interface TheirMark {
	number: number;
	/** `fixedOf` its drawing. */
	fixed: string;
	/** A number of what it says (`saidOf`). */
	said: string;
}

/** Why a case is read again, and when: a read that fails is tried later and later. */
export interface Reread {
	/**
	 * `join`: with the team's copy. `missing`: not in the store here.
	 * `resumed`: its book is taken up again after a time without syncing.
	 * Nothing of these is sent before the read. `failed`: something of the
	 * team's could not be stored or fetched; what is here is sent as usual.
	 */
	why: "join" | "failed" | "missing" | "resumed";
	/** Reads that failed so far. */
	tries: number;
	/** Not before this (ms since the epoch). */
	after: number;
	/** What is wrong, said in the status until the read works. */
	text?: string;
	/**
	 * `join`: the user was told what the join replaces (how many marks get
	 * the team's text) and said yes. Without it a join that would replace
	 * text stops and asks first.
	 */
	told?: true;
}

/** How long after a read of a case failed the next one waits: a case that can never be stored is not fetched at every run. */
export const REREAD_WAIT_MS: readonly number[] = [
	60_000, 300_000, 1_800_000, 21_600_000,
];

/** How often the very same changes are sent in a row before the sync stops sending them. */
export const MAX_SAME_SENDS = 3;

export const emptyBook = (
	caseId: string,
	mode: SyncMode,
	teamId?: string,
): CaseBook => ({
	caseId,
	mode,
	...(teamId === undefined ? {} : { teamId }),
	marks: {},
	shots: {},
});

/** Operations of one case on their way to the server. */
export interface Queue {
	caseId: string;
	teamId: string;
	ops: Op[];
}

/** What the panel shows of the sync. */
export interface CloudStatus {
	/**
	 * `off`: nobody signed in, or no team chosen. `signed-out`: the sign-in
	 * ran out, sign in again. `offline`: the server was not reached, it is
	 * tried again. `problem`: it answered with a failure of its own.
	 */
	state: "off" | "syncing" | "synced" | "offline" | "problem" | "signed-out";
	/** While syncing: how many cases are still to send. */
	left?: number;
	/** Why it is offline, has a problem or is signed out, in plain words. */
	text?: string;
	lastSyncedAt?: string;
	/** Changes the server did not take, and cases it could not give. */
	problems: { caseId?: string; title?: string; text: string }[];
	/**
	 * What there is to tell that is nobody's fault and needs nothing done: a
	 * case kept on this device that the team has too, marks that are back.
	 * Shown, but no problem: the state is not `problem` for them.
	 */
	notes?: { caseId?: string; title?: string; text: string }[];
	/** Cases that were here before the team was chosen and wait for an answer. */
	undecided: number;
	/**
	 * Cases with changes the team does not have yet and that can go (none
	 * waits to be read first, none is held back): what "Up to date" means
	 * there are none of. Unknown from a build before it.
	 */
	waiting?: number;
	/**
	 * Of the cases not decided about yet: how many the team already has
	 * (under the same id), and how many of their marks say something else
	 * there, which "Sync them" replaces with the team's.
	 */
	joins?: { cases: number; marks: number };
}

export const OFF: CloudStatus = { state: "off", problems: [], undecided: 0 };

/** The books, read and written through the database. */
export class Books {
	/** How often a book was written or removed: whoever read them knows whether to read again. */
	writes = 0;

	constructor(private readonly kv: Kv) {}

	async all(): Promise<Map<string, CaseBook>> {
		const books = new Map<string, CaseBook>();
		for (const [key, value] of Object.entries(await this.kv.all()))
			if (key.startsWith(BOOK)) {
				const book = value as CaseBook;
				books.set(book.caseId, book);
			}
		return books;
	}

	async get(caseId: string): Promise<CaseBook | undefined> {
		return (await this.kv.get(BOOK + caseId)) as CaseBook | undefined;
	}

	async put(...books: CaseBook[]): Promise<void> {
		if (books.length === 0) return;
		this.writes++;
		await this.kv.set(
			Object.fromEntries(books.map((b) => [BOOK + b.caseId, b])),
		);
	}

	async remove(caseId: string): Promise<void> {
		this.writes++;
		await this.kv.remove(BOOK + caseId);
	}

	/** Write how each case syncs, for the panel. */
	async publishModes(): Promise<Record<string, SyncMode>> {
		const modes: Record<string, SyncMode> = {};
		for (const book of (await this.all()).values())
			modes[book.caseId] = book.mode;
		await this.kv.set({ [KEYS.modes]: modes });
		return modes;
	}
}

/** The account, as stored; `undefined`: nobody is signed in. */
export async function readAccount(kv: Kv): Promise<Account | undefined> {
	const account = (await kv.get(KEYS.account)) as Account | undefined;
	return typeof account?.server === "string" && account.user !== undefined
		? account
		: undefined;
}

/** The team chosen, with what the user may do in it. */
export function teamOf(account: Account | undefined): Team | undefined {
	return account?.teamId === undefined
		? undefined
		: account.teams.find((t) => t.id === account.teamId);
}
