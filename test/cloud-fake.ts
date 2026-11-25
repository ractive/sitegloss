/**
 * The sitegloss.dev API in memory, for the engine's tests: one team's cases,
 * screenshots, marks and images, kept by the server's own rules (its
 * `store.ts`): an operation's id is applied once, a taken mark number gives
 * the next one, who did something is the caller, a deleted mark's
 * screenshot goes with its last mark, what was deleted is told once to who
 * asks for the changes since, in pages, and a cursor from another history
 * gets the whole state (`reset`).
 */

import Ajv2020 from "ajv/dist/2020";
import {
	type ElementDetails,
	lookOf,
	MAX_PAGES,
	pageKey,
	samePage,
	withoutLook,
} from "../src/lib/case.ts";
import contract from "../src/lib/cloud/openapi-v1.json" with { type: "json" };
import { keptQuery } from "../src/lib/query.ts";

/**
 * The contract itself: every request of operations is held to the JSON
 * schemas of the API's document (the copy the types are generated from),
 * as the real server holds it to the same schemas, and to its limits for
 * one request. So what the extension sends meets the contract in every
 * test run, not only in those against a real server.
 */
const ajv = new Ajv2020({ strict: false });
ajv.addFormat(
	"date-time",
	// As the server's `z.iso.datetime()`: UTC, written with Z, no offset.
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
);
ajv.addFormat("binary", true);
ajv.addSchema(contract, "v1");
const validRequest = ajv.compile({ $ref: "v1#/components/schemas/OpsRequest" });

/** The most one request of operations may weigh at the server. */
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

/** Why the server would answer 400 or 413 to these operations as a whole; none: it takes them. */
export function requestProblem(
	ops: readonly Op[],
): { status: number; message: string } | undefined {
	const body = JSON.stringify({ ops });
	if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES)
		return { status: 413, message: "The request is too large." };
	// As it arrives: what JSON does not carry is not there.
	if (!validRequest(JSON.parse(body)))
		return {
			status: 400,
			message: `The request is not one the API takes: ${ajv.errorsText(validRequest.errors)}`,
		};
	return undefined;
}

import {
	type Api,
	ApiFailure,
	type AppRef,
	type Changes,
	type ImageRef,
	type Me,
	type Op,
	type OpResult,
	type OpsResponse,
	type Removed,
	sha256Of,
	type UserRef,
	type WireCase,
	type WireComment,
	type WireMark,
	type WireReopen,
	type WireResolution,
	type WireShot,
} from "../src/lib/cloud/api.ts";
import type { NewMarkImage } from "../src/lib/cloud/wire.ts";

export const TEAM = "team_1";

const ALL = [
	"case:read",
	"case:create",
	"case:update",
	"case:delete",
	"case:share",
	"mark:create",
	"mark:update",
	"mark:delete",
	// DEC-046 (the server's DEC-017, DEC-018).
	"case:close",
	"comment:create",
	"comment:moderate",
];

const PERMISSION: Record<Op["type"], string> = {
	"case.create": "case:create",
	"case.patch": "case:update",
	"case.delete": "case:delete",
	"shot.create": "mark:create",
	"shot.delete": "mark:delete",
	"mark.create": "mark:create",
	"mark.patch": "mark:update",
	"mark.delete": "mark:delete",
	"case.close": "case:close",
	"case.reopen": "case:close",
	"comment.create": "comment:create",
	"comment.patch": "comment:create",
	"comment.delete": "comment:create",
};

/** An app as the server stores a client's word for it: never verified. */
const appOf = (via: AppRef | undefined): AppRef | undefined =>
	via === undefined
		? undefined
		: { id: via.id, ...(via.name ? { name: via.name } : {}), host: via.host };

/** When, who, and through which app (the client's word for the app). */
const stampOf = (at: string, user: UserRef, via: AppRef | undefined) => {
	const app = appOf(via);
	return { at, user, ...(app === undefined ? {} : { app }) };
};

/** A comment row: the comment, and the revision it came at (its place in the thread). */
/** An element as the server keeps it: its look within the server's rules (its `keptLook`). */
const kept = <T extends object | null>(element: T): T =>
	element === null
		? element
		: ({
				...withoutLook(element as unknown as ElementDetails),
				...lookOf(element as ElementDetails),
			} as unknown as T);

interface CommentRow extends Row<WireComment> {
	createdRev: number;
}

class Refusal extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

interface Row<T> {
	value: T;
	deleted: boolean;
	rev: number;
}

const compact = <T extends object>(value: T): T =>
	Object.fromEntries(
		Object.entries(value).filter(([, inner]) => inner !== undefined),
	) as T;

/** One user's connection: what a device of theirs calls. */
export interface FakeApi extends Api {
	/** The requests made, as `GET changes`, `POST ops 3`, … */
	calls: string[];
	/** Nothing reaches the server. */
	offline: boolean;
	/** The next `n` requests of operations are applied, and their reply is lost. */
	loseReplies: number;
	/** The server refuses the token. */
	unauthorized: boolean;
	permissions: string[];
}

