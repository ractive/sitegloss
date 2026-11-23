/**
 * The sync with a team at sitegloss.dev (DEC-039). Local first: the cases
 * are in this browser and every action is stored there as before; this
 * sends what changed to the team and takes in what the team changed.
 *
 * A run: send first, then fetch, always in that order.
 *
 * - **Send.** Each case that syncs is compared with what the server last
 *   had of it (its shadow, book.ts), and the difference becomes operations
 *   (wire.ts). Images are uploaded before the operations that name them.
 *   The operations are written down before they are sent, each with an id
 *   of its own, so a reply that never came costs nothing: they are sent
 *   again as they were, and the server applies an id once.
 * - **Fetch.** Everything after the team's revision this device has seen.
 *   For each mark and field: what was not changed here since the server
 *   last had it becomes the server's; what was changed here stays, and is
 *   sent next. Nothing waits to be sent while a fetch is applied, as
 *   sending comes first and a failed send ends the run.
 *
 * The store, the database and the API are given: the service worker gives
 * the real ones, the tests an API in memory that follows the server's rules.
 */

import {
	type Case,
	MAX_CASE_COMMENTS,
	type Rect,
	newId as randomId,
	validateCase,
} from "../case.ts";
import type { Kv } from "../kv.ts";
import { type CaseStore, DELETED_KEPT_MS, type StoredImage } from "../store.ts";
import {
	type Api,
	ApiFailure,
	type Changes,
	type ImageRef,
	MAX_IMAGE_BYTES,
	MAX_OPS,
	MAX_OPS_BYTES,
	type Me,
	type Op,
	type OpResult,
	type OpType,
	SMALL_PAGE,
	sha256Of,
	type Team,
	TOO_LARGE,
	type WireCase,
	type WireComment,
	type WireMark,
	type WireShot,
} from "./api.ts";
import {
	type Account,
	BOOK,
	Books,
	type CaseBook,
	type CloudStatus,
	emptyBook,
	KEYS,
	MAX_SAME_SENDS,
	OFF,
	type Queue,
	REREAD_WAIT_MS,
	type Rejected,
	type Reread,
	readAccount,
	teamOf,
} from "./book.ts";
import {
	addedImagesOf,
	applyOp,
	appOut,
	carryVia,
	cutKey,
	deriveOps,
	differing,
	fixedOf,
	type Incoming,
	type Merged,
	mergeCase,
	NeedsImage,
	newCaseOf,
	opKey,
	relink,
	renumber,
	reverse,
	same,
	settleAnnounced,
	theirMark,
	wholeShotCrops,
	wholeShotMarks,
} from "./wire.ts";

export interface EngineDeps {
	store: CaseStore;
	/** The cloud's database (`sitegloss-cloud`). */
	kv: Kv;
	/** The API of the server at that address, for whoever is signed in. */
	api: (server: string) => Api;
	now?: () => Date;
	newId?: (prefix: string) => string;
	hash?: (image: Blob) => Promise<string>;
	/** Cases here were changed, added or deleted by what came from the server. */
	onChange?: (caseIds: string[]) => void;
	onStatus?: (status: CloudStatus) => void;
	/**
	 * Given: a choice of the user's (signing in, a team, sharing) answers once
	 * it is written down, and the run that follows is handed here instead of
	 * being waited for (the worker: the panel need not wait for a first sync
	 * of many pictures). Not given (the tests): the choice answers after its
	 * run.
	 */
	later?: (run: Promise<void>) => void;
	/**
	 * The cases that synced with another server (DEC-041). They are on this
	 * device only as far as this server goes, and are not among "the cases
	 * that were here before": each one is shared here by itself, or not.
	 */
	elsewhere?: () => Promise<ReadonlySet<string>>;
	/**
	 * Cuts the part `rect` (CSS pixels of a screenshot `viewportWidth` wide)
	 * out of a screenshot: the crop of a mark an AI app added at the server
	 * (MCP `add_mark`), whose crop there is the whole screenshot. Not given:
	 * such a mark keeps the whole screenshot as its crop.
	 */
	cutCrop?: (
		shot: StoredImage,
		rect: Rect,
		viewportWidth: number,
	) => Promise<StoredImage>;
	/**
	 * Whether the cases and the books are this build's (DEC-051): the case
	 * store open at its version 2 and the cloud's database past
	 * `forgetCases`. Until it answers true the engine does nothing: no run,
	 * no choice, no book read or written, nothing sent. Not given (the
	 * tests): always.
	 */
	casesReady?: () => Promise<boolean>;
}

/** The engine waits: the cases or the books are not this build's yet (`casesReady`). */
export class CasesNotReadyError extends Error {
	constructor() {
		super(
			"Sitegloss is still opening its cases; the sync starts once they are open.",
		);
		this.name = "CasesNotReadyError";
	}
}

/** What each operation needs the user to be allowed to do in the team. */
const PERMISSION: Record<OpType, string> = {
	"case.create": "case:create",
	"case.patch": "case:update",
	"case.delete": "case:delete",
	"shot.create": "mark:create",
	"shot.delete": "mark:delete",
	"mark.create": "mark:create",
	"mark.patch": "mark:update",
	"mark.delete": "mark:delete",
	// DEC-046: closing, and the thread (another's comment also needs
	// `comment:moderate`, which the server decides).
	"case.close": "case:close",
	"case.reopen": "case:close",
	"comment.create": "comment:create",
	"comment.patch": "comment:create",
	"comment.delete": "comment:create",
};

/** What an operation was about, for the sentence that says it was not taken. */
function whatOf(op: Op): string {
	switch (op.type) {
		case "case.create":
			return "The case could not be shared with the team";
		case "case.patch":
			return "A change to the case was not taken";
		case "case.delete":
			return "The case could not be deleted for the team";
		case "shot.create":
			return "A screenshot was not taken";
		case "mark.create":
			return `Mark ${op.mark.number} was not taken`;
		case "mark.patch":
			return "A change to a mark was not taken";
		case "mark.delete":
			return "A mark could not be deleted for the team";
		case "case.close":
			return "The case could not be closed for the team";
		case "case.reopen":
			return "The case could not be opened again for the team";
		case "comment.create":
			return "A comment was not taken";
		case "comment.patch":
			return "A change to a comment was not taken";
		case "comment.delete":
			return "A comment could not be deleted for the team";
		default:
			return "A change was not taken";
	}
}

/**
 * The images added to marks of `c` that the team does not have (not in the
 * shadow) and why, where a reason is known: what the server refused, or a
 * role that may not change marks. One merely waiting to go says nothing.
 */
function notSentOf(
	c: Case,
	book: CaseBook,
	mayAdd: boolean,
): Record<string, string> {
	const out: Record<string, string> = {};
	const refused = new Map<string, string>();
	for (const r of book.rejected ?? [])
		for (const id of r.images ?? []) refused.set(id, r.why ?? r.text);
	for (const a of c.marks) {
		const wire = book.marks[a.id];
		const had = new Set(
			(
				(wire === undefined ? undefined : book.shadow?.marks[wire])?.content
					.images ?? []
			).map((x) => x.id),
		);
		for (const x of a.images ?? []) {
			if (had.has(x.id)) continue;
			const why =
				refused.get(x.id) ??
				(mayAdd ? undefined : "your role in the team does not allow it");
			if (why !== undefined) out[x.id] = why;
		}
	}
	return out;
}

/** The number of the mark an added image of this path is on (DEC-058); none: no such image. */
function addedTo(c: Case, path: string): number | undefined {
	return c.marks.find((a) => a.images?.some((x) => x.image === path))?.number;
}

/** The pictures an operation names, which have to be at the server before it. */
function picturesOf(op: Op): ImageRef[] {
	switch (op.type) {
		case "shot.create":
			return [op.shot.image];
		case "mark.create":
			return [op.mark.crop, ...(op.mark.images ?? []).map((x) => x.image)];
		case "mark.patch":
			return (op.images?.add ?? []).map((x) => x.image);
		default:
			return [];
	}
}

/** Why the server refused, in plain words; a code it does not know reads as its message. */
function whyOf(code: string, message: string): string {
	const said = message.trim().replace(/[.!]+$/, "");
	switch (code) {
		case "forbidden":
			return "your role in the team does not allow it";
		case "not_found":
			return "it is no longer there for the team";
		case "blob_missing":
			return "its image did not reach the server";
		default:
			return said === "" ? "the server refused it" : said;
	}
}

const sentence = (op: Op, code: string, message: string) =>
	`${whatOf(op)}: ${whyOf(code, message)}.`;

/** What the user may do in the team, as one text: a change of it makes a case worth another look. */
const permissionsKey = (team: Team): string =>
	[...(team.permissions ?? [])].sort().join(" ");

/**
 * Nothing of the case could go at the last look, nothing changed since, and
 * the role allows what it allowed then: the case is passed by. The one
 * test, for sending and for saying what waits.
 */
const heldBack = (book: CaseBook | undefined, c: Case, mayKey: string) =>
	book?.idle !== undefined &&
	book.idle.at === c.updatedAt &&
	book.idle.may === mayKey;

/** A book of a case that is on this device only from now on: nothing waits for the server any more. */
function local(book: CaseBook): CaseBook {
	const { reread: _r, idle: _i, ...rest } = book;
	return { ...rest, mode: "local" };
}

/** A case that has to be read from the server before anything of it is sent. */
const blocks = (mark: Reread): boolean => mark.why !== "failed";

/** The most rejected changes kept per case. */
const MAX_REJECTED = 50;

/** How long the teams and permissions are taken as last read. */
export const ACCOUNT_FRESH_MS = 10 * 60_000;

/** How old the account's teams must be before a look of the panel asks again (DEC-045). */
export const ACCOUNT_CHECK_MS = 60_000;

/** How many images are fetched at once. */
const FETCHES = 4;

/** Aborts a store transaction that has nothing to write. */
const NOTHING = new Error("nothing to write");

