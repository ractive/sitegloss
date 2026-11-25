/**
 * The sync's side of findings becoming comments (DEC-081). The store's
 * upgrade (store.ts) made each finding of a mark a comment on it in this
 * browser (`findingsAsComments`, with ids made from the ids here). For a case
 * that syncs with a team, the server owns the findings it has: it turns them
 * into comments itself, and those come with the ordinary sync. So once,
 * before the sync runs again (`casesReady` in worker/cloud.ts):
 *
 * - A finding the shadow of a case's book says its server has, in a book
 *   that syncs (`mode` synced) with the team the account signed in to that
 *   server has chosen now, is removed here: its comment, or the finding
 *   itself where it was left on its mark. No comment is made for it on this
 *   side.
 * - A finding the server never confirmed stays the comment the upgrade made,
 *   which the comment sync sends once as a new comment. One that waited in
 *   the queue counts as such: the queued operation goes without its findings
 *   (a `mark.patch` left with nothing else goes), and the comment instead.
 * - Every book, of every server, loses its findings, shadow and queue, with
 *   nothing written in their place.
 *
 * A case is changed before its book, so a run cut short finds the case done
 * the next time. A case that fails is passed by and said in the console (its
 * id and the error's name), its books keep their findings (its queue loses
 * them all the same), and the marker stays unset: the next start of the sync
 * runs it all again, and the sync is not held up by it meanwhile.
 */

import { type Case, findingCommentId } from "../case.ts";
import type { Kv } from "../kv.ts";
import type { CaseStore } from "../store.ts";
import type { Op } from "./api.ts";
import {
	BOOK,
	type CaseBook,
	KEYS,
	type Queue,
	readAccount,
	teamOf,
} from "./book.ts";

/** The marker that this database's findings are dealt with, set once (not per server). */
export const FINDINGS_KEY = "findings";
export const FINDINGS = "comments";

/** A finding as a book of before DEC-081 holds it. */
interface WasFinding {
	id: string;
}

const findingIds = (value: unknown): string[] =>
	Array.isArray(value)
		? value.flatMap((f) =>
				f !== null &&
				typeof f === "object" &&
				typeof (f as WasFinding).id === "string"
					? [(f as WasFinding).id]
					: [],
			)
		: [];

/**
 * The findings the server has of a case, by the mark's id here and the
 * finding's id: only of a book that syncs with the team the account signed in
 * to that server has chosen now (`team`), whose sync will bring the server's
 * comments. Any other book: none, and the comments stay here.
 */
function serverHas(
	book: CaseBook,
	team: string | undefined,
): [string, string][] {
	if (
		team === undefined ||
		book.mode !== "synced" ||
		book.teamId !== team ||
		book.shadow === undefined
	)
		return [];
	const here = new Map(
		Object.entries(book.marks).map(([local, there]) => [there, local]),
	);
	return Object.entries(book.shadow.marks).flatMap(([there, mark]) => {
		const local = here.get(there);
		return local === undefined
			? []
			: findingIds((mark.content as { findings?: unknown }).findings).map(
					(id): [string, string] => [local, id],
				);
	});
}

/** The case without the comments (or left-over findings) of findings its server owns. */
function withoutServers(c: Case, owned: readonly [string, string][]): Case {
	if (owned.length === 0) return c;
	const comments = new Set(
		owned.map(([mark, id]) => findingCommentId(mark, id)),
	);
	const byMark = new Map<string, Set<string>>();
	for (const [mark, id] of owned)
		byMark.set(mark, (byMark.get(mark) ?? new Set()).add(id));
	const thread = (c.comments ?? []).filter((k) => !comments.has(k.id));
	return {
		...c,
		comments: thread,
		marks: c.marks.map((a) => {
			const ids = byMark.get(a.id);
			if (ids === undefined || a.findings === undefined) return a;
			const kept = a.findings.filter(
				(f) => !ids.has((f as WasFinding | null)?.id ?? ""),
			);
			const { findings: _f, ...rest } = a;
			return kept.length > 0 ? { ...rest, findings: kept } : rest;
		}),
	};
}

