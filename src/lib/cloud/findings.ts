/**
 * The sync's side of findings becoming comments (DEC-081). The store's
 * upgrade (store.ts) made each finding a comment on its mark, its id made
 * from the mark's id here (`findingCommentId`). For a mark the server has,
 * the server makes its own comment of the same finding, its id made from
 * the mark's id there. This brings the two together, once per server, before
 * the sync runs again (`casesReady` in worker/cloud.ts):
 *
 * - In the case here, a comment made of a finding the server had (the
 *   shadow says so) or was sent (it waits in the queue) takes the server's
 *   id. The same finding is then one comment here and there.
 * - In the shadow, the findings the server had become the comments the
 *   server makes of them: the same ids, the same texts, the same person. The
 *   comment sync does the rest as for any comment: one unchanged here is
 *   what the server has; one changed here goes as an edit; one deleted here
 *   goes as a delete; one the server never had goes as a new comment.
 * - What waits in the queue is sent without its findings: their comments go
 *   as comments. An operation left with nothing else goes.
 *
 * A case here is changed before its book, so a run cut short is run again
 * and finds the case done and the book not.
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
	type ShadowComment,
} from "./book.ts";

/** The marker that this database's findings are comments, set once (not per server). */
export const FINDINGS_KEY = "findings";
export const FINDINGS = "comments";

/** A finding as a book or an operation of before DEC-081 holds it. */
interface WasFinding {
	id: string;
	text: string;
	user?: { id: string } | null;
}

const findingsIn = (value: unknown): WasFinding[] =>
	Array.isArray(value)
		? (value as WasFinding[]).filter(
				(f) =>
					f !== null &&
					typeof f === "object" &&
					typeof f.id === "string" &&
					typeof f.text === "string",
			)
		: [];

/** The findings the server had of each of the case's marks, by the mark's id there. */
function shadowFindings(book: CaseBook): [string, WasFinding][] {
	return Object.entries(book.shadow?.marks ?? {}).flatMap(([there, mark]) =>
		findingsIn((mark.content as { findings?: unknown }).findings).map(
			(f): [string, WasFinding] => [there, f],
		),
	);
}

/** The findings the queue was to send, by their mark's id at the server. */
function queuedFindings(ops: readonly Op[]): [string, WasFinding][] {
	return ops.flatMap((op): [string, WasFinding][] => {
		const o = op as unknown as Record<string, unknown>;
		if (op.type === "mark.create") {
			const mark = o["mark"] as { id: string; findings?: unknown };
			return findingsIn(mark.findings).map((f) => [mark.id, f]);
		}
		if (op.type === "mark.patch") {
			const change = o["findings"] as { upsert?: unknown } | undefined;
			return findingsIn(change?.upsert).map((f) => [op.markId, f]);
		}
		return [];
	});
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

/** The case with the comments of these findings under the server's ids. */
function withServerIds(
	c: Case,
	book: CaseBook,
	findings: readonly [string, WasFinding][],
): Case {
	const here = new Map(
		Object.entries(book.marks).map(([local, there]) => [there, local]),
	);
	const rename = new Map<string, string>();
	for (const [there, f] of findings) {
		const local = here.get(there);
		if (local !== undefined)
			rename.set(findingCommentId(local, f.id), findingCommentId(there, f.id));
	}
	const ids = new Set((c.comments ?? []).map((k) => k.id));
	let changed = false;
	const comments = (c.comments ?? []).map((k) => {
		const to = rename.get(k.id);
		if (to === undefined || ids.has(to)) return k;
		changed = true;
		return { ...k, id: to };
	});
	return changed ? { ...c, comments } : c;
}

/**
 * Every server's books in the cloud's database (`kv`, not scoped), once:
 * `current` is the server the cases sync with now. Then the marker, so it
 * never runs again.
 */
export async function findingsIntoThreadsOnce(
	store: CaseStore,
	kv: Kv,
	server: string,
	scoped: (server: string) => Kv,
): Promise<void> {
	if ((await kv.get(FINDINGS_KEY)) === FINDINGS) return;
	const servers = new Set<string>();
	for (const key of Object.keys(await kv.all())) {
		const at = key.indexOf(` ${BOOK}`);
		if (key.startsWith("@") && at > 0) servers.add(key.slice(1, at));
	}
	for (const other of servers)
		await findingsIntoThreads(store, scoped(other), other === server);
	await kv.set({ [FINDINGS_KEY]: FINDINGS });
}

/**
 * One server's books (`kv`, that server's part of the database) and the
 * cases they are for. `current`: the server the cases sync with now. For
 * another one only the findings go from its books and its queue: the cases
 * here follow the current server's ids, and a shadow of another server that
 * said it had comments the case lacks would delete them there.
 */
export async function findingsIntoThreads(
	store: CaseStore,
	kv: Kv,
	current: boolean,
): Promise<void> {
	const all = await kv.all();
	const queue = all[KEYS.queue] as Queue | undefined;
	for (const [key, value] of Object.entries(all)) {
		if (!key.startsWith(BOOK)) continue;
		const book = value as CaseBook;
		const queued = queue?.caseId === book.caseId ? queue.ops : [];
		const had = shadowFindings(book);
		const sent = queuedFindings(queued);
		const holds = Object.values(book.shadow?.marks ?? {}).some(
			(mark) => "findings" in mark.content,
		);
		if (!holds && sent.length === 0) continue;
		if (current && (await store.getCase(book.caseId)) !== undefined)
			await store.updateCase(book.caseId, (c) => {
				if (c === undefined) throw new Error("the case went meanwhile");
				return { value: withServerIds(c, book, [...had, ...sent]) };
			});
		const next: CaseBook = structuredClone(book);
		if (next.shadow !== undefined) {
			for (const mark of Object.values(next.shadow.marks))
				delete (mark.content as { findings?: unknown }).findings;
			if (current && next.shadow.comments !== undefined)
				for (const [there, f] of had) {
					const id = findingCommentId(there, f.id);
					if (f.text.trim() === "" || next.shadow.comments[id] !== undefined)
						continue;
					const comment: ShadowComment = {
						text: f.text,
						...(f.user ? { userId: f.user.id } : {}),
					};
					next.shadow.comments[id] = comment;
				}
		}
		const entries: Record<string, unknown> = { [key]: next };
		if (queued.length > 0 && queue !== undefined) {
			const ops = queued.flatMap((op) => withoutFindings(op) ?? []);
			entries[KEYS.queue] = { ...queue, ops };
		}
		await kv.set(entries);
	}
}