const describe = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** The sync: `request()` after any change, and the user's choices. */
export class CloudSync {
	readonly #deps: EngineDeps;
	readonly #books: Books;
	readonly #now: () => Date;
	readonly #newId: (prefix: string) => string;
	readonly #hash: (image: Blob) => Promise<string>;
	/** One piece of work at a time: runs and the user's choices never overlap. */
	#chain: Promise<unknown> = Promise.resolve();
	#queued: Promise<void> | undefined;
	/** Images this worker knows the team has. */
	readonly #have = new Set<string>();
	/** How often this engine wrote the cases' store. */
	#stored = 0;
	/** Who is signed in, by the server's id: only their own comments are deleted from here. */
	#me: string | undefined;
	/** The cases and the books as the run's push read them, and at which writes. */
	#read:
		| {
				cases: Case[];
				all: Map<string, CaseBook>;
				books: number;
				store: number;
		  }
		| undefined;
	/** The status last said. */
	#said: CloudStatus | undefined;
	/** What the running run has to say besides the books' rejections. */
	#problems: CloudStatus["problems"] = [];
	/** The team whose books were looked at for ones from before DEC-046. */
	#threadsChecked: string | undefined;
	/** And what it has to tell that is no problem (`CloudStatus.notes`). */
	#notes: NonNullable<CloudStatus["notes"]> = [];

	constructor(deps: EngineDeps) {
		this.#deps = deps;
		this.#books = new Books(deps.kv);
		this.#now = deps.now ?? (() => new Date());
		this.#newId = deps.newId ?? randomId;
		this.#hash = deps.hash ?? sha256Of;
	}

	/** `casesReady` said yes: it stays so for this engine. */
	#ready = false;