export class FakeServer {
	seq = 0;
	readonly cases = new Map<string, Row<WireCase>>();
	readonly shots = new Map<string, Row<WireShot>>();
	readonly marks = new Map<string, Row<WireMark>>();
	readonly comments = new Map<string, CommentRow>();
	readonly blobs = new Map<string, Blob>();
	readonly applied = new Map<string, OpResult>();
	/** How many things one answer of changes holds at most. */
	pageSize = 500;
	/** The server's clock. */
	now = new Date("2026-11-19T12:00:00.000Z");
	/** Fields this version of the contract does not have: a later one's. */
	future = false;
	/** Refuse operations of these types with a code no client knows yet. */
	refuseWith: { type: Op["type"]; code: string; message: string } | undefined;
	/** The team's members (DEC-071): everyone a device was made for, and whoever is added. */
	readonly members = new Map<string, UserRef>();
	/** A server from before assignees: no members, no assignee on a case, `assignee` in a patch ignored. */
	beforeAssignees = false;

	#tick(): string {
		this.now = new Date(this.now.getTime() + 1000);
		return this.now.toISOString();
	}

	/** The live marks of a case, by number. */
	marksOf(caseId: string): WireMark[] {
		return [...this.marks.values()]
			.filter((m) => !m.deleted && m.value.caseId === caseId)
			.map((m) => m.value)
			.sort((a, b) => a.number - b.number);
	}

	shotsOf(caseId: string): WireShot[] {
		return [...this.shots.values()]
			.filter((s) => !s.deleted && s.value.caseId === caseId)
			.map((s) => s.value);
	}

	/** A case's thread, in the order the server took it. */
	commentsOf(caseId: string): WireComment[] {
		return [...this.comments.values()]
			.filter((k) => !k.deleted && k.value.caseId === caseId)
			.sort((a, b) => a.createdRev - b.createdRev)
			.map((k) => k.value);
	}

	/**
	 * A case as the server sends it: one that knows assignees always says
	 * one, `null` for nobody, also of a case made before it knew them; one
	 * from before says none.
	 */
	caseOut(c: WireCase): WireCase {
		if (this.beforeAssignees) {
			const { assignee: _a, assignedBy: _b, ...rest } = c;
			return rest;
		}
		return { ...c, assignee: c.assignee ?? null };
	}

	caseOf(caseId: string): WireCase | undefined {
		const row = this.cases.get(caseId);
		return row === undefined || row.deleted ? undefined : row.value;
	}

	/**
	 * The server's database was restored from an old copy: what is in it has
	 * an early revision, and a client's cursor is ahead of the server's.
	 */
	restore(): void {
		this.seq = 1;
		this.applied.clear();
		for (const table of [
			this.cases,
			this.shots,
			this.marks,
			this.comments,
		] as Map<string, Row<{ rev: number }>>[]) {
			for (const [id, row] of table) {
				if (row.deleted) table.delete(id);
				else {
					row.rev = 1;
					row.value.rev = 1;
				}
			}
		}
	}

	// Who did something, and what happened before, is the server's to say:
	// as its `store.ts` stamps it.

	#stampVerification(
		user: UserRef,
		previous: WireResolution["verified"],
		next: WireResolution["verified"],
		imports: boolean,
	): WireResolution["verified"] {
		if (!next) return undefined;
		if (previous && previous.at === next.at) return previous;
		const imported = imports && next.imported ? true : undefined;
		return compact({
			at: next.at,
			app: next.app,
			imported,
			user: imported ? undefined : user,
		}) as WireResolution["verified"];
	}

	#stampResolution(
		user: UserRef,
		previous: WireResolution | null | undefined,
		next: WireResolution | null,
		imports: boolean,
	): WireResolution | null {
		if (!next) return null;
		const kept =
			previous && previous.at === next.at && previous.kind === next.kind
				? previous
				: undefined;
		const imported = kept
			? kept.imported
			: imports && next.imported
				? true
				: undefined;
		return compact({
			kind: next.kind,
			note: next.note || undefined,
			at: next.at,
			app: kept ? kept.app : next.app,
			verified:
				next.kind === "fixed"
					? this.#stampVerification(
							user,
							kept?.verified,
							next.verified,
							imports,
						)
					: undefined,
			imported,
			user: kept ? kept.user : imported ? undefined : user,
		}) as WireResolution;
	}

	/** History is only added to, and the resolution a new reopen ended is the stored one. */
	#stampReopens(
		user: UserRef,
		previous: readonly WireReopen[],
		next: readonly WireReopen[],
		ended: WireResolution | null | undefined,
		imports: boolean,
	): WireReopen[] {
		const known = new Set(previous.map((r) => r.at));
		const added = next
			.filter((r) => !known.has(r.at))
			.map((r) => {
				const imported = imports && r.imported ? true : undefined;
				const { user: _u, verified, ...plain } = r.was;
				const { user: _v, ...checked } = verified ?? { at: "" };
				const was =
					ended && ended.at === r.was.at && ended.kind === r.was.kind
						? ended
						: verified
							? { ...plain, verified: checked }
							: plain;
				return compact({
					note: r.note || undefined,
					at: r.at,
					app: r.app,
					was,
					imported,
					user: imported ? undefined : user,
				}) as WireReopen;
			});
		return [...previous, ...added].slice(-20);
	}

	#live(caseId: string): Row<WireCase> {
		const row = this.cases.get(caseId);
		if (row === undefined || row.deleted)
			throw new Refusal(
				"not_found",
				"The case does not exist, or was deleted.",
			);
		return row;
	}

	/**
	 * A screenshot of a page the case does not have adds that page, called
	 * what the operation says; which page an address is, is `pageKey`. A full
	 * list takes no more. (The server's `withPageOf`.)
	 */
	#withPageOf(
		owner: Row<WireCase>,
		op: Extract<Op, { type: "shot.create" }>,
	): void {
		const pages = owner.value.pages;
		if (
			pages.some((p) => samePage(p.url, op.shot.url)) ||
			pages.length >= MAX_PAGES
		)
			return;
		owner.value = {
			...owner.value,
			pages: [
				...pages,
				{
					url: op.shot.url,
					title: op.page?.title ?? "",
					...(op.page?.lang ? { lang: op.page.lang } : {}),
				},
			],
		};
	}

	/**
	 * A page leaves the case with its last screenshot; the last page of all
	 * stays. (The server's `withoutEmptyPages`.)
	 */
	#withoutEmptyPages(owner: Row<WireCase>): void {
		const pages = owner.value.pages;
		if (pages.length < 2) return;
		const keys = new Set(
			this.shotsOf(owner.value.id).map((s) => pageKey(s.url)),
		);
		const kept = pages.filter((p) => keys.has(pageKey(p.url)));
		if (kept.length === pages.length) return;
		owner.value = {
			...owner.value,
			pages: kept.length > 0 ? kept : pages.slice(0, 1),
		};
	}

	#touch(row: Row<WireCase>, rev: number, at: string): void {
		row.rev = rev;
		row.value = { ...row.value, updatedAt: at, rev };
	}

	/**
	 * A mark's images after `add` (the server's rules, DEC-032): an id twice
	 * in one add is invalid; an id the mark has stays as stored; one another
	 * mark of the case has is a conflict; a picture not uploaded is
	 * blob_missing; more than 6 is the limit. In an imported case an image
	 * with its own time keeps it, marked imported and naming nobody.
	 */
	#withImages(
		caseId: string,
		markId: string,
		images: NonNullable<WireMark["images"]>,
		add: readonly NewMarkImage[],
		user: UserRef,
		via: AppRef | undefined,
		at: string,
		imports: boolean,
	): NonNullable<WireMark["images"]> {
		const ids = add.map((x) => x.id);
		if (new Set(ids).size !== ids.length)
			throw new Refusal(
				"invalid",
				"The same image id is added twice in one operation.",
			);
		const others = new Set(
			[...this.marks.values()]
				.filter((m) => m.value.caseId === caseId && m.value.id !== markId)
				.flatMap((m) => (m.value.images ?? []).map((x) => x.id)),
		);
		const next = [...images];
		for (const x of add) {
			if (next.some((k) => k.id === x.id)) continue;
			if (others.has(x.id))
				throw new Refusal(
					"conflict",
					"The image's id is taken by another mark of this case.",
				);
			this.#need(x.image, "image");
			next.push({
				id: x.id,
				image: x.image,
				added:
					imports && x.at !== undefined
						? { at: x.at, imported: true }
						: stampOf(at, user, via),
			});
		}
		if (next.length > 6)
			throw new Refusal("limit", "A mark holds at most 6 images.");
		return next;
	}

	#need(image: ImageRef, what: string): void {
		if (!this.blobs.has(image.sha256))
			throw new Refusal(
				"blob_missing",
				`The ${what} ${image.sha256} has not been uploaded.`,
			);
	}

	/** A comment the caller may change: their own, through the same app; by hand also with moderate. */
	#writer(
		row: CommentRow,
		user: UserRef,
		via: AppRef | undefined,
		may: readonly string[],
	): void {
		const own = row.value.user?.id === user.id;
		const ok =
			via === undefined
				? own || may.includes("comment:moderate")
				: own && row.value.app?.id === via.id;
		if (!ok)
			throw new Refusal("forbidden", "This comment is not yours to change.");
	}

	#apply(
		op: Op,
		user: UserRef,
		rev: number,
		at: string,
		may: readonly string[] = ALL,
	): Pick<OpResult, "status" | "number"> {
		switch (op.type) {
			case "case.create": {
				const existing = this.cases.get(op.case.id);
				if (existing) {
					if (!existing.deleted) return { status: "duplicate" };
					throw new Refusal("conflict", "The case's id is taken.");
				}
				this.cases.set(op.case.id, {
					deleted: false,
					rev,
					value: {
						id: op.case.id,
						teamId: TEAM,
						title: op.case.title,
						link: op.case.link ?? null,
						summary: op.case.summary ?? null,
						pages: op.case.pages ?? [],
						client: op.case.client ?? {},
						lastNumber: op.case.lastNumber ?? 0,
						importedAt: op.case.importedAt ?? null,
						closed: null,
						createdBy: user,
						...(this.beforeAssignees ? {} : { assignee: null }),
						createdAt: op.case.createdAt ?? at,
						updatedAt: at,
						rev,
					},
				});
				return { status: "applied" };
			}
			case "case.patch": {
				const row = this.#live(op.caseId);
				let v = row.value;
				// The assignee (DEC-071): a member of the team, or nobody;
				// stamped from the caller; the same again changes nothing.
				if (op.assignee !== undefined && !this.beforeAssignees) {
					const to =
						op.assignee === null ? null : this.members.get(op.assignee);
					if (to === undefined)
						throw new Refusal(
							"invalid",
							"The assignee is no member of the team.",
						);
					if ((v.assignee?.id ?? null) !== (to?.id ?? null)) {
						const { assignedBy: _s, ...rest } = v;
						v =
							to === null
								? { ...rest, assignee: null }
								: { ...rest, assignee: to, assignedBy: { at, user } };
					}
				}
				row.value = {
					...v,
					title: op.title ?? v.title,
					link: op.link === undefined ? v.link : op.link,
					summary: op.summary === undefined ? v.summary : op.summary,
					pages: op.pages ?? v.pages,
					lastNumber: Math.max(v.lastNumber, op.lastNumber ?? 0),
					// Stamped only on a change of the text.
					...(op.summary !== undefined &&
					op.summary !== v.summary &&
					v.importedAt === null
						? {
								summaryBy: stampOf(at, user, op.via),
							}
						: {}),
				};
				this.#touch(row, rev, at);
				return { status: "applied" };
			}
			case "case.close":
			case "case.reopen": {
				const row = this.#live(op.caseId);
				const closing = op.type === "case.close";
				if ((row.value.closed !== null) === closing)
					return { status: "duplicate" };
				row.value = {
					...row.value,
					closed: closing ? stampOf(at, user, op.via) : null,
				};
				this.#touch(row, rev, at);
				return { status: "applied" };
			}
			case "comment.create": {
				const owner = this.#live(op.caseId);
				const existing = this.comments.get(op.comment.id);
				if (existing) {
					if (existing.value.caseId === op.caseId)
						return { status: "duplicate" };
					throw new Refusal("conflict", "The comment's id is taken.");
				}
				if (op.comment.text.trim() === "")
					throw new Refusal("invalid", "A comment needs some text.");
				const markId = op.comment.markId ?? null;
				if (markId !== null) {
					const mark = this.marks.get(markId);
					if (!mark || mark.deleted || mark.value.caseId !== op.caseId)
						throw new Refusal("invalid", "The mark is not one of this case.");
				}
				if (this.commentsOf(op.caseId).length >= 1000)
					throw new Refusal("limit", "A case holds at most 1000 comments.");
				this.comments.set(op.comment.id, {
					deleted: false,
					rev,
					createdRev: rev,
					value: compact({
						id: op.comment.id,
						caseId: op.caseId,
						markId,
						text: op.comment.text,
						user,
						app: appOf(op.via),
						at:
							op.comment.at !== undefined && op.comment.at < at
								? op.comment.at
								: at,
						rev,
					}) as WireComment,
				});
				this.#touch(owner, rev, at);
				return { status: "applied" };
			}
			case "comment.patch": {
				const row = this.comments.get(op.commentId);
				if (row === undefined || row.deleted)
					throw new Refusal("not_found", "The comment does not exist.");
				this.#writer(row, user, op.via, may);
				if (row.value.text === op.text) return { status: "duplicate" };
				row.value = compact({
					...row.value,
					text: op.text,
					edited: stampOf(at, user, op.via),
					rev,
				}) as WireComment;
				row.rev = rev;
				this.#touch(this.#live(row.value.caseId), rev, at);
				return { status: "applied" };
			}
			case "comment.delete": {
				const row = this.comments.get(op.commentId);
				if (row === undefined)
					throw new Refusal("not_found", "The comment does not exist.");
				if (row.deleted) return { status: "duplicate" };
				this.#writer(row, user, op.via, may);
				row.deleted = true;
				row.rev = rev;
				this.#touch(this.#live(row.value.caseId), rev, at);
				return { status: "applied" };
			}
			case "case.delete": {
				const row = this.cases.get(op.caseId);
				if (row === undefined)
					throw new Refusal("not_found", "The case does not exist.");
				if (row.deleted) return { status: "duplicate" };
				// Its marks and screenshots go with it, without a word of their own.
				for (const [id, mark] of this.marks)
					if (mark.value.caseId === op.caseId) this.marks.delete(id);
				for (const [id, shot] of this.shots)
					if (shot.value.caseId === op.caseId) this.shots.delete(id);
				for (const [id, k] of this.comments)
					if (k.value.caseId === op.caseId) this.comments.delete(id);
				row.deleted = true;
				row.value = {
					...row.value,
					title: "",
					summary: null,
					link: null,
					pages: [],
				};
				this.#touch(row, rev, at);
				return { status: "applied" };
			}
			case "shot.create": {
				const owner = this.#live(op.caseId);
				const existing = this.shots.get(op.shot.id);
				if (existing && existing.value.caseId !== op.caseId)
					throw new Refusal("conflict", "The screenshot's id is taken.");
				if (existing && !existing.deleted) return { status: "duplicate" };
				this.#need(op.shot.image, "screenshot");
				if (existing) {
					// It went with its last mark; a mark still on it brings it back,
					// and its page with it.
					existing.deleted = false;
					existing.rev = rev;
					existing.value = { ...existing.value, rev };
					this.#withPageOf(owner, op);
					this.#touch(owner, rev, at);
					return { status: "applied" };
				}
				// The query as the server keeps it: filtered again, never refused
				// (its `keptQuery`, DEC-050 here).
				const { query, ...shot } = op.shot;
				const keptOf = query === undefined ? "" : keptQuery(query);
				this.shots.set(op.shot.id, {
					deleted: false,
					rev,
					value: {
						...shot,
						...(keptOf === "" ? {} : { query: keptOf }),
						caseId: op.caseId,
						rev,
					},
				});
				this.#withPageOf(owner, op);
				this.#touch(owner, rev, at);
				return { status: "applied" };
			}
			case "shot.delete": {
				const row = this.shots.get(op.shotId);
				if (row === undefined)
					throw new Refusal("not_found", "The screenshot does not exist.");
				if (row.deleted) return { status: "duplicate" };
				if (this.marksOf(row.value.caseId).some((m) => m.shotId === op.shotId))
					throw new Refusal("conflict", "A mark is still on this screenshot.");
				row.deleted = true;
				row.rev = rev;
				const owner = this.#live(row.value.caseId);
				this.#withoutEmptyPages(owner);
				this.#touch(owner, rev, at);
				return { status: "applied" };
			}
			case "mark.create": {
				const owner = this.#live(op.caseId);
				const existing = this.marks.get(op.mark.id);
				if (existing) {
					if (existing.value.caseId === op.caseId)
						return { status: "duplicate", number: existing.value.number };
					throw new Refusal("conflict", "The mark's id is taken.");
				}
				const shot = this.shots.get(op.mark.shotId);
				if (!shot || shot.deleted || shot.value.caseId !== op.caseId)
					throw new Refusal(
						"invalid",
						"The mark's screenshot is not one of this case: create the screenshot first.",
					);
				this.#need(op.mark.crop, "crop");
				// A deleted mark's number stays taken.
				const all = [...this.marks.values()].filter(
					(m) => m.value.caseId === op.caseId,
				);
				const taken = all.some((m) => m.value.number === op.mark.number);
				const number = taken
					? Math.max(
							owner.value.lastNumber,
							...all.map((m) => m.value.number),
						) + 1
					: op.mark.number;
				const imports = owner.value.importedAt !== null;
				const resolution = this.#stampResolution(
					user,
					undefined,
					op.mark.resolution ?? null,
					imports,
				);
				const images = this.#withImages(
					op.caseId,
					op.mark.id,
					[],
					op.mark.images ?? [],
					user,
					op.via,
					at,
					imports,
				);
				this.marks.set(op.mark.id, {
					deleted: false,
					rev,
					value: {
						id: op.mark.id,
						caseId: op.caseId,
						number,
						shotId: op.mark.shotId,
						comment: op.mark.comment,
						author: op.mark.author ?? "user",
						shape: op.mark.shape,
						crop: op.mark.crop,
						// What the server does not keep of a look is dropped, never
						// refused (the server's DEC-021).
						element: kept(op.mark.element),
						// Set with the mark, never patched (the server's DEC-020).
						...(op.mark.ends === undefined
							? {}
							: {
									ends: {
										start: kept(op.mark.ends.start),
										end: kept(op.mark.ends.end),
									},
								}),
						resolution,
						reopens: this.#stampReopens(
							user,
							[],
							op.mark.reopens ?? [],
							undefined,
							imports,
						),
						// Findings it is sent are none of this fake's: the
						// extension sends none (DEC-081).
						findings: [],
						images,
						status: statusOf(resolution),
						createdBy: user,
						...(op.via === undefined
							? {}
							: { createdVia: appOf(op.via) as AppRef }),
						createdAt: op.mark.createdAt ?? at,
						updatedAt: at,
						rev,
					},
				});
				if (op.via !== undefined) {
					const made = this.marks.get(op.mark.id) as Row<WireMark>;
					made.value = { ...made.value, author: "ai" };
				}
				owner.value = {
					...owner.value,
					lastNumber: Math.max(owner.value.lastNumber, number),
					// New open work opens a closed case again.
					...(resolution === null ? { closed: null } : {}),
				};
				this.#touch(owner, rev, at);
				return { status: "applied", number };
			}
			case "mark.patch": {
				const row = this.marks.get(op.markId);
				if (row === undefined || row.deleted)
					throw new Refusal(
						"not_found",
						"The mark does not exist, or was deleted.",
					);
				let v = row.value;
				const wasSettled = v.resolution !== null;
				if (op.comment !== undefined)
					v = {
						...v,
						comment: op.comment,
						author: op.via === undefined ? (op.author ?? "user") : "ai",
						...(op.comment !== row.value.comment
							? { commentBy: stampOf(at, user, op.via) }
							: {}),
					};
				else if (op.author !== undefined) v = { ...v, author: op.author };
				const imports = this.#live(v.caseId).value.importedAt !== null;
				if (op.state !== undefined) {
					const resolution = this.#stampResolution(
						user,
						v.resolution,
						op.state.resolution,
						imports,
					);
					v = {
						...v,
						reopens: this.#stampReopens(
							user,
							v.reopens,
							op.state.reopens,
							v.resolution,
							imports,
						),
						resolution,
						status: statusOf(resolution),
					};
				}
				if (op.images !== undefined) {
					const gone = new Set(op.images.remove ?? []);
					if ((op.images.add ?? []).some((x) => gone.has(x.id)))
						throw new Refusal(
							"invalid",
							"An image is added or removed, never both in one operation: an id stays with its picture.",
						);
					v = {
						...v,
						images: this.#withImages(
							v.caseId,
							v.id,
							(v.images ?? []).filter((x) => !gone.has(x.id)),
							op.images.add ?? [],
							user,
							op.via,
							at,
							imports,
						),
					};
				}
				row.value = { ...v, updatedAt: at, rev };
				row.rev = rev;
				const owner = this.#live(v.caseId);
				// Settled to open: a reopen opens a closed case again.
				if (wasSettled && v.resolution === null)
					owner.value = { ...owner.value, closed: null };
				this.#touch(owner, rev, at);
				return { status: "applied" };
			}
			case "mark.delete": {
				const row = this.marks.get(op.markId);
				if (row === undefined)
					throw new Refusal("not_found", "The mark does not exist.");
				if (row.deleted) return { status: "duplicate" };
				row.deleted = true;
				row.rev = rev;
				row.value = { ...row.value, findings: [], comment: "", rev };
				const shotId = row.value.shotId;
				if (!this.marksOf(row.value.caseId).some((m) => m.shotId === shotId)) {
					const shot = this.shots.get(shotId);
					if (shot && !shot.deleted) {
						shot.deleted = true;
						shot.rev = rev;
					}
				}
				const owner = this.#live(row.value.caseId);
				this.#withoutEmptyPages(owner);
				this.#touch(owner, rev, at);
				return { status: "applied" };
			}
		}
	}

	applyOps(
		ops: readonly Op[],
		user: UserRef,
		may: readonly string[],
	): OpsResponse {
		const rev = ++this.seq;
		const at = this.#tick();
		let changed = false;
		const results = ops.map((op): OpResult => {
			const before = this.applied.get(op.opId);
			if (before) return { ...before, status: "duplicate" };
			try {
				if (!may.includes(PERMISSION[op.type]))
					throw new Refusal(
						"forbidden",
						`You may not do this here (${PERMISSION[op.type]}).`,
					);
				if (this.refuseWith?.type === op.type)
					throw new Refusal(this.refuseWith.code, this.refuseWith.message);
				const done = this.#apply(structuredClone(op), user, rev, at, may);
				const result: OpResult = {
					opId: op.opId,
					...done,
					...(done.status === "applied" ? { rev } : {}),
				};
				this.applied.set(op.opId, result);
				if (done.status === "applied") changed = true;
				return result;
			} catch (error) {
				if (!(error instanceof Refusal)) throw error;
				return {
					opId: op.opId,
					status: "rejected",
					error: { code: error.code, message: error.message },
				} as OpResult;
			}
		});
		if (!changed) this.seq--;
		return { results, cursor: this.seq };
	}

	changes(since: number | undefined, limit = this.pageSize): Changes {
		const head = this.seq;
		const reset = since !== undefined && since > head;
		const from = reset || since === undefined ? 0 : since;
		// Only a request that names no revision gets the whole state (which
		// names no deletes); `since=0` is a revision like any other, as at
		// the server since its fix.
		const whole = reset || since === undefined;
		const revs = [
			...this.cases.values(),
			...this.shots.values(),
			...this.marks.values(),
			...this.comments.values(),
		]
			.map((r) => r.rev)
			.filter((r) => r > from)
			.sort((a, b) => a - b);
		const cut = revs[limit];
		// The page ends on a whole revision, as the server's does.
		const upTo = cut === undefined ? head : cut;
		const more = cut !== undefined;
		const inRange = (row: { rev: number }) => row.rev > from && row.rev <= upTo;
		const removed: Removed[] = [];
		const out = {
			cases: [] as WireCase[],
			shots: [] as WireShot[],
			marks: [] as WireMark[],
			comments: [] as WireComment[],
		};
		const extra = this.future ? { somethingNew: { since: "v1.9" } } : {};
		for (const [id, row] of this.cases) {
			if (!inRange(row)) continue;
			if (row.deleted) {
				if (!whole) removed.push({ type: "case", id, rev: row.rev });
			} else out.cases.push({ ...this.caseOut(row.value), ...extra });
		}
		for (const [id, row] of this.shots) {
			if (!inRange(row)) continue;
			if (row.deleted) {
				if (!whole)
					removed.push({
						type: "shot",
						id,
						caseId: row.value.caseId,
						rev: row.rev,
					});
			} else out.shots.push({ ...row.value, rev: row.rev, ...extra });
		}
		for (const [id, row] of this.marks) {
			if (!inRange(row)) continue;
			if (row.deleted) {
				if (!whole)
					removed.push({
						type: "mark",
						id,
						caseId: row.value.caseId,
						rev: row.rev,
					});
			} else out.marks.push({ ...row.value, ...extra });
		}
		// Comments in the order they came; a deleted one names no case.
		for (const [id, row] of [...this.comments].sort(
			([, a], [, b]) => a.createdRev - b.createdRev,
		)) {
			if (!inRange(row)) continue;
			if (row.deleted) {
				if (!whole) removed.push({ type: "comment", id, rev: row.rev });
			} else out.comments.push({ ...row.value });
		}
		if (this.future && !whole)
			removed.push({
				type: "label" as Removed["type"],
				id: "l_1",
				caseId: "c_unknown",
				rev: upTo,
			});
		return structuredClone({
			cursor: upTo,
			more,
			reset,
			...out,
			removed,
			...extra,
		});
	}

	/** A device of `user`'s. */
	api(user: UserRef & { email?: string }): FakeApi {
		const server = this;
		if (!server.members.has(user.id))
			server.members.set(user.id, { id: user.id, name: user.name });
		const reach = (call: string) => {
			api.calls.push(call);
			if (api.offline)
				throw new ApiFailure("offline", "The server could not be reached.");
			if (api.unauthorized)
				throw new ApiFailure("unauthorized", "The token ran out.", 401);
		};
		const api: FakeApi = {
			calls: [],
			offline: false,
			loseReplies: 0,
			unauthorized: false,
			permissions: [...ALL],
			async me(): Promise<Me> {
				reach("GET me");
				return {
					user: {
						id: user.id,
						name: user.name,
						email: user.email ?? `${user.id}@example.com`,
						image: null,
					},
					teams: [
						{
							id: TEAM,
							name: "Pedal & Pine web",
							slug: "pedal",
							role: "contributor",
							permissions: [...api.permissions],
						},
					],
				};
			},
			async changes(_team, since, limit) {
				reach(
					`GET changes ${since ?? ""}${limit === undefined ? "" : ` limit ${limit}`}`.trim(),
				);
				return server.changes(since, limit);
			},
			async members(_team) {
				reach("GET members");
				return server.beforeAssignees
					? undefined
					: structuredClone([...server.members.values()]);
			},
			async getCase(_team, caseId) {
				reach(`GET case ${caseId}`);
				const row = server.cases.get(caseId);
				if (row === undefined || row.deleted) return undefined;
				return structuredClone({
					...server.caseOut(row.value),
					shots: server.shotsOf(caseId),
					marks: server.marksOf(caseId),
					comments: server.commentsOf(caseId),
				});
			},
			async ops(_team, ops) {
				reach(`POST ops ${ops.length}`);
				// Refused as a whole, as the server refuses what its schemas
				// do not take: nothing of it is applied.
				const wrong = requestProblem(ops);
				if (wrong !== undefined)
					throw new ApiFailure(
						"refused",
						wrong.message,
						wrong.status,
						wrong.status === 413 ? "too_large" : "invalid",
					);
				const answer = server.applyOps(
					ops,
					{ id: user.id, name: user.name },
					api.permissions,
				);
				if (api.loseReplies > 0) {
					api.loseReplies--;
					throw new ApiFailure("offline", "The reply was lost.");
				}
				return structuredClone(answer);
			},
			async hasBlob(_team, sha) {
				reach(`HEAD blob ${sha.slice(0, 8)}`);
				return server.blobs.has(sha);
			},
			async putBlob(_team, sha, image) {
				reach(`PUT blob ${sha.slice(0, 8)}`);
				if ((await sha256Of(image)) !== sha)
					throw new ApiFailure(
						"refused",
						"The image is not the one its name says.",
						400,
						"invalid",
					);
				server.blobs.set(sha, image);
			},
			async getBlob(_team, sha) {
				reach(`GET blob ${sha.slice(0, 8)}`);
				const blob = server.blobs.get(sha);
				if (blob === undefined)
					throw new ApiFailure("refused", "No such image.", 404, "not_found");
				return blob;
			},
		};
		return api;
	}
}