/** An operation without its findings; none when nothing else was in it. */
function withoutFindings(op: Op): Op | undefined {
	const o = op as unknown as Record<string, unknown>;
	if (op.type === "mark.create" && "findings" in op.mark) {
		const { findings: _f, ...mark } = op.mark as Record<string, unknown>;
		return { ...op, mark } as Op;
	}
	if (op.type === "mark.patch" && "findings" in o) {
		const { findings: _f, ...rest } = o;
		const said = Object.keys(rest).filter(
			(key) => !["opId", "type", "markId", "via"].includes(key),
		);
		return said.length === 0 ? undefined : (rest as unknown as Op);
	}
	return op;
}

/** A book without findings in its shadow. */
function bookWithout(book: CaseBook): CaseBook {
	const next = structuredClone(book);
	for (const mark of Object.values(next.shadow?.marks ?? {}))
		delete (mark.content as { findings?: unknown }).findings;
	return next;
}

/**
 * Every server's books in the cloud's database (`kv`, not scoped; `scoped`
 * gives one server's part), once: the cases first, then the books and
 * queues. Answers whether all went; then the marker is set.
 */
export async function findingsIntoThreadsOnce(
	store: CaseStore,
	kv: Kv,
	scoped: (server: string) => Kv,
): Promise<boolean> {
	if ((await kv.get(FINDINGS_KEY)) === FINDINGS) return true;
	const servers = new Set<string>();
	for (const key of Object.keys(await kv.all())) {
		const at = key.indexOf(` ${BOOK}`);
		const own = key.indexOf(` ${KEYS.queue}`);
		if (key.startsWith("@") && at > 0) servers.add(key.slice(1, at));
		if (key.startsWith("@") && own > 0) servers.add(key.slice(1, own));
	}
	const whole = await findingsOutOfBooks(
		store,
		[...servers].map((server) => scoped(server)),
	);
	if (whole) await kv.set({ [FINDINGS_KEY]: FINDINGS });
	return whole;
}

/**
 * The rule for the cases and books of these servers' parts of the database
 * (`parts`, each one server's): the findings a server that the case syncs
 * with has go from the case here, and every book and queue loses its
 * findings. Answers whether every case went.
 */
export async function findingsOutOfBooks(
	store: CaseStore,
	parts: readonly Kv[],
): Promise<boolean> {
	let whole = true;
	const failed = new Set<string>();
	// The cases: what any server that the case syncs with has, goes here.
	const owned = new Map<string, [string, string][]>();
	for (const part of parts) {
		// Signed in, not run out, a team chosen and still among the account's.
		const account = await readAccount(part);
		const team =
			account !== undefined && account.expired !== true
				? teamOf(account)?.id
				: undefined;
		for (const [key, value] of Object.entries(await part.all()))
			if (key.startsWith(BOOK)) {
				const book = value as CaseBook;
				owned.set(book.caseId, [
					...(owned.get(book.caseId) ?? []),
					...serverHas(book, team),
				]);
			}
	}
	for (const [caseId, findings] of owned) {
		if (findings.length === 0) continue;
		try {
			if ((await store.getCase(caseId)) !== undefined)
				await store.updateCase(caseId, (c) => {
					if (c === undefined) throw new Error("the case went meanwhile");
					return { value: withoutServers(c, findings) };
				});
		} catch (error) {
			whole = false;
			failed.add(caseId);
			console.warn(
				`Sitegloss: the findings of case ${caseId} could not be brought along (${error instanceof Error ? error.name : "unknown"}); it is tried again at the next start.`,
			);
		}
	}
	// The books and the queues: no findings left in them.
	for (const part of parts) {
		const all = await part.all();
		const queue = all[KEYS.queue] as Queue | undefined;
		const entries: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(all))
			if (
				key.startsWith(BOOK) &&
				!failed.has((value as CaseBook).caseId) &&
				Object.values((value as CaseBook).shadow?.marks ?? {}).some(
					(mark) => "findings" in mark.content,
				)
			)
				entries[key] = bookWithout(value as CaseBook);
		// Also a failed case's: what waits to be sent never carries findings.
		if (queue !== undefined)
			entries[KEYS.queue] = {
				...queue,
				ops: queue.ops.flatMap((op) => withoutFindings(op) ?? []),
			};
		try {
			if (Object.keys(entries).length > 0) await part.set(entries);
		} catch (error) {
			whole = false;
			console.warn(
				`Sitegloss: a sync's bookkeeping could not be freed of findings (${error instanceof Error ? error.name : "unknown"}); it is tried again at the next start.`,
			);
		}
	}
	return whole;
}