	#exclusive<T>(work: () => Promise<T>): Promise<T> {
		const gated = async () => {
			await this.#casesReady();
			return work();
		};
		const next = this.#chain.then(gated, gated);
		this.#chain = next.catch(() => undefined);
		return next;
	}

	/**
	 * Bring this device and the team together; several requests while a run
	 * is under way are one more run after it. Never rejects: what failed is
	 * in the status.
	 */
	request(): Promise<void> {
		this.#queued ??= this.#exclusive(async () => {
			this.#queued = undefined;
			await this.#run();
		}).catch((error: unknown) => {
			this.#queued = undefined;
			// Not yet: a later request runs once the cases are this build's.
			if (!(error instanceof CasesNotReadyError)) throw error;
		});
		return this.#queued;
	}

	/** Throws `CasesNotReadyError` until `casesReady` said yes once. */
	async #casesReady(): Promise<void> {
		if (this.#ready || this.#deps.casesReady === undefined) return;
		if (!(await this.#deps.casesReady().catch(() => false)))
			throw new CasesNotReadyError();
		this.#ready = true;
	}

	async status(): Promise<CloudStatus> {
		return ((await this.#deps.kv.get(KEYS.status)) as CloudStatus) ?? OFF;
	}

	account(): Promise<Account | undefined> {
		return readAccount(this.#deps.kv);
	}

	/** The run that follows a choice of the user's: waited for, or handed on. */
	#then(): Promise<void> {
		const run = this.request();
		if (this.#deps.later === undefined) return run;
		this.#deps.later(run);
		return Promise.resolve();
	}

	// --- the user's choices --------------------------------------------------------

	/**
	 * Someone signed in (their tokens are stored already): `me` is who, and
	 * their teams. The same person as before, after the sign-in ran out, goes
	 * on where they were; anyone else starts anew, and what synced before
	 * stays on this device. With one team, that team is chosen.
	 */
	signedIn(server: string, me: Me): Promise<void> {
		return this.#exclusive(async () => {
			const before = await this.account();
			const same =
				before !== undefined &&
				before.server === server &&
				before.user.id === me.user.id;
			if (!same) await this.#detachAll();
			// After a sign-in that ran out: a delete made since was made under a
			// button that said "from this browser", and is no delete for the
			// team. The case is read back, as after a sign-out (DEC-041).
			else if (before.expired) {
				const live = new Set(before.liveDeletes ?? []);
				await this.#deps.store.forgetDeleted(
					(await this.#deps.store.deletedCases())
						.map((r) => r.id)
						.filter((id) => !live.has(id)),
				);
			}
			const teams = me.teams ?? [];
			const kept = same ? before.teamId : undefined;
			const account: Account = {
				server,
				user: { id: me.user.id, name: me.user.name, email: me.user.email },
				teams,
				checkedAt: this.#now().getTime(),
			};
			await this.#deps.kv.set({ [KEYS.account]: account });
			const only = teams.length === 1 ? teams[0]?.id : undefined;
			const teamId =
				kept !== undefined && teams.some((t) => t.id === kept) ? kept : only;
			if (teamId !== undefined) await this.#choose(account, teamId, same);
			else await this.#say({ ...OFF });
			await this.#books.publishModes();
		}).then(() => this.#then());
	}

	/** Sync with another of the user's teams (or the first one chosen). */
	chooseTeam(teamId: string): Promise<void> {
		return this.#exclusive(async () => {
			const account = await this.account();
			if (account === undefined || !account.teams.some((t) => t.id === teamId))
				return;
			if (account.teamId !== teamId) await this.#choose(account, teamId, false);
			await this.#books.publishModes();
		}).then(() => this.#then());
	}

	async #choose(account: Account, teamId: string, resume: boolean) {
		const kv = this.#deps.kv;
		if (!resume) {
			await kv.remove(KEYS.cursor);
			await kv.remove(KEYS.queue);
			this.#have.clear();
		}
		const books = await this.#books.all();
		const cases = await this.#deps.store.listCases();
		const here = new Set(cases.map((c) => c.id));
		const changed: CaseBook[] = [];
		for (const given of books.values()) {
			// Which team has a case of its id is asked anew of a team newly chosen.
			const { theirs, ...plain } = given;
			const book = resume ? given : plain;
			// Another team's: it stays on this device.
			if (book.mode === "synced" && book.teamId !== teamId)
				changed.push(local(book));
			// This team had it before (signed out, or another team in between):
			// it goes on where it was. A case deleted here meanwhile is not
			// deleted for the team by signing in: nobody was told it would be.
			else if (
				book.mode === "local" &&
				book.teamId === teamId &&
				book.shadow !== undefined
			) {
				// What was deleted of it meanwhile is not deleted for the team
				// either: the case is read whole first, and marks the team
				// still has come back (`#reread`, "resumed").
				if (here.has(book.caseId))
					changed.push({
						...book,
						mode: "synced",
						reread: { why: "resumed", tries: 0, after: 0 },
					});
				else await this.#books.remove(book.caseId);
			} else if (theirs && !resume) changed.push(book);
		}
		// What is here already is not sent without a word: the user is asked.
		// Not after a sign-in that only ran out: what was made meanwhile is the
		// team's, as it would have been. A case without a mark is nothing yet.
		// What synced with another server is that server's: not asked about in
		// one go with the rest, but on this device only until it is shared.
		if (!resume) {
			const elsewhere = (await this.#deps.elsewhere?.()) ?? new Set<string>();
			for (const c of cases)
				if (
					!books.has(c.id) &&
					(c.marks.length > 0 || c.lastNumber !== undefined)
				)
					changed.push({
						...emptyBook(c.id, elsewhere.has(c.id) ? "local" : "undecided"),
						title: c.title,
					});
		}
		await this.#books.put(...changed);
		// A book taken up again honours only a delete made from now on: no
		// older record of its case is left. (There is none while the case is
		// here, the store sees to that; this makes it so whatever happened.)
		await this.#deps.store.forgetDeleted(
			changed.filter((b) => b.reread?.why === "resumed").map((b) => b.caseId),
		);
		const { expired: _e, liveDeletes: _l, ...rest } = account;
		await kv.set({ [KEYS.account]: { ...rest, teamId } });
	}

	/** What synced stays here as it is, on this device only. */
	async #detachAll(): Promise<void> {
		const kv = this.#deps.kv;
		const here = new Set((await this.#deps.store.listCases()).map((c) => c.id));
		for (const book of (await this.#books.all()).values()) {
			// A case deleted here whose delete was not sent stays the team's.
			// One the user was never asked about is asked about next time, and
			// one that was never sent (no mark yet) has nothing to remember.
			if (
				!here.has(book.caseId) ||
				book.mode === "undecided" ||
				(book.mode === "synced" && book.shadow === undefined)
			)
				await this.#books.remove(book.caseId);
			else if (book.mode !== "local" || book.theirs) {
				// Which team has a case of its id is another question next time.
				const { theirs: _t, ...rest } = book;
				await this.#books.put(local(rest));
			}
		}
		await kv.remove(KEYS.cursor);
		await kv.remove(KEYS.queue);
		await kv.remove(KEYS.whole);
		this.#have.clear();
	}

	/**
	 * Stop syncing: the cases stay on this device, and nothing of the account
	 * is kept. (The tokens are the caller's to end.)
	 */
	signOut(): Promise<void> {
		return this.#exclusive(async () => {
			await this.#detachAll();
			await this.#deps.kv.remove(KEYS.account);
			await this.#books.publishModes();
			await this.#say({ ...OFF });
		});
	}

	/**
	 * The answer to "these cases were here before": share them with the team,
	 * or keep them on this device.
	 */
	decide(share: boolean): Promise<void> {
		return this.#exclusive(async () => {
			const team = teamOf(await this.account());
			const books = [...(await this.#books.all()).values()]
				.filter((b) => b.mode === "undecided")
				.map(
					(b): CaseBook =>
						share && team !== undefined ? this.#shared(b, team.id) : local(b),
				);
			await this.#books.put(...books);
			await this.#books.publishModes();
		}).then(() => this.#then());
	}

	/**
	 * A book of a case the user now shares with the team. When the team was
	 * seen to have a case of that id, the two are joined: the team's copy is
	 * read first (`reread`), and nothing is sent before.
	 */
	#shared(book: CaseBook, teamId: string): CaseBook {
		const { theirs, reread: _r, idle: _i, ...rest } = book;
		return {
			...rest,
			mode: "synced",
			teamId,
			// Told what it replaces (the count was on the screen), and shared.
			...(theirs === undefined
				? {}
				: {
						reread: {
							why: "join" as const,
							tries: 0,
							after: 0,
							told: true as const,
						},
					}),
		};
	}

	/** Share one case that was kept on this device with the team. */
	share(caseId: string): Promise<void> {
		return this.#exclusive(async () => {
			const team = teamOf(await this.account());
			if (team === undefined) return;
			const book =
				(await this.#books.get(caseId)) ?? emptyBook(caseId, "local");
			// What another team had of it says nothing about this one.
			const fresh = book.teamId !== undefined && book.teamId !== team.id;
			await this.#books.put(
				this.#shared(fresh ? emptyBook(caseId, "synced") : book, team.id),
			);
			await this.#books.publishModes();
		}).then(() => this.#then());
	}

	/**
	 * The panel came into view (DEC-045): the user's teams, asked for again
	 * when that was more than a minute ago. One request; only a change (a
	 * team joined or left, a role changed) is written, said, and followed by
	 * a run. Whether anything changed. Nothing here starts another check:
	 * the panel asks on being shown, and a minute must pass between two.
	 */
	checkAccount(): Promise<boolean> {
		return this.#exclusive(async () => {
			const account = await this.account();
			if (account === undefined || account.expired) return false;
			if (this.#now().getTime() - account.checkedAt < ACCOUNT_CHECK_MS)
				return false;
			let next: Account;
			try {
				next = await this.#refresh(
					this.#deps.api(account.server),
					account,
					ACCOUNT_CHECK_MS,
				);
			} catch (error) {
				// Not reached, or refused: the next run asks and says it.
				if (error instanceof ApiFailure) return false;
				throw error;
			}
			const changed =
				next.teamId !== account.teamId ||
				JSON.stringify(next.teams) !== JSON.stringify(account.teams);
			if (!changed) return false;
			await this.#books.publishModes();
			const before = await this.status();
			if (teamOf(next) !== undefined)
				await this.#say(
					await this.#status(
						before.state === "off" || before.state === "syncing"
							? "synced"
							: before.state,
						before.text === undefined ? {} : { text: before.text },
					),
				);
			return true;
		}).then((changed) => {
			if (changed) void this.#then();
			return changed;
		});
	}

	/** "Sync now": also what the server refused before is tried again. */
	retry(): Promise<void> {
		return this.#exclusive(async () => {
			const books = [...(await this.#books.all()).values()].filter(
				(b) =>
					b.rejected !== undefined ||
					b.cleanAt !== undefined ||
					b.sent !== undefined ||
					b.idle !== undefined ||
					b.reread !== undefined,
			);
			await this.#books.put(
				...books.map((b) => {
					const { rejected: _r, cleanAt: _c, sent: _s, idle: _i, ...rest } = b;
					// And a case waiting to be read again is read now.
					return rest.reread === undefined
						? rest
						: { ...rest, reread: { ...rest.reread, after: 0 } };
				}),
			);
			const account = await this.account();
			if (account !== undefined)
				await this.#deps.kv.set({
					[KEYS.account]: { ...account, checkedAt: 0 },
				});
		}).then(() => this.#then());
	}

	// --- a run ------------------------------------------------------------------------

	/** While sending: how many cases are left, without reading everything again. */
	async #progress(left: number): Promise<void> {
		const base = this.#said ?? (await this.#status("syncing"));
		await this.#say({ ...base, state: "syncing", left });
	}

	async #say(status: CloudStatus): Promise<void> {
		this.#said = status;
		await this.#deps.kv.set({ [KEYS.status]: status }).catch(() => undefined);
		this.#deps.onStatus?.(status);
	}

	/** The status with what the books and this run have to say. */
	async #status(
		state: CloudStatus["state"],
		more: Partial<CloudStatus> = {},
	): Promise<CloudStatus> {
		const before = await this.status();
		// The cases and the books as this run read them, while neither was
		// written since: a run with nothing to do reads each once.
		const read = this.#read;
		const fresh =
			read !== undefined &&
			read.books === this.#books.writes &&
			read.store === this.#stored;
		const cases = fresh ? read.cases : await this.#deps.store.listCases();
		const books = fresh ? read.all : await this.#books.all();
		const here = new Map(cases.map((c) => [c.id, c]));
		const problems = [...this.#problems];
		const notes = [...this.#notes];
		const notSent: Record<string, Record<string, string>> = {};
		const role = teamOf(await this.account());
		const mayAdd = (role?.permissions ?? []).includes(PERMISSION["mark.patch"]);
		let undecided = 0;
		const joins = { cases: 0, marks: 0 };
		for (const book of books.values()) {
			if (book.mode === "undecided" && here.has(book.caseId)) undecided++;
			// The team has a case with the id of one kept here: neither was
			// touched, and the user is told how to join them.
			const kept = here.get(book.caseId);
			if (book.theirs && book.mode !== "synced" && kept !== undefined) {
				const differ = differing(kept, book.theirs);
				if (book.mode === "undecided") {
					joins.cases++;
					joins.marks += differ;
				}
				// A note, not a problem: the user chose to keep it here.
				notes.push({
					caseId: book.caseId,
					title: kept.title,
					text: `“${kept.title}” is on this device only, and the team already has this case. Nothing of it was sent, and the team's was not taken. “Share with team” on the case joins the two: marks only here are sent, the team's other marks come here${differ === 0 ? "" : `, and where both differ the team's text is kept: ${differ === 1 ? "1 mark" : `${differ} marks`}`}.`,
				});
			}
			// Changes that cannot go as things are: said while they wait.
			if (
				book.idle !== undefined &&
				book.mode === "synced" &&
				kept !== undefined
			)
				for (const text of book.idle.texts)
					problems.push({ caseId: book.caseId, title: kept.title, text });
			// Comments past the most a case holds: kept here, unsent (DEC-046).
			const parked = book.parkedComments?.length ?? 0;
			if (parked > 0 && book.mode === "synced" && kept !== undefined)
				problems.push({
					caseId: book.caseId,
					title: kept.title,
					text: `${parked === 1 ? "A comment" : `${parked} comments`} written here ${parked === 1 ? "is" : "are"} kept back and not sent: the case holds the most comments it can (${MAX_CASE_COMMENTS.toLocaleString("en-US")}). ${parked === 1 ? "It goes" : "They go"} once comments are deleted.`,
				});
			// A case that could not be read or stored: said until it is.
			if (book.reread?.text !== undefined && book.mode === "synced")
				problems.push({
					caseId: book.caseId,
					...(kept === undefined && book.title === undefined
						? {}
						: { title: kept?.title ?? book.title ?? "" }),
					text: book.reread.text,
				});
			// Images added here that the team does not have, and why (DEC-058).
			if (book.mode === "synced" && kept !== undefined && role !== undefined) {
				const said = notSentOf(kept, book, mayAdd);
				if (Object.keys(said).length > 0) notSent[book.caseId] = said;
			}
			const [first, ...rest] = book.rejected ?? [];
			if (book.mode !== "synced" || first === undefined) continue;
			const title = kept?.title ?? book.title;
			problems.push({
				caseId: book.caseId,
				...(title === undefined ? {} : { title }),
				text:
					rest.length === 0
						? first.text
						: `${first.text} ${rest.length} more of its changes were not taken either.`,
			});
		}
		// The cases with changes the team does not have yet, and that can go:
		// what "Up to date" may not hide. Held back as `#push` holds them back.
		const team = teamOf(await this.account());
		const mayKey = team === undefined ? undefined : permissionsKey(team);
		let waiting = 0;
		for (const c of cases) {
			const book = books.get(c.id);
			if (book !== undefined && book.mode !== "synced") continue;
			if (book?.cleanAt === c.updatedAt) continue;
			// Cannot go as things are (said among the problems), or waits to be
			// read first, or has no mark yet (not sent until it has one).
			if (mayKey !== undefined && heldBack(book, c, mayKey)) continue;
			if (book?.reread !== undefined && blocks(book.reread)) continue;
			if (book?.shadow === undefined && c.marks.length === 0) continue;
			waiting++;
		}
		return {
			state,
			problems,
			...(notes.length > 0 ? { notes } : {}),
			...(Object.keys(notSent).length > 0 ? { notSent } : {}),
			undecided,
			waiting,
			...(joins.cases > 0 ? { joins } : {}),
			...(before.lastSyncedAt === undefined
				? {}
				: { lastSyncedAt: before.lastSyncedAt }),
			...more,
		};
	}

	async #run(): Promise<void> {
		const kv = this.#deps.kv;
		let account = await this.account();
		this.#me = account?.user.id;
		// Signed in and in no team (or none chosen): asked now and then whether
		// that changed; with one team, that team it is.
		if (
			account !== undefined &&
			!account.expired &&
			teamOf(account) === undefined
		) {
			try {
				account = await this.#refresh(this.#deps.api(account.server), account);
				const [only, ...more] = account.teams;
				if (only !== undefined && more.length === 0) {
					await this.#choose(account, only.id, false);
					account = await this.account();
					await this.#books.publishModes();
				}
			} catch (error) {
				if (!(error instanceof ApiFailure)) throw error;
				// Not reached, or refused: said by the next run that has a team.
			}
		}
		const chosen = teamOf(account);
		if (account === undefined || chosen === undefined) {
			await this.#say(
				account?.expired
					? {
							...OFF,
							state: "signed-out",
							text: "The sign-in ran out. Sign in again to go on syncing.",
						}
					: { ...OFF },
			);
			return;
		}
		this.#problems = [];
		this.#notes = [];
		if (account.expired) {
			await this.#say(
				await this.#status("signed-out", {
					text: "The sign-in ran out. Sign in again to go on syncing; nothing is lost meanwhile.",
				}),
			);
			return;
		}
		const api = this.#deps.api(account.server);
		try {
			// "Syncing" is said once there is something to send or to store: a
			// look that finds nothing new changes nothing the panel shows.
			account = await this.#refresh(api, account);
			const team = teamOf(account);
			if (team === undefined) {
				await this.#books.publishModes();
				await this.#say({
					...OFF,
					text: `You are no longer a member of “${chosen.name}”. Its cases stay on this device.`,
				});
				return;
			}
			const written = this.#books.writes;
			this.#read = undefined;
			await this.#readThreadsOnce(team);
			await this.#flush(api, team);
			// What the server has a record of here goes first, then what the
			// team changed comes. A case this device has no record of at the
			// server is never sent blind (the team may have it: from the
			// same file, or made by an answer that was lost): it waits for
			// the fetch, and for a read of its own where one is due.
			let more = await this.#push(api, team, false);
			// (A whole state read leaves cases to send that had a record before.)
			more = (await this.#pull(api, team)) || more;
			for (let pass = 0; more && pass < 2; pass++) {
				await this.#reread(api, team);
				more = await this.#push(api, team, true);
			}
			if (
				this.#books.writes !== written ||
				!(await this.#books.atTeamPublished())
			)
				await this.#books.publishModes();
			const done = await this.#status("synced", {
				lastSyncedAt: this.#now().toISOString(),
			});
			// Everything went that could; what the server did not take is said.
			await this.#say(
				done.problems.length > 0 ? { ...done, state: "problem" } : done,
			);
		} catch (error) {
			await this.#books.publishModes().catch(() => undefined);
			if (!(error instanceof ApiFailure)) {
				await this.#say(
					await this.#status("problem", {
						text: `Syncing failed: ${describe(error)}`,
					}),
				);
				return;
			}
			if (error.kind === "unauthorized") {
				const now = await this.account();
				if (now !== undefined) {
					// The deletes made while the sign-in was live: from now on the
					// panel says "from this browser", and a delete is not the
					// team's (DEC-041). Unknown: none counts as live.
					const live = await this.#deps.store
						.deletedCases()
						.then((all) => all.map((r) => r.id))
						.catch(() => []);
					await kv.set({
						[KEYS.account]: { ...now, expired: true, liveDeletes: live },
					});
				}
				await this.#say(
					await this.#status("signed-out", {
						text: "The sign-in ran out. Sign in again to go on syncing; nothing is lost meanwhile.",
					}),
				);
			} else if (error.kind === "offline")
				await this.#say(
					await this.#status("offline", {
						text: "The server cannot be reached. Your changes are kept and sent when it can.",
					}),
				);
			else if (error.status === 403 || error.status === 404) {
				// Not this team's member any more: asked for the teams next time.
				const now = await this.account();
				if (now !== undefined)
					await kv.set({ [KEYS.account]: { ...now, checkedAt: 0 } });
				await this.#say(
					await this.#status("problem", {
						text: `The server refused: ${error.message}`,
					}),
				);
			} else
				await this.#say(
					await this.#status("problem", {
						text: `The server has a problem (${error.message}). It is tried again.`,
					}),
				);
		}
	}

	/** The user's teams and what they may do there, asked for now and then. */
	async #refresh(
		api: Api,
		account: Account,
		freshMs = ACCOUNT_FRESH_MS,
	): Promise<Account> {
		const now = this.#now().getTime();
		if (now - account.checkedAt < freshMs) return account;
		const me = await api.me();
		const teams = me.teams ?? [];
		const { teamId, ...rest } = account;
		const next: Account = {
			...rest,
			user: { id: me.user.id, name: me.user.name, email: me.user.email },
			teams,
			checkedAt: now,
			...(teamId !== undefined && teams.some((t) => t.id === teamId)
				? { teamId }
				: {}),
		};
		if (next.teamId === undefined && teamId !== undefined) {
			// No member any more: what synced stays here, on this device.
			const books = [...(await this.#books.all()).values()].filter(
				(b) => b.mode === "synced",
			);
			await this.#books.put(...books.map(local));
		}
		await this.#deps.kv.set({ [KEYS.account]: next });
		return next;
	}

	// --- sending ----------------------------------------------------------------------

	/** Operations a run before this one wrote down and did not see confirmed. */
	async #flush(api: Api, team: Team): Promise<void> {
		const queue = (await this.#deps.kv.get(KEYS.queue)) as Queue | undefined;
		if (queue === undefined) return;
		const book = await this.#books.get(queue.caseId);
		if (queue.teamId === team.id && book !== undefined && queue.ops.length > 0)
			await this.#send(api, team, book, queue.ops);
		else await this.#deps.kv.remove(KEYS.queue);
	}

	/**
	 * Send what changed here. `all` false: only cases the server is known to
	 * have (a shadow), and none that has to be read first. Answers whether
	 * something is left for a pass after the fetch: a case without a
	 * shadow, or one to be read again now.
	 */
	async #push(api: Api, team: Team, all: boolean): Promise<boolean> {
		const cases = await this.#deps.store.listCases();
		const books = await this.#books.all();
		this.#read = {
			cases,
			all: new Map(books),
			books: this.#books.writes,
			store: this.#stored,
		};
		const here = new Set(cases.map((c) => c.id));
		const now = this.#now().getTime();
		const mayKey = permissionsKey(team);
		const todo: [Case, CaseBook][] = [];
		let more = false;
		for (const c of cases) {
			let book = books.get(c.id);
			if (book === undefined) {
				// Made since the team was chosen: it is the team's.
				book = { ...emptyBook(c.id, "synced", team.id), title: c.title };
				await this.#books.put(book);
			}
			if (book.mode !== "synced" || book.teamId !== team.id) continue;
			if (book.reread !== undefined) {
				more ||= book.reread.after <= now;
				// To be read from the server first: nothing of it is sent before.
				if (blocks(book.reread)) continue;
			}
			if (book.cleanAt === c.updatedAt) continue;
			// Nothing of it could go at the last look, and nothing changed since.
			if (heldBack(book, c, mayKey)) continue;
			// A case without marks is not sent until it has one (as the folder sync).
			if (book.shadow === undefined && c.marks.length === 0) continue;
			if (book.shadow === undefined && !all) {
				more = true;
				continue;
			}
			todo.push([c, book]);
		}
		const gone = [...books.values()].filter((b) => !here.has(b.caseId));
		let left = todo.length + gone.filter((b) => b.shadow).length;
		if (left > 0) await this.#progress(left);
		for (const [c, book] of todo) {
			more = (await this.#pushCase(api, team, c, book)) || more;
			if (--left > 0) await this.#progress(left);
		}
		// Deleted for the team only when the user deleted it: the store keeps
		// a record of every delete, written with the delete itself, so the
		// panel and an AI app's tool need not know of the sync and wait for
		// nothing. A case that is merely not in the store (its database was
		// lost, or made anew) has none, and is read from the server again: a
		// lost database must not empty the team.
		const records = new Map(
			(await this.#deps.store.deletedCases()).map((r) => [r.id, r.at]),
		);
		const settled: string[] = [];
		for (const book of gone) {
			const at = records.get(book.caseId);
			const theTeams =
				book.mode === "synced" &&
				book.teamId === team.id &&
				book.shadow !== undefined;
			// (Also of a book taken up again: its older records went when it
			// was taken up, so this is a delete made since, under a button
			// that says what it does. What was deleted while it did not sync
			// has no book any more and comes back, DEC-041.)
			if (theTeams && at !== undefined) {
				// At once, also for a case that waits to be read again.
				await this.#deleteCase(api, team, book);
				settled.push(book.caseId);
				continue;
			}
			if (book.reread !== undefined) {
				// Not here, and to be read: the read brings it.
				more ||= book.reread.after <= now;
				continue;
			}
			if (!theTeams) {
				await this.#books.remove(book.caseId);
				continue;
			}
			await this.#books.put({
				...emptyBook(book.caseId, "synced", team.id),
				...(book.title === undefined ? {} : { title: book.title }),
				reread: { why: "missing", tries: 0, after: 0 },
			});
			more = true;
		}
		// A record leaves when it was taken up, when this server has no book
		// that could need it, or after thirty days. (Not because the case
		// was here when this pass began: the store takes a record away
		// itself when a case is stored under its id, so one that is there
		// is of a case deleted since, and the next pass takes it up.) The book
		// as it is now: a case's first push in this pass gives it a shadow.
		for (const [id, at] of records) {
			const book = await this.#books.get(id);
			if (
				book === undefined ||
				book.mode !== "synced" ||
				book.shadow === undefined ||
				now - at > DELETED_KEPT_MS
			)
				settled.push(id);
		}
		if (settled.length > 0) await this.#deps.store.forgetDeleted(settled);
		return more;
	}

	/**
	 * Read the cases that have to be read whole (`CaseBook.reread`), each
	 * from the server by itself, and bring this device up to them. One that
	 * fails waits longer each time; what is wrong stays in its book, and so
	 * on the screen, until it works.
	 */
	async #reread(api: Api, team: Team): Promise<void> {
		const now = this.#now().getTime();
		const changed: string[] = [];
		for (const book of (await this.#books.all()).values()) {
			const mark = book.reread;
			if (
				mark === undefined ||
				book.mode !== "synced" ||
				book.teamId !== team.id ||
				mark.after > now
			)
				continue;
			let detail: Awaited<ReturnType<Api["getCase"]>>;
			try {
				detail = await api.getCase(team.id, book.caseId);
			} catch (error) {
				// A case larger than can be read here is that case's matter:
				// it waits, longer each time, and the run and the other cases
				// go on. Anything else is the run's (no network, no access).
				if (!(error instanceof ApiFailure) || error.code !== TOO_LARGE)
					throw error;
				await this.#readLater(
					book.caseId,
					mark.why,
					"The team's copy of this case is larger than can be read here",
				);
				continue;
			}
			if (detail === undefined) {
				await this.#notThere(book, team);
				continue;
			}
			const { shots, marks, comments, ...row } = detail;
			// A join nobody was told about (the server answered "duplicate"
			// to the new case): where a mark both have says something else
			// here, the team's text is not put in its place without a word.
			if (
				mark.why === "join" &&
				!mark.told &&
				(await this.#asksFirst(book, marks ?? []))
			)
				continue;
			try {
				// A book taken up again: what was deleted here while it did not
				// sync is forgotten, so that what the team still has of it
				// comes back with this read instead of being deleted there.
				const forgotten =
					mark.why === "resumed"
						? await this.#forgetDeletes(book)
						: new Set<string>();
				const applied = await this.#applyCase(
					api,
					team,
					book.caseId,
					{
						case: row,
						shots: shots ?? [],
						marks: marks ?? [],
						removedMarks: [],
						removedShots: [],
						// The whole thread, in the server's order (a server before
						// DEC-046 has none to say).
						...(comments === undefined ? {} : { comments }),
					},
					true,
					false,
				);
				if (applied.changed) changed.push(book.caseId);
				const back = (marks ?? []).filter((m) => forgotten.has(m.id)).length;
				if (back > 0)
					this.#notes.push({
						caseId: book.caseId,
						title: row.title,
						text: `${back === 1 ? "1 mark" : `${back} marks`} deleted while not syncing ${back === 1 ? "is" : "are"} back: the team still has ${back === 1 ? "it" : "them"}.`,
					});
				// Not deleted by anyone, and not here: said once, so a case
				// that is back is no surprise.
				if (mark.why === "missing" && applied.changed)
					this.#notes.push({
						caseId: book.caseId,
						title: row.title,
						text: `“${row.title}” was no longer on this device and was read from the team again.`,
					});
				if (applied.incomplete !== undefined) {
					await this.#readLater(book.caseId, "failed", applied.incomplete);
					continue;
				}
				const after = await this.#books.get(book.caseId);
				if (after?.reread !== undefined) {
					const { reread: _r, ...read } = after;
					await this.#books.put(read);
				}
			} catch (error) {
				if (error instanceof ApiFailure) throw error;
				await this.#readLater(
					book.caseId,
					mark.why,
					`What the team has of this case could not be stored here: ${describe(error)}`,
				);
			}
		}
		if (changed.length > 0) this.#deps.onChange?.(changed);
	}

	/**
	 * A case here is about to be joined with the team's, and the user was
	 * not told: when marks both have say something else here, the join
	 * stops. The case goes back to the question (it is "on this device
	 * only" until answered), which says the count as it does for a case
	 * that was kept back. Whether it stopped.
	 */
	async #asksFirst(
		book: CaseBook,
		marks: readonly WireMark[],
	): Promise<boolean> {
		const c = await this.#deps.store.getCase(book.caseId);
		if (c === undefined) return false;
		const theirs = Object.fromEntries(marks.map((m) => [m.id, theirMark(m)]));
		if (differing(c, theirs) === 0) return false;
		const { reread: _r, idle: _i, ...rest } = book;
		await this.#books.put({
			...rest,
			mode: "undecided",
			theirs,
			title: c.title,
		});
		return true;
	}

	/**
	 * Of a book taken up again: the marks and screenshots it knows and the
	 * case here no longer has are forgotten (their ids at the server are in
	 * the answer), so nothing is derived from their absence.
	 */
	async #forgetDeletes(book: CaseBook): Promise<Set<string>> {
		const forgotten = new Set<string>();
		const c = await this.#deps.store.getCase(book.caseId);
		if (c === undefined || book.shadow === undefined) return forgotten;
		const next = structuredClone(book);
		// First what the ids here stand for now (a screenshot's id is given
		// again after a delete).
		relink(c, next);
		const shadow = next.shadow as NonNullable<CaseBook["shadow"]>;
		const marks = new Set(c.marks.map((a) => a.id));
		const shots = new Set(c.shots.map((s) => s.id));
		for (const [id, wire] of Object.entries(next.marks))
			if (!marks.has(id)) delete next.marks[id];
			else forgotten.delete(wire);
		const stood = new Set(Object.values(next.marks));
		for (const wire of Object.keys(shadow.marks))
			if (!stood.has(wire)) {
				forgotten.add(wire);
				delete shadow.marks[wire];
			}
		for (const [id] of Object.entries(next.shots))
			if (!shots.has(id)) delete next.shots[id];
		const kept = new Set(Object.values(next.shots));
		for (const wire of Object.keys(shadow.shots))
			if (!kept.has(wire)) delete shadow.shots[wire];
		if (!same(next, book)) await this.#books.put(next);
		return forgotten;
	}

	/** A case that was to be read again is not at the server (any more). */
	async #notThere(book: CaseBook, team: Team): Promise<void> {
		const { reread, theirs: _t, shadow: _s, cleanAt: _c, ...rest } = book;
		// It was to be joined with the team's, and the team's is gone: sent
		// as any new case.
		if (reread?.why === "join") {
			await this.#books.put(rest);
			return;
		}
		if (await this.#deps.store.getCase(book.caseId)) {
			await this.#books.put(local(rest));
			this.#problems.push({
				caseId: book.caseId,
				...(book.title === undefined ? {} : { title: book.title }),
				text: `${book.title === undefined ? "A case" : `“${book.title}”`} is no longer in “${team.name}”. It stays on this device.`,
			});
		} else await this.#books.remove(book.caseId);
	}

	/**
	 * Mark a case to be read from the server again, whole: now, or, with
	 * something that went `wrong`, after a wait that grows with each time.
	 */
	async #readLater(
		caseId: string,
		why: Reread["why"],
		wrong?: string,
	): Promise<void> {
		const book = await this.#books.get(caseId);
		if (book === undefined) return;
		const tries = wrong === undefined ? 0 : (book.reread?.tries ?? 0) + 1;
		const wait =
			tries === 0
				? 0
				: (REREAD_WAIT_MS[Math.min(tries, REREAD_WAIT_MS.length) - 1] ?? 0);
		// What must be read before anything is sent stays that.
		const still =
			book.reread !== undefined && blocks(book.reread) ? book.reread.why : why;
		await this.#books.put({
			...book,
			reread: {
				why: still,
				// A join the user was told about stays one: not asked again.
				...(still === "join" && book.reread?.told ? { told: true } : {}),
				tries,
				after: this.#now().getTime() + wait,
				...(wrong === undefined
					? {}
					: {
							text: `${wrong.replace(/[.\s]+$/, "")}. It is read again later.`,
						}),
			},
		});
	}

	/** Upload an image the team does not have; `again`: whatever was known. */
	async #upload(
		api: Api,
		team: Team,
		sha: string,
		image: Blob,
		again = false,
	): Promise<void> {
		if (!again) {
			if (this.#have.has(sha)) return;
			if (await api.hasBlob(team.id, sha)) {
				this.#have.add(sha);
				return;
			}
		}
		await api.putBlob(team.id, sha, image);
		this.#have.add(sha);
	}

	/** Send one case's changes; whether it now waits to be read from the server. */
	async #pushCase(
		api: Api,
		team: Team,
		c: Case,
		start: CaseBook,
	): Promise<boolean> {
		const store = this.#deps.store;
		const may = new Set(team.permissions ?? []);
		const mayKey = permissionsKey(team);
		/** What there is to say of this case after this look. */
		const said: string[] = [];
		/** Nothing goes: remembered, so the next run passes the case by. */
		const rest = async (book: CaseBook): Promise<false> => {
			await this.#books.put({
				...book,
				idle: { at: c.updatedAt, may: mayKey, texts: said },
			});
			return false;
		};
		let given = start;
		// A case the server has no record of here goes alone first, before
		// any of its images is read. When the team has a case of that id
		// already (the same file on two devices, or this device's own, made
		// by a request whose answer was lost), nothing else is sent: every
		// mark would be made a second time for the whole team. The team's
		// copy is read, and the two are joined.
		if (given.shadow === undefined) {
			const create: Op = {
				opId: this.#newId("o"),
				type: "case.create",
				case: newCaseOf(c),
				// Made by an AI app's call through this browser: the app
				// (DEC-046); shared by hand, nobody's but the person's.
				...(c.createdVia === undefined ? {} : { via: appOut(c.createdVia) }),
			};
			if (
				may.has(PERMISSION["case.create"]) &&
				!(given.rejected ?? []).some((r) => r.key === opKey(create))
			) {
				const book = structuredClone(given);
				book.title = c.title;
				delete book.idle;
				const alone = await this.#send(api, team, book, [create]);
				if (alone.taken) {
					await this.#readLater(c.id, "join");
					return true;
				}
				// The server did not take the case: said (the book has why),
				// and not looked at again until something changes.
				if (book.shadow === undefined) return rest(book);
				given = book;
			}
		}
		// Which operations there are, and which of them can go at all: found
		// out on a copy of the book, before any image is read. What the
		// server refused before, and what the role does not allow, needs no
		// image hashed, asked for or uploaded.
		const placeholder: ImageRef = { sha256: "", width: 1, height: 1, bytes: 1 };
		const dry = structuredClone(given);
		let n = 0;
		const first = deriveOps(
			c,
			dry,
			() => placeholder,
			() => `dry-${n++}`,
			this.#me,
		);
		const heldBefore = new Set((given.rejected ?? []).map((r) => r.key));
		const shotOf = reverse(dry.shots);
		const markOf = reverse(dry.marks);
		const wanted = new Set<string>();
		// Without its case at the server nothing of it can go, so nothing is read.
		const stuck =
			given.shadow === undefined &&
			!first.ops.some(
				(op) =>
					op.type === "case.create" &&
					may.has(PERMISSION[op.type]) &&
					!heldBefore.has(opKey(op)),
			);
		for (const op of stuck ? [] : first.ops) {
			if (!may.has(PERMISSION[op.type]) || heldBefore.has(opKey(op))) continue;
			if (op.type === "shot.create") {
				const id = shotOf.get(op.shot.id);
				const shot = c.shots.find((s) => s.id === id);
				if (shot !== undefined) wanted.add(shot.image);
			} else if (op.type === "mark.create") {
				const id = markOf.get(op.mark.id);
				const mark = c.marks.find((a) => a.id === id);
				if (mark !== undefined) wanted.add(mark.crop);
			}
			// The images a person added that go with it (DEC-058), by their ids.
			for (const path of addedImagesOf(op)) wanted.add(path);
		}
		const refs = new Map<string, ImageRef>();
		const blobs = new Map<string, Blob>();
		/** Images the server refused, as they are said, and their paths. */
		const unsent: Rejected[] = [];
		const refusedPaths = new Set<string>();
		// A screenshot or crop needs mark:create; an image added to a mark
		// mark:update (the blob route takes either, DEC-058).
		const mayUpload =
			may.has(PERMISSION["mark.create"]) || may.has(PERMISSION["mark.patch"]);
		for (const path of wanted) {
			const stored = await store.getImage(c.id, path);
			if (stored === undefined) continue;
			const sha = await this.#hash(stored.blob);
			refs.set(path, {
				sha256: sha,
				width: stored.width,
				height: stored.height,
				bytes: stored.blob.size,
			});
			blobs.set(sha, stored.blob);
			if (!mayUpload) continue;
			// An image the server did not take (the team's storage is full, it
			// is too large): its mark is not shared, that is said, and it is
			// not uploaded again at every run. "Sync now" tries once more.
			const before = (given.rejected ?? []).find(
				(r) => r.key === `blob:${sha}`,
			);
			if (before !== undefined) {
				refs.delete(path);
				refusedPaths.add(path);
				unsent.push(before);
				continue;
			}
			try {
				await this.#upload(api, team, sha, stored.blob);
			} catch (error) {
				if (!(error instanceof ApiFailure) || error.kind !== "refused")
					throw error;
				// Not this team's member any more: the run's to say.
				if (error.status === 403 || error.status === 404) throw error;
				refs.delete(path);
				refusedPaths.add(path);
				const added = addedTo(c, path);
				const why = whyOf(error.code ?? "", error.message);
				unsent.push({
					key: `blob:${sha}`,
					...(added === undefined
						? {}
						: { images: [path.slice("images/".length, -".webp".length)], why }),
					// An added image's mark is shared; only that picture is not.
					text:
						added === undefined
							? `An image was not taken, so its mark is not shared: ${whyOf(error.code ?? "", error.message)}.`
							: `An image added to mark ${added} was not taken, so the team does not see it: ${whyOf(error.code ?? "", error.message)}.`,
				});
			}
		}
		const book = structuredClone(given);
		book.title = c.title;
		delete book.idle;
		// An image that was not read stands for an operation that does not go.
		const { ops, missing } = deriveOps(
			c,
			book,
			(path) => refs.get(path) ?? (wanted.has(path) ? undefined : placeholder),
			this.#newId,
			this.#me,
		);
		// What the server refused before is not sent again as it was.
		const keys = new Set(ops.map(opKey));
		const refused = [
			...(book.rejected ?? []).filter((r) => keys.has(r.key)),
			...unsent,
		];
		const held = new Set(refused.map((r) => r.key));
		if (refused.length > 0) book.rejected = refused;
		else delete book.rejected;
		// An image the server refused is not one that is missing here. An
		// added image's mark is shared without it; a crop's or a screenshot's
		// is not.
		const gone = missing.filter((path) => !refusedPaths.has(path));
		const absentPictures = gone.filter(
			(path) => addedTo(c, path) !== undefined,
		);
		const absent = gone.length - absentPictures.length;
		const forbidden = ops.filter((op) => !may.has(PERMISSION[op.type]));
		if (forbidden.length > 0)
			said.push(
				`Your role in “${team.name}” does not allow ${forbidden.length === 1 ? "a change" : `${forbidden.length} changes`} you made here; ${forbidden.length === 1 ? "it stays" : "they stay"} on this device.`,
			);
		if (absent > 0)
			said.push(
				`${absent === 1 ? "An image" : `${absent} images`} of the case ${absent === 1 ? "is" : "are"} missing on this device, so ${absent === 1 ? "its mark is" : "their marks are"} not shared.`,
			);
		for (const path of absentPictures)
			said.push(
				`An image added to mark ${addedTo(c, path)} is missing on this device, so the team does not see it.`,
			);
		let sending = ops.filter(
			(op) => may.has(PERMISSION[op.type]) && !held.has(opKey(op)),
		);
		// Without its case at the server, nothing of it can go.
		if (
			book.shadow === undefined &&
			!sending.some((op) => op.type === "case.create")
		)
			sending = [];
		// So many refusals that not all of them can be kept: sending more
		// would send some of them again, in turns, for ever.
		if (refused.length >= MAX_REJECTED && sending.length > 0) {
			said.push(
				`${MAX_REJECTED} changes to this case were not taken, so nothing more of it is sent. Sync now tries again.`,
			);
			sending = [];
		}
		if (sending.length === 0) {
			if (ops.length === 0 && missing.length === 0) {
				book.cleanAt = c.updatedAt;
				delete book.sent;
				await this.#books.put(book);
				return false;
			}
			return rest(book);
		}
		for (const text of said)
			this.#problems.push({ caseId: c.id, title: c.title, text });
		// The same changes as last time, though the server took them: the two
		// do not agree on how something is written, and sending it again
		// changes nothing. Said, and left until the case changes otherwise.
		const sent = sending.map(opKey).sort().join(" ");
		const times = book.sent?.keys === sent ? book.sent.times + 1 : 1;
		book.sent = { keys: sent, times };
		if (times > MAX_SAME_SENDS) {
			this.#problems.length -= said.length;
			said.push(
				"A change keeps coming back from the server as it was before, so it is not sent again. Sync now tries once more.",
			);
			return rest(book);
		}
		const done = await this.#send(api, team, book, sending, blobs);
		// Sent whole, with nothing left out: until the case changes, it is done.
		if (
			done.clean &&
			sending.length === ops.length &&
			missing.length === 0 &&
			!done.renumbered
		) {
			const now = await this.#books.get(c.id);
			if (now !== undefined)
				await this.#books.put({ ...now, cleanAt: c.updatedAt });
		}
		return false;
	}

	/** Operations in requests the server takes: not too many, not too large. */
	#batches(ops: readonly Op[]): Op[][] {
		const batches: Op[][] = [];
		let batch: Op[] = [];
		let size = 0;
		for (const op of ops) {
			const length = JSON.stringify(op).length;
			if (
				batch.length > 0 &&
				(batch.length >= MAX_OPS || size + length > MAX_OPS_BYTES)
			) {
				batches.push(batch);
				batch = [];
				size = 0;
			}
			batch.push(op);
			size += length;
		}
		if (batch.length > 0) batches.push(batch);
		return batches;
	}

	/** One request; a request the server takes none of is sent again piece by piece. */
	async #post(api: Api, team: Team, batch: Op[]): Promise<OpResult[]> {
		try {
			const answer = await api.ops(team.id, batch);
			const results = new Map(
				(answer.results ?? []).map((r) => [r.opId, r] as const),
			);
			return batch.map(
				(op): OpResult =>
					results.get(op.opId) ?? {
						opId: op.opId,
						status: "rejected",
						error: {
							code: "invalid",
							message: "The server gave no answer for it",
						},
					},
			);
		} catch (error) {
			if (
				!(error instanceof ApiFailure) ||
				error.kind !== "refused" ||
				// A no to what was sent (not to who sent it): found out one
				// operation at a time, and that one is said and left out.
				![400, 409, 413, 422].includes(error.status ?? 0)
			)
				throw error;
			const [only] = batch;
			if (batch.length === 1 && only !== undefined)
				return [
					{
						opId: only.opId,
						status: "rejected",
						error: { code: "invalid", message: error.message },
					},
				];
			const results: OpResult[] = [];
			for (const op of batch)
				results.push(...(await this.#post(api, team, [op])));
			return results;
		}
	}

	/**
	 * Send operations of one case, written down first, and make the book
	 * what the server now has. `clean`: every one was taken.
	 */
	async #send(
		api: Api,
		team: Team,
		book: CaseBook,
		ops: Op[],
		blobs: ReadonlyMap<string, Blob> = new Map(),
	): Promise<{ clean: boolean; renumbered: boolean; taken: boolean }> {
		const kv = this.#deps.kv;
		let left = [...ops];
		let clean = true;
		/** A new case's id is a case of the team's already: not made, not confirmed. */
		let taken = false;
		/** The server's ids of new marks whose number it changed. */
		const numbers = new Map<string, number>();
		const write = async () => {
			this.#books.writes++;
			const queue: Queue = { caseId: book.caseId, teamId: team.id, ops: left };
			// In one transaction: operations written down without the ids they
			// name in the book would be sent, and their marks then taken for
			// unknown ones, deleted and made again.
			await kv.set({ [KEYS.queue]: queue, [`${BOOK}${book.caseId}`]: book });
		};
		await write();
		for (const batch of this.#batches(ops)) {
			const results = await this.#post(api, team, batch);
			// An image is not there after all: it is uploaded, and what the
			// server refused of this request (the operation that names it, and
			// those that needed that one) goes once more; a screenshot first,
			// then the crops of the marks on it.
			const sent = new Set<string>();
			for (let round = 0; round < 3; round++) {
				let uploaded = false;
				for (const [i, op] of batch.entries()) {
					if (
						results[i]?.status !== "rejected" ||
						results[i]?.error?.code !== "blob_missing"
					)
						continue;
					// Every image the operation names: a screenshot, a crop, the
					// images added to a mark (DEC-058).
					for (const ref of picturesOf(op)) {
						const blob = blobs.get(ref.sha256);
						if (blob === undefined || sent.has(ref.sha256)) continue;
						await this.#upload(api, team, ref.sha256, blob, true);
						sent.add(ref.sha256);
						uploaded = true;
					}
				}
				if (!uploaded) break;
				const refused = batch.filter(
					(_, i) => results[i]?.status === "rejected",
				);
				const second = await this.#post(api, team, refused);
				for (const [i, op] of batch.entries()) {
					const at = refused.indexOf(op);
					if (at >= 0) results[i] = second[at] as OpResult;
				}
			}
			// An image that was not there, where it could not be sent along
			// (operations taken up from the queue have none at hand): that
			// refusal, and what was refused with it for needing its
			// screenshot or mark, is not remembered. The next look at the
			// case has the images.
			const imageless = results.some(
				(r) => r?.status === "rejected" && r.error?.code === "blob_missing",
			);
			for (const [i, op] of batch.entries()) {
				const result = results[i] as OpResult;
				if (op.type === "case.create" && result.status === "duplicate") {
					taken = true;
					clean = false;
					continue;
				}
				const code = result.error?.code ?? "invalid";
				const gone =
					code === "not_found" &&
					(op.type === "mark.delete" || op.type === "case.delete");
				if (
					result.status === "applied" ||
					result.status === "duplicate" ||
					gone
				) {
					applyOp(book, op, result.number);
					if (
						op.type === "mark.create" &&
						typeof result.number === "number" &&
						result.number !== op.mark.number
					)
						numbers.set(op.mark.id, result.number);
				} else if (
					imageless &&
					(code === "blob_missing" ||
						code === "invalid" ||
						code === "not_found")
				) {
					clean = false;
				} else {
					// Refused, or an answer this build does not know: not done.
					clean = false;
					const images = addedImagesOf(op).map((path) =>
						path.slice("images/".length, -".webp".length),
					);
					book.rejected = [
						...(book.rejected ?? []).filter((r) => r.key !== opKey(op)),
						{
							key: opKey(op),
							text: sentence(op, code, result.error?.message ?? ""),
							// Its images are not sent, and say why (DEC-058); tried
							// again once the team's mark changes its images.
							...(images.length === 0
								? {}
								: {
										images,
										why:
											code === "limit"
												? "the mark already holds six images"
												: whyOf(code, result.error?.message ?? ""),
										...(op.type === "mark.patch" ? { mark: op.markId } : {}),
									}),
						},
					].slice(-MAX_REJECTED);
				}
			}
			left = left.filter((op) => !batch.includes(op));
			await write();
		}
		await kv.remove(KEYS.queue);
		const renumbered = numbers.size > 0;
		if (renumbered) await this.#renumber(book, numbers);
		await this.#books.put(book);
		return { clean, renumbered, taken };
	}

	/** The server gave new marks other numbers: the marks here take them. */
	async #renumber(
		book: CaseBook,
		numbers: ReadonlyMap<string, number>,
	): Promise<void> {
		const store = this.#deps.store;
		const here = reverse(book.marks);
		const to = new Map<string, number>();
		for (const [wire, number] of numbers) {
			const id = here.get(wire);
			if (id !== undefined) to.set(id, number);
		}
		const crops = new Map<string, StoredImage>();
		for (let attempt = 0; attempt < 20; attempt++) {
			const next = structuredClone(book);
			try {
				this.#stored++;
				await store.updateCase(book.caseId, (current) => {
					if (current === undefined) throw NOTHING;
					const out = {
						images: new Map<string, unknown>(),
						deleteImages: new Set<string>(),
					};
					const value = renumber(current, next, to, crops, out);
					if (value === current) throw NOTHING;
					return {
						// The app's change, if one waits, is still the app's.
						value: validateCase(
							carryVia(current, {
								...value,
								updatedAt: this.#now().toISOString(),
							}),
						),
						images: out.images as Map<string, StoredImage>,
						deleteImages: [...out.deleteImages],
					};
				});
			} catch (error) {
				if (error === NOTHING) return;
				if (!(error instanceof NeedsImage) || error.local === undefined)
					throw error;
				const image = await store.getImage(book.caseId, error.local);
				if (image === undefined)
					throw new Error(`the image ${error.local} is missing`);
				crops.set(error.local, image);
				continue;
			}
			book.marks = next.marks;
			this.#deps.onChange?.([book.caseId]);
			return;
		}
	}

	/** A case deleted here is deleted for the team. */
	async #deleteCase(api: Api, team: Team, book: CaseBook): Promise<void> {
		const may = (team.permissions ?? []).includes(PERMISSION["case.delete"]);
		const op: Op = {
			opId: this.#newId("o"),
			type: "case.delete",
			caseId: book.caseId,
		};
		const { rejected: _r, ...plain } = book;
		const done = may
			? await this.#send(api, team, plain, [op])
			: { clean: false };
		await this.#books.remove(book.caseId);
		if (done.clean) return;
		// Not the user's to delete for the team: it comes back from there.
		await this.#deps.kv.set({ [KEYS.whole]: true });
		this.#problems.push({
			caseId: book.caseId,
			...(book.title === undefined ? {} : { title: book.title }),
			text: `${book.title === undefined ? "A case" : `“${book.title}”`} could not be deleted for “${team.name}”${may ? "" : ": your role there does not allow it"}. It is back on this device.`,
		});
	}

	// --- fetching ---------------------------------------------------------------------

	/**
	 * A book written by a build before DEC-046 (0.3.0) holds no thread: that
	 * build read past the team's comments and closings without keeping them.
	 * Its case is read whole once, which brings them; what is here goes as
	 * usual meanwhile, and nothing deleted here is forgotten.
	 */
	async #readThreadsOnce(team: Team): Promise<void> {
		// Books from before are this database's from an earlier build: looked
		// for once per start, not at every run (a run reads the books once).
		// Marked done only once the books are written: a read or a write
		// that fails is tried again at the next run.
		if (this.#threadsChecked === team.id) return;
		const before = [...(await this.#books.all()).values()].filter(
			(b) =>
				b.mode === "synced" &&
				b.teamId === team.id &&
				b.shadow !== undefined &&
				b.shadow.comments === undefined &&
				b.reread === undefined,
		);
		if (before.length > 0)
			await this.#books.put(
				...before.map((b) => ({
					...b,
					reread: { why: "failed" as const, tries: 0, after: 0 },
				})),
			);
		this.#threadsChecked = team.id;
	}

	/** Fetch what the team changed; whether it was the team's whole state. */
	async #pull(api: Api, team: Team): Promise<boolean> {
		const kv = this.#deps.kv;
		const stored = (await kv.get(KEYS.cursor)) as number | undefined;
		const again = (await kv.get(KEYS.whole)) === true;
		let since = again || typeof stored !== "number" ? undefined : stored;
		let whole = since === undefined;
		let reset = false;
		let cases = new Map<string, WireCase>();
		let shots = new Map<string, WireShot>();
		let marks = new Map<string, WireMark>();
		let comments = new Map<string, WireComment>();
		let removed = new Map<string, { type: string; caseId?: string }>();
		// Things an answer: the server's own number, and fewer once an answer
		// was larger than one may be.
		let limit: number | undefined;
		for (let page = 0; page < 100_000; page++) {
			let changes: Changes;
			try {
				changes = await api.changes(team.id, since, limit);
			} catch (error) {
				if (
					!(error instanceof ApiFailure) ||
					error.code !== TOO_LARGE ||
					limit !== undefined
				)
					throw error;
				limit = SMALL_PAGE;
				continue;
			}
			if (changes.reset) {
				// The server's history is another one: this is its whole state.
				whole = true;
				reset = true;
				cases = new Map();
				shots = new Map();
				marks = new Map();
				comments = new Map();
				removed = new Map();
			}
			// A later page's word on a thing is the newer one.
			for (const c of changes.cases ?? []) {
				cases.set(c.id, c);
				removed.delete(`case ${c.id}`);
			}
			for (const s of changes.shots ?? []) {
				shots.set(s.id, s);
				removed.delete(`shot ${s.id}`);
			}
			for (const m of changes.marks ?? []) {
				marks.set(m.id, m);
				removed.delete(`mark ${m.id}`);
			}
			// The thread (DEC-046); a server before it sends none.
			for (const k of changes.comments ?? []) {
				comments.set(k.id, k);
				removed.delete(`comment ${k.id}`);
			}
			for (const r of changes.removed ?? []) {
				removed.set(`${r.type} ${r.id}`, {
					type: r.type,
					...(r.caseId === undefined ? {} : { caseId: r.caseId }),
				});
				if (r.type === "case") cases.delete(r.id);
				if (r.type === "shot") shots.delete(r.id);
				if (r.type === "mark") marks.delete(r.id);
				if (r.type === "comment") comments.delete(r.id);
			}
			since = changes.cursor;
			if (!changes.more) break;
		}
		if (
			cases.size + shots.size + marks.size + comments.size + removed.size ===
				0 &&
			!whole
		) {
			if (since !== stored) await kv.set({ [KEYS.cursor]: since });
			return false;
		}

		await this.#say(await this.#status("syncing"));
		const changed = new Set<string>();
		const books = await this.#books.all();
		const groups = new Map<string, Incoming>();
		const group = (caseId: string): Incoming => {
			let g = groups.get(caseId);
			if (g === undefined) {
				g = {
					shots: [],
					marks: [],
					removedMarks: [],
					removedShots: [],
					...(whole ? { comments: [] } : {}),
				};
				groups.set(caseId, g);
			}
			return g;
		};
		for (const c of cases.values()) group(c.id).case = c;
		for (const s of shots.values()) group(s.caseId).shots.push(s);
		for (const m of marks.values()) group(m.caseId).marks.push(m);
		for (const k of comments.values()) {
			const g = group(k.caseId);
			g.comments = [...(g.comments ?? []), k];
		}
		/** A comment's case, by the books (a deleted one comes without it, DEC-046). */
		const caseOfComment = (id: string): string | undefined => {
			for (const book of books.values())
				if (book.shadow?.comments?.[id] !== undefined) return book.caseId;
			return undefined;
		};
		for (const [key, r] of removed) {
			const id = key.slice(key.indexOf(" ") + 1);
			if (r.type === "case") {
				groups.delete(id);
				// Deleted for the team: it goes here too.
				const book = books.get(id);
				if (book?.mode === "synced" && book.teamId === team.id) {
					this.#stored++;
					// Gone because the team deleted it: no delete of the user's.
					await this.#deps.store.deleteCase(id, true);
					await this.#books.remove(id);
					books.delete(id);
					changed.add(id);
				}
			} else if (r.type === "comment") {
				// No case named (DEC-046): found by the comment's id, where a
				// book knows it; one no book knows was never here.
				const caseId = r.caseId ?? caseOfComment(id);
				if (caseId !== undefined) {
					const g = group(caseId);
					g.removedComments = [...(g.removedComments ?? []), id];
				}
			} else if (r.caseId !== undefined) {
				// A kind of thing this build does not know is left alone.
				if (r.type === "mark") group(r.caseId).removedMarks.push(id);
				if (r.type === "shot") group(r.caseId).removedShots.push(id);
			}
		}
		for (const [caseId, incoming] of groups) {
			try {
				const applied = await this.#applyCase(
					api,
					team,
					caseId,
					incoming,
					whole,
					reset,
				);
				if (applied.changed) changed.add(caseId);
				if (applied.incomplete !== undefined)
					await this.#readLater(caseId, "failed", applied.incomplete);
			} catch (error) {
				if (error instanceof ApiFailure) throw error;
				// The cursor goes on, the case does not: it is marked to be read
				// again by itself, and that stays said until it is stored.
				if ((await this.#books.get(caseId)) === undefined)
					await this.#books.put({
						...emptyBook(caseId, "synced", team.id),
						...(incoming.case?.title ? { title: incoming.case.title } : {}),
					});
				await this.#readLater(
					caseId,
					"failed",
					`What the team changed could not be stored here: ${describe(error)}`,
				);
			}
		}
		if (whole) {
			// What the server does not name it does not have (any more).
			for (const book of (await this.#books.all()).values()) {
				if (
					book.mode !== "synced" ||
					book.teamId !== team.id ||
					book.shadow === undefined ||
					cases.has(book.caseId)
				)
					continue;
				const { shadow: _s, cleanAt: _c, ...rest } = book;
				if (reset) {
					// The server lost it: it is sent again.
					await this.#books.put(rest);
					continue;
				}
				await this.#books.put(local(rest));
				this.#problems.push({
					caseId: book.caseId,
					...(book.title === undefined ? {} : { title: book.title }),
					text: `${book.title === undefined ? "A case" : `“${book.title}”`} is no longer in “${team.name}”. It stays on this device.`,
				});
			}
		}
		await kv.set({ [KEYS.cursor]: since });
		if (again) await kv.remove(KEYS.whole);
		if (changed.size > 0) this.#deps.onChange?.([...changed]);
		return whole;
	}

	/**
	 * Fetch images of the team, a few at a time. An image is taken only when
	 * it is the one asked for: its SHA-256 is the name it was asked by, it is
	 * a WebP, and it is no larger than the API holds. Anything else (also an
	 * image the server does not have) is not stored; its SHA-256 is in the
	 * answer, for the caller to leave out what needs it and to say so.
	 */
	async #fetch(
		api: Api,
		team: Team,
		refs: readonly ImageRef[],
		into: Map<string, StoredImage>,
	): Promise<Set<string>> {
		const refused = new Set<string>();
		const todo = refs.filter((r) => !into.has(r.sha256));
		let next = 0;
		const work = async () => {
			for (let ref = todo[next++]; ref !== undefined; ref = todo[next++]) {
				if (into.has(ref.sha256) || refused.has(ref.sha256)) continue;
				let blob: Blob;
				try {
					blob = await api.getBlob(team.id, ref.sha256);
				} catch (error) {
					// Not there, or larger than an image may be: this image's
					// matter. Anything else is the run's (no network, no access).
					if (
						error instanceof ApiFailure &&
						(error.code === TOO_LARGE ||
							(error.kind === "refused" && error.status === 404))
					) {
						refused.add(ref.sha256);
						continue;
					}
					throw error;
				}
				if (
					blob.size > MAX_IMAGE_BYTES ||
					blob.type !== "image/webp" ||
					(await this.#hash(blob)) !== ref.sha256
				) {
					refused.add(ref.sha256);
					continue;
				}
				into.set(ref.sha256, {
					blob,
					width: ref.width,
					height: ref.height,
				});
				this.#have.add(ref.sha256);
			}
		};
		await Promise.all(Array.from({ length: FETCHES }, work));
		return refused;
	}

	/** Bring one case here up to what came; whether the case here changed. */
	async #applyCase(
		api: Api,
		team: Team,
		caseId: string,
		came: Incoming,
		whole: boolean,
		lost: boolean,
	): Promise<{ changed: boolean; incomplete: string | undefined }> {
		let incoming = came;
		const store = this.#deps.store;
		const stored = await this.#books.get(caseId);
		// Ids written down by a run that stopped before it stored their case
		// count only for the marks they were meant for.
		const given =
			stored?.announced === undefined ? stored : structuredClone(stored);
		if (given?.announced !== undefined) {
			// And a mark that was to move to such an id and is still under
			// its old one is put together with its mark of the server's.
			const here = await store.getCase(caseId);
			if (here === undefined) settleAnnounced(here, given);
			else relink(here, given);
		}
		let incomplete: string | undefined;
		// A case here that is kept on this device (the user said so, or it is
		// another server's) is not the team's because the team names its id:
		// an id is no secret (it is in every export, and every AI app and
		// server the case was shared with has it). Nothing is merged, nothing
		// is sent; it is said, and sharing the case joins the two.
		// The same for a case that is to be the team's and has no record
		// there yet (imported, or made, with the id of a case the team has),
		// when the fetch brings the team's copy: joined at once when nothing
		// differs, asked first when the join would replace text here.
		if (
			given !== undefined &&
			given.mode === "synced" &&
			given.shadow === undefined &&
			!given.reread?.told &&
			came.case !== undefined &&
			(await this.#asksFirst(given, came.marks))
		)
			return { changed: false, incomplete: undefined };
		if (given !== undefined && given.mode !== "synced") {
			const kept = await store.getCase(caseId);
			if (kept !== undefined) {
				// The team's marks as they are now, to say what a join replaces.
				const theirs = { ...given.theirs };
				for (const id of came.removedMarks) delete theirs[id];
				for (const m of came.marks) theirs[m.id] = theirMark(m);
				if (!same(theirs, given.theirs))
					await this.#books.put({ ...given, theirs, title: kept.title });
				return { changed: false, incomplete: undefined };
			}
		}
		const fetched = new Map<string, StoredImage>();
		const crops = new Map<string, StoredImage>();
		const options = {
			teamId: team.id,
			whole,
			lost,
			now: this.#now().toISOString(),
			...(this.#me === undefined ? {} : { me: this.#me }),
		};
		// The images of what is new, before the store is touched.
		const knownShots = new Set(Object.values(given?.shots ?? {}));
		const knownMarks = new Set(Object.values(given?.marks ?? {}));
		/** Images added to marks that are not here yet (DEC-058): not in the shadow. */
		const newImages = (m: WireMark) => {
			const had = new Set(
				(given?.shadow?.marks[m.id]?.content.images ?? []).map((x) => x.id),
			);
			return (m.images ?? []).filter((x) => !had.has(x.id));
		};
		const refused = await this.#fetch(
			api,
			team,
			[
				...incoming.shots
					.filter((s) => !knownShots.has(s.id))
					.map((s) => s.image),
				...incoming.marks
					.filter((m) => !knownMarks.has(m.id))
					.map((m) => m.crop),
				...incoming.marks.flatMap((m) => newImages(m).map((x) => x.image)),
			],
			fetched,
		);
		// A new mark or screenshot whose image was not the image named is
		// left out (with the marks on such a screenshot), and that is said;
		// the rest of the case, and of the run, goes on.
		if (refused.size > 0) {
			const without = new Set(
				incoming.shots
					.filter((s) => !knownShots.has(s.id) && refused.has(s.image.sha256))
					.map((s) => s.id),
			);
			const marks = incoming.marks.filter(
				(m) =>
					knownMarks.has(m.id) ||
					(!refused.has(m.crop.sha256) && !without.has(m.shotId)),
			);
			const left = incoming.marks.length - marks.length;
			// An added image whose picture did not come is left out of its
			// mark this time, as if the server did not have it yet: nothing
			// here is removed for it, and it comes with a later read.
			const pictures = (m: WireMark): WireMark =>
				m.images === undefined
					? m
					: {
							...m,
							images: m.images.filter((x) => !refused.has(x.image.sha256)),
						};
			const count = (list: readonly WireMark[]) =>
				list.reduce((n, m) => n + (m.images?.length ?? 0), 0);
			const pictureless = count(marks) - count(marks.map(pictures));
			incoming = {
				...incoming,
				shots: incoming.shots.filter((s) => !without.has(s.id)),
				marks: marks.map(pictures),
			};
			// Said until a read of the case brings them (it is marked for one).
			const what = [
				left > 0 ? (left === 1 ? "A mark" : `${left} marks`) : "",
				pictureless > 0
					? left > 0
						? `${pictureless} added image${pictureless === 1 ? "" : "s"}`
						: pictureless === 1
							? "An image added to a mark"
							: `${pictureless} images added to marks`
					: "",
			]
				.filter(Boolean)
				.join(" and ");
			const many = left + pictureless > 1;
			incomplete = `${what} of the team ${many ? "are" : "is"} not shown here: ${refused.size === 1 ? "an image" : "images"} the server sent ${refused.size === 1 ? "is" : "are"} not the image named (missing, not a WebP image, too large, or other content).`;
		}
		// A mark an AI app added at the server has its whole screenshot as its
		// crop: a crop of it is cut here, for showing it. Only here: the
		// server's crop stays as it is (DEC-047).
		const cut = this.#deps.cutCrop;
		// The case is read for it only when such a mark is among what came.
		if (cut !== undefined && wholeShotMarks(incoming, given).length > 0)
			for (const want of wholeShotCrops(
				incoming,
				given,
				await store.getCase(caseId),
			)) {
				const shot = fetched.get(want.sha256);
				if (shot === undefined) continue;
				try {
					fetched.set(
						cutKey(want.markId),
						await cut(shot, want.rect, want.viewportWidth),
					);
				} catch {
					// The whole screenshot, then, as before.
				}
			}
		/** Merge with the case as it is; an image it lacks is read and it is tried again. */
		const attempt = async <T>(work: () => Promise<T>): Promise<T> => {
			for (let i = 0; ; i++) {
				try {
					return await work();
				} catch (error) {
					if (!(error instanceof NeedsImage) || i > 2000) throw error;
					if (error.remote !== undefined) {
						const no = await this.#fetch(api, team, [error.remote], fetched);
						if (no.size > 0)
							throw new Error(
								"an image the server sent is not the image named",
							);
					} else if (error.local !== undefined) {
						const image = await store.getImage(caseId, error.local);
						if (image === undefined)
							throw new Error(`the image ${error.local} is missing`);
						crops.set(error.local, image);
					}
				}
			}
		};
		// The ids of what is new are written down first: should the worker stop
		// between the case and the book, the new marks are known as the
		// server's. Each with what tells its mark or screenshot from another
		// (`announced`): should it stop before the case is stored, or the
		// case's write fail, an id here can come to mean another mark, and
		// must not make that one the server's.
		const first = await attempt(async () =>
			mergeCase(
				await store.getCase(caseId),
				given,
				incoming,
				fetched,
				crops,
				options,
			),
		);
		if (first === undefined) return { changed: false, incomplete };
		const known = given ?? emptyBook(caseId, "synced", team.id);
		// Every id that stands for another mark or screenshot of the server's
		// than the book said before: also one the book had, which the merge
		// gives to another mark (a mark here takes the server's number, and
		// a teammate's mark takes its old id).
		const newMarks = Object.keys(first.book.marks).filter(
			(id) => known.marks[id] !== first.book.marks[id],
		);
		const newShots = Object.keys(first.book.shots).filter(
			(id) => known.shots[id] !== first.book.shots[id],
		);
		const announce =
			given === undefined || newMarks.length > 0 || newShots.length > 0;
		if (announce) {
			const marks = new Map(first.value.marks.map((a) => [a.id, a]));
			const shots = new Map(first.value.shots.map((s) => [s.id, s]));
			await this.#books.put({
				...known,
				marks: { ...first.book.marks },
				shots: { ...first.book.shots },
				announced: {
					marks: Object.fromEntries(
						newMarks.flatMap((id) => {
							const a = marks.get(id);
							return a === undefined ? [] : [[id, fixedOf(a)]];
						}),
					),
					shots: Object.fromEntries(
						newShots.flatMap((id) => {
							const s = shots.get(id);
							return s === undefined ? [] : [[id, s.capturedAt]];
						}),
					),
				},
			});
		}
		let merged: Merged | undefined;
		try {
			await attempt(async () => {
				merged = undefined;
				try {
					this.#stored++;
					await store.updateCase(caseId, (current) => {
						merged = mergeCase(
							current,
							given,
							incoming,
							fetched,
							crops,
							options,
						);
						if (merged === undefined || !merged.changed) throw NOTHING;
						return {
							value: validateCase(merged.value),
							images: merged.images as Map<string, StoredImage>,
							deleteImages: merged.deleteImages,
						};
					});
				} catch (error) {
					if (error !== NOTHING) throw error;
				}
			});
		} catch (error) {
			// The case was not stored: the ids written down for it are taken
			// back, so the book is as it was.
			if (announce) {
				if (stored === undefined) await this.#books.remove(caseId);
				else await this.#books.put(given ?? stored);
			}
			throw error;
		}
		const result = merged as Merged | undefined;
		if (result === undefined) {
			if (announce && given !== undefined) await this.#books.put(given);
			else if (announce) await this.#books.remove(caseId);
			return { changed: false, incomplete };
		}
		const { announced: _told, ...settled } = result.book;
		await this.#books.put(settled);
		return { changed: result.changed, incomplete };
	}
}