function statusOf(r: WireResolution | null): WireMark["status"] {
	if (!r) return "open";
	if (r.kind === "fixed") return r.verified ? "verified" : "fixed";
	return r.kind;
}

/**
 * The same server over HTTP, as `fetch` reaches it: the token endpoint of a
 * public client (a code per person, refresh tokens that rotate) and the
 * API's routes, for what is tested through the real client (`httpApi`) and
 * the worker's sign-in.
 */
export function fakeHttp(
	server: FakeServer,
	origin: string,
	people: Record<string, UserRef & { email: string }>,
) {
	const state = {
		/** Access tokens that hold, to whose they are. */
		access: new Map<string, string>(),
		refresh: new Map<string, string>(),
		revoked: [] as string[],
		/** An answer in a request's stead (`"GET /api/v1/me"`): the API in trouble. */
		broken: undefined as
			| ((request: string) => Response | undefined)
			| undefined,
		requests: [] as string[],
		offline: false,
		/** Access tokens are refused, whatever they are. */
		expired: false,
		permissions: [...ALL],
	};
	let n = 0;
	const issue = (person: string) => {
		const access = `at_${person}_${++n}`;
		const refresh = `rt_${person}_${n}`;
		state.access.set(access, person);
		state.refresh.set(refresh, person);
		return {
			access_token: access,
			refresh_token: refresh,
			expires_in: 3600,
			token_type: "Bearer",
		};
	};
	const no = (status: number, code: string, message: string) =>
		Response.json({ error: { code, message } }, { status });

	async function fetcher(input: string, init?: RequestInit): Promise<Response> {
		const url = new URL(input);
		const method = init?.method ?? "GET";
		state.requests.push(`${method} ${url.pathname}`);
		if (state.offline) throw new TypeError("Failed to fetch");
		if (url.origin !== origin) return new Response("", { status: 404 });
		// Where this server signs people in, as it says itself.
		if (url.pathname === "/.well-known/oauth-authorization-server/api/auth")
			return Response.json({
				issuer: `${origin}/api/auth`,
				authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
				token_endpoint: `${origin}/api/auth/oauth2/token`,
				revocation_endpoint: `${origin}/api/auth/oauth2/revoke`,
			});
		if (url.pathname === "/api/auth/oauth2/token") {
			const body = new URLSearchParams(String(init?.body ?? ""));
			if (body.get("grant_type") === "authorization_code") {
				const person = /^code-(.+)$/.exec(body.get("code") ?? "")?.[1];
				if (person === undefined || people[person] === undefined)
					return Response.json({ error: "invalid_grant" }, { status: 400 });
				return Response.json(issue(person));
			}
			const old = body.get("refresh_token") ?? "";
			const person = state.refresh.get(old);
			if (person === undefined)
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			state.refresh.delete(old);
			return Response.json(issue(person));
		}
		if (url.pathname === "/api/auth/oauth2/revoke") {
			// Only the extension's own refresh token that still holds ends a
			// grant: nothing is ended on anybody's say-so.
			const body = new URLSearchParams(String(init?.body ?? ""));
			const token = body.get("token") ?? "";
			if (
				body.get("client_id") !== "sitegloss-extension" ||
				!state.refresh.has(token)
			)
				return Response.json({ error: "invalid_request" }, { status: 400 });
			state.revoked.push(token);
			state.refresh.delete(token);
			return Response.json({});
		}
		const broken = state.broken?.(`${method} ${url.pathname}`);
		if (broken !== undefined) return broken;
		const bearer = new Headers(init?.headers).get("authorization") ?? "";
		const person = state.access.get(bearer.replace(/^Bearer /, ""));
		const user = person === undefined ? undefined : people[person];
		if (user === undefined || state.expired)
			return no(401, "unauthorized", "Sign in, or send an access token.");
		const api = server.api(user);
		api.permissions = state.permissions;
		if (url.pathname === "/api/v1/me") return Response.json(await api.me());
		const one = /^\/api\/v1\/teams\/([^/]+)\/cases\/([^/]+)$/.exec(
			url.pathname,
		);
		if (one !== null && one[1] === TEAM) {
			const detail = await api.getCase(TEAM, decodeURIComponent(one[2] ?? ""));
			return detail === undefined
				? no(404, "not_found", "No such case.")
				: Response.json(detail);
		}
		const route =
			/^\/api\/v1\/teams\/([^/]+)\/(changes|ops|blobs|members)(?:\/([0-9a-f]+))?$/.exec(
				url.pathname,
			);
		if (route === null || route[1] !== TEAM)
			return no(404, "not_found", "No such team.");
		const [, , what, sha = ""] = route;
		if (what === "changes") {
			const since = url.searchParams.get("since");
			const limit = url.searchParams.get("limit");
			return Response.json(
				await api.changes(
					TEAM,
					since === null ? undefined : Number(since),
					limit === null ? undefined : Number(limit),
				),
			);
		}
		if (what === "members") {
			const members = await api.members(TEAM);
			return members === undefined
				? no(404, "not_found", "Not found.")
				: Response.json({ members });
		}
		if (what === "ops") {
			const body = JSON.parse(String(init?.body)) as { ops: Op[] };
			return Response.json(await api.ops(TEAM, body.ops));
		}
		if (method === "HEAD")
			return new Response(null, {
				status: (await api.hasBlob(TEAM, sha)) ? 200 : 404,
			});
		if (method === "PUT") {
			await api.putBlob(TEAM, sha, init?.body as Blob);
			return Response.json({ sha256: sha });
		}
		return server.blobs.has(sha)
			? new Response(await api.getBlob(TEAM, sha))
			: no(404, "not_found", "No such image.");
	}
	return { fetch: fetcher, state };
}
