/**
 * Where cases and their images live: IndexedDB in the extension's origin,
 * shared by the service worker and the side panel (database `sitegloss`, stores
 * `cases` and `images`). `MemoryStore` is the same for tests.
 */

import { type Case, findingsAsComments, imageKey } from "./case.ts";
import { debugLog } from "./debug.ts";

/**
 * The database's version. 1: the stores. 2 (DEC-051): the case format
 * `sitegloss/2`. The upgrade to it empties both stores (the cases, their
 * images, the delete records and the screenshots of saves that never
 * finished), in the upgrade itself: no case of the old format is ever read,
 * and none is converted. The sync's bookkeeping goes with them
 * (`forgetCases` in cloud/book.ts), so a team's cases come back from the
 * server whole. A case that was only in this browser is gone (the owner's
 * decision). A build before this one cannot open version 2.
 *
 * 3 (DEC-081): the marks' findings are comments on them. The upgrade from 2
 * rewrites each stored case that has findings (`upgradedCase`), in the
 * upgrade's own transaction: every case converted, or (a failure aborts it)
 * none, and the database stays at version 2 for the next open to try again.
 * A case the conversion cannot read is kept as it was. A build before this
 * one cannot open version 3.
 */
export const DB_VERSION = 3;

/**
 * What the upgrade to version 3 makes of a stored case (DEC-081): its
 * findings as comments on their marks (`findingsAsComments`); `undefined`
 * when nothing changes, or when the case cannot be read (it stays as it
 * was, its findings shown nowhere but kept).
 */
export function upgradedCase(stored: unknown): unknown {
	try {
		const next = findingsAsComments(stored);
		return next === stored ? undefined : next;
	} catch (error) {
		debugLog("case upgrade", error);
		return undefined;
	}
}

export interface StoredImage {
	blob: Blob;
	/** Pixels. */
	width: number;
	height: number;
	/** For a screenshot waiting for its save: when it was taken (ms since the epoch). */
	storedAt?: number;
}

/**
 * A mark's screenshot waits under a pending path until the marks are saved,
 * which can be days in a tab left open; after that it counts as abandoned.
 */
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const isPendingKey = (key: string) => key.includes("/pending/");

/**
 * The record of a deleted case is kept beside its images' keys, under a key
 * no case's images can have ("!" is in no case id): in the store every
 * delete already writes in the same transaction, and without a new version
 * of the database (which an older build could not open any more).
 */
const DELETED = "!deleted/";
const deletedKey = (caseId: string) => `${DELETED}${caseId}`;
const deletedRange = () => IDBKeyRange.bound(DELETED, `${DELETED}￿`);

/**
 * How long a delete stays on record: whoever syncs takes it up long before
 * (and forgets it after this too). Each record written takes the older ones
 * away, so they do not pile up for someone who never signs in.
 */
export const DELETED_KEPT_MS = 30 * 24 * 3600_000;

/** Take records older than `DELETED_KEPT_MS` away, in the caller's transaction. */
function pruneDeleted(images: IDBObjectStore, now: number): void {
	const walk = images.openCursor(deletedRange());
	walk.onsuccess = () => {
		const at = walk.result;
		if (at === null) return;
		const when = Number((at.value as { deletedAt?: unknown })?.deletedAt) || 0;
		if (now - when > DELETED_KEPT_MS) at.delete();
		at.continue();
	};
}

/** A case deleted here by the user (or an AI app for them), and when (ms). */
export interface DeletedCase {
	id: string;
	at: number;
}

export interface CaseStore {
	/** The store's version, once it is open (and upgraded): `DB_VERSION`. */
	version(): Promise<number>;
	/** All cases, newest change first. */
	listCases(): Promise<Case[]>;
	getCase(id: string): Promise<Case | undefined>;
	/**
	 * Deletes the case and its images, and records the delete in the same
	 * transaction (`deletedCases`): whoever syncs cases elsewhere tells by it
	 * a case the user deleted from one that is merely not here (a lost
	 * database), without the deleter knowing of any sync. `quiet`: no
	 * record (the case goes because it was deleted elsewhere).
	 */
	deleteCase(id: string, quiet?: boolean): Promise<void>;
	/** The deletes on record; a case stored again under its id takes its record away. */
	deletedCases(): Promise<DeletedCase[]>;
	/** Take records away: nobody needs them any more. */
	forgetDeleted(ids: readonly string[]): Promise<void>;
	/**
	 * Deletes the case and its images only if `when` holds for it as it is
	 * stored, in one transaction: a writer between a read and the delete (an
	 * AI app adding a mark) is never lost. Answers whether it was deleted.
	 */
	deleteCaseIf(id: string, when: (c: Case) => boolean): Promise<boolean>;
	getImage(caseId: string, path: string): Promise<StoredImage | undefined>;
	putImage(caseId: string, path: string, image: StoredImage): Promise<void>;
	/**
	 * Read a case, change it and write it back in one transaction, so a
	 * concurrent writer (the side panel, another tab) is never overwritten.
	 * `change` runs synchronously inside the transaction and gets `undefined`
	 * for a missing case; throwing aborts everything. The images it returns
	 * are written in the same transaction.
	 */
	updateCase(id: string, change: CaseChange): Promise<Case>;
	/** Deletes these images of the case. */
	deleteImages(caseId: string, paths: readonly string[]): Promise<void>;
	/**
	 * Deletes screenshots of saves that never finished (the tab closed while
	 * saving): pending images stored before `before` (ms), or undated.
	 * Returns how many.
	 */
	sweepPending(before: number): Promise<number>;
	/**
	 * Replace a case and all its images at once (an import): either the new
	 * case and images are stored, or the old ones are kept.
	 */
	replaceCase(
		value: Case,
		images: ReadonlyMap<string, StoredImage>,
	): Promise<void>;
}

export type CaseChange = (current: Case | undefined) => {
	value: Case;
	/** Images to write with the case, by path. */
	images?: ReadonlyMap<string, StoredImage>;
	/** Images to delete with it: a later save may take a freed path. */
	deleteImages?: readonly string[];
};

function checkId(id: string, value: Case): void {
	if (value.id !== id)
		throw new Error(`updateCase: case ${id} cannot become ${value.id}`);
}

const byUpdate = (a: Case, b: Case) => b.updatedAt.localeCompare(a.updatedAt);

export class MemoryStore implements CaseStore {
	readonly cases = new Map<string, Case>();
	readonly images = new Map<string, StoredImage>();
	/** The deletes on record: case id to when. */
	readonly deleted = new Map<string, number>();

	async version(): Promise<number> {
		return DB_VERSION;
	}

	async listCases(): Promise<Case[]> {
		return [...this.cases.values()]
			.map((c) => structuredClone(c))
			.sort(byUpdate);
	}

	async getCase(id: string): Promise<Case | undefined> {
		const found = this.cases.get(id);
		return found === undefined ? undefined : structuredClone(found);
	}

	async deleteCase(id: string, quiet = false): Promise<void> {
		this.cases.delete(id);
		for (const key of [...this.images.keys()])
			if (key.startsWith(`${id}/`)) this.images.delete(key);
		// Also of a case that was not there: whoever asked meant it gone.
		if (!quiet) this.#record(id);
	}

	/** A delete on record, and the records too old to keep gone. */
	#record(id: string): void {
		const now = Date.now();
		for (const [other, at] of [...this.deleted])
			if (now - at > DELETED_KEPT_MS) this.deleted.delete(other);
		this.deleted.set(id, now);
	}

	async deletedCases(): Promise<DeletedCase[]> {
		return [...this.deleted].map(([id, at]) => ({ id, at }));
	}

	async forgetDeleted(ids: readonly string[]): Promise<void> {
		for (const id of ids) this.deleted.delete(id);
	}

	async deleteCaseIf(id: string, when: (c: Case) => boolean): Promise<boolean> {
		const found = this.cases.get(id);
		if (found === undefined || !when(structuredClone(found))) return false;
		await this.deleteCase(id);
		return true;
	}

	async getImage(
		caseId: string,
		path: string,
	): Promise<StoredImage | undefined> {
		return this.images.get(imageKey(caseId, path));
	}

	async putImage(
		caseId: string,
		path: string,
		image: StoredImage,
	): Promise<void> {
		this.images.set(imageKey(caseId, path), image);
	}

	async updateCase(id: string, change: CaseChange): Promise<Case> {
		const current = this.cases.get(id);
		const { value, images, deleteImages } = change(
			current === undefined ? undefined : structuredClone(current),
		);
		checkId(id, value);
		const copy = structuredClone({ value, images }); // a failure changes nothing
		this.cases.set(id, copy.value);
		this.deleted.delete(id);
		for (const path of deleteImages ?? [])
			this.images.delete(imageKey(id, path));
		for (const [path, image] of copy.images ?? [])
			this.images.set(imageKey(id, path), image);
		return structuredClone(value);
	}

	async deleteImages(caseId: string, paths: readonly string[]): Promise<void> {
		for (const path of paths) this.images.delete(imageKey(caseId, path));
	}

	async sweepPending(before: number): Promise<number> {
		let swept = 0;
		for (const [key, image] of [...this.images]) {
			if (isPendingKey(key) && (image.storedAt ?? 0) < before) {
				this.images.delete(key);
				swept++;
			}
		}
		return swept;
	}

	async replaceCase(
		value: Case,
		images: ReadonlyMap<string, StoredImage>,
	): Promise<void> {
		const copy = structuredClone({ value, images }); // a failure changes nothing
		await this.deleteCase(value.id, true);
		this.deleted.delete(value.id);
		for (const [path, image] of copy.images)
			this.images.set(imageKey(value.id, path), image);
		this.cases.set(value.id, copy.value);
	}
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
	});
}

const prefixRange = (caseId: string) =>
	IDBKeyRange.bound(`${caseId}/`, `${caseId}/￿`);

/**
 * How long an open waits while an older version's connection holds the
 * database (`onblocked`) before it gives up with `StoreBlockedError`.
 */
export const BLOCKED_WAIT_MS = 5000;

/**
 * The database could not be opened: a connection of the build before this
 * one (a page or worker of it that is still running) holds it at its old
 * version, so the upgrade cannot run yet. Nothing was read or changed; the
 * upgrade runs by itself once that connection goes, and the next call opens
 * the database then.
 */
export class StoreBlockedError extends Error {
	constructor() {
		super(
			"Sitegloss cannot open its cases yet: a window of the version before this update still has them open. Close Sitegloss's pages and side panels, or restart the browser, then try again.",
		);
		this.name = "StoreBlockedError";
	}
}

/** After a failed open, how long every call fails at once with the same error. */
export const RETRY_AFTER_MS = 10_000;

/**
 * The database could not be opened or upgraded (IndexedDB's error, by its
 * name only). A failed upgrade changes nothing: the database stays as it was.
 */
export class StoreOpenError extends Error {
	constructor(reason: string) {
		super(
			`Sitegloss could not open its cases (${reason}). Nothing in them was changed; it tries again in a moment.`,
		);
		this.name = "StoreOpenError";
	}
}

export class IdbStore implements CaseStore {
	/** The open connection. */
	#db: IDBDatabase | undefined;
	/**
	 * The one open request under way, and whether it got anywhere (its
	 * upgrade began, or it succeeded): every call waits on it, none makes
	 * another. It may wait long (another connection holds the database); a
	 * call waits for it at most `#blockedWaitMs`.
	 */
	#opening: { done: Promise<IDBDatabase>; moved: () => boolean } | undefined;
	/** The last open that failed, and until when that is the answer. */
	#failed: { error: Error; until: number } | undefined;
	readonly #blockedWaitMs: number;
	readonly #retryAfterMs: number;

	constructor(options: { blockedWaitMs?: number; retryAfterMs?: number } = {}) {
		this.#blockedWaitMs = options.blockedWaitMs ?? BLOCKED_WAIT_MS;
		this.#retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
	}

	/**
	 * An open failed: said once in the console (the error's name, nothing of
	 * the cases), and for `#retryAfterMs` every call (the panel's list, the
	 * folder sync, the cloud sync) gets the same error without waiting again.
	 */
	#fail(error: Error): Error {
		console.error(`Sitegloss: ${error.name}: ${error.message}`);
		this.#failed = { error, until: Date.now() + this.#retryAfterMs };
		return error;
	}

	async version(): Promise<number> {
		return (await this.#open()).version;
	}

	/**
	 * The database, opened (and made or upgraded). As the settings' database
	 * (`kv.ts`): a connection Chrome closes (`onclose`) or another context's
	 * upgrade or delete asks to close (`onversionchange`, which it does) is
	 * forgotten, and the next call opens the database again.
	 *
	 * An open that another connection holds up (the build before this one,
	 * still running; IndexedDB fires `blocked` only for the first request in
	 * line, the others just wait) gets nowhere: a call then fails with
	 * `StoreBlockedError` after `#blockedWaitMs` instead of waiting for ever.
	 * Its request stays and is the one every later call waits on, so the
	 * upgrade runs once that connection goes, and no request piles up.
	 */
	#open(): Promise<IDBDatabase> {
		if (this.#db !== undefined) return Promise.resolve(this.#db);
		const failed = this.#failed;
		if (failed !== undefined && Date.now() < failed.until)
			return Promise.reject(failed.error);
		this.#opening ??= this.#request();
		const { done, moved } = this.#opening;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				// An upgrade under way is waited for: it ends on its own.
				if (!moved()) reject(this.#fail(new StoreBlockedError()));
			}, this.#blockedWaitMs);
			done.then(
				(db) => {
					clearTimeout(timer);
					resolve(db);
				},
				(error: unknown) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}

	#request(): { done: Promise<IDBDatabase>; moved: () => boolean } {
		let moved = false;
		const done = new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open("sitegloss", DB_VERSION);
			req.onupgradeneeded = (event) => {
				moved = true;
				if (event.oldVersion < 1) {
					req.result.createObjectStore("cases", { keyPath: "id" });
					req.result.createObjectStore("images");
					return;
				}
				// In the upgrade's own transaction: both stores emptied, or (a
				// failure aborts it) the database stays as it was, at its old
				// version, and nothing opens it.
				const tx = req.transaction as IDBTransaction;
				if (event.oldVersion < 2) {
					tx.objectStore("cases").clear();
					tx.objectStore("images").clear();
					return;
				}
				// From version 2: findings become comments (DEC-081), in this
				// transaction too: all cases, or none and version 2 stays.
				const walk = tx.objectStore("cases").openCursor();
				walk.onsuccess = () => {
					const at = walk.result;
					if (at === null) return;
					const next = upgradedCase(at.value);
					if (next !== undefined) at.update(next);
					at.continue();
				};
			};
			req.onsuccess = () => {
				moved = true;
				const db = req.result;
				const forget = () => {
					if (this.#db === db) this.#db = undefined;
				};
				db.onclose = forget;
				db.onversionchange = () => {
					db.close();
					forget();
				};
				this.#db = db;
				this.#opening = undefined;
				this.#failed = undefined;
				resolve(db);
			};
			req.onerror = () => {
				this.#opening = undefined;
				reject(this.#fail(new StoreOpenError(req.error?.name ?? "unknown")));
			};
		});
		// Nobody may be waiting when it ends.
		done.catch(() => {});
		return { done, moved: () => moved };
	}

	async listCases(): Promise<Case[]> {
		const db = await this.#open();
		const cases = await request(
			db.transaction("cases").objectStore("cases").getAll(),
		);
		return (cases as Case[]).sort(byUpdate);
	}

	async getCase(id: string): Promise<Case | undefined> {
		const db = await this.#open();
		return (await request(
			db.transaction("cases").objectStore("cases").get(id),
		)) as Case | undefined;
	}

	async deleteCase(id: string, quiet = false): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(["cases", "images"], "readwrite");
		tx.objectStore("cases").delete(id);
		const images = tx.objectStore("images");
		images.delete(prefixRange(id));
		// In this transaction: the delete and its record, or neither.
		if (!quiet) {
			const now = Date.now();
			images.put({ deletedAt: now }, deletedKey(id));
			pruneDeleted(images, now);
		}
		await done(tx);
	}

	async deletedCases(): Promise<DeletedCase[]> {
		const db = await this.#open();
		const store = db.transaction("images").objectStore("images");
		const range = deletedRange();
		const [keys, values] = await Promise.all([
			request(store.getAllKeys(range)),
			request(store.getAll(range)),
		]);
		return (keys as string[]).map((key, i) => ({
			id: key.slice(DELETED.length),
			at: Number((values[i] as { deletedAt?: unknown })?.deletedAt) || 0,
		}));
	}

	async forgetDeleted(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return;
		const db = await this.#open();
		const tx = db.transaction("images", "readwrite");
		for (const id of ids) tx.objectStore("images").delete(deletedKey(id));
		await done(tx);
	}

	async deleteCaseIf(id: string, when: (c: Case) => boolean): Promise<boolean> {
		const db = await this.#open();
		const tx = db.transaction(["cases", "images"], "readwrite");
		const cases = tx.objectStore("cases");
		let deleted = false;
		let failure: unknown;
		const read = cases.get(id);
		read.onsuccess = () => {
			try {
				const found = read.result as Case | undefined;
				if (found === undefined || !when(found)) return;
				cases.delete(id);
				const images = tx.objectStore("images");
				images.delete(prefixRange(id));
				const now = Date.now();
				images.put({ deletedAt: now }, deletedKey(id));
				pruneDeleted(images, now);
				deleted = true;
			} catch (error) {
				failure = error;
				tx.abort();
			}
		};
		try {
			await done(tx);
		} catch (error) {
			throw failure ?? error;
		}
		return deleted;
	}

	async getImage(
		caseId: string,
		path: string,
	): Promise<StoredImage | undefined> {
		const db = await this.#open();
		return (await request(
			db
				.transaction("images")
				.objectStore("images")
				.get(imageKey(caseId, path)),
		)) as StoredImage | undefined;
	}

	async putImage(
		caseId: string,
		path: string,
		image: StoredImage,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction("images", "readwrite");
		tx.objectStore("images").put(image, imageKey(caseId, path));
		await done(tx);
	}

	async updateCase(id: string, change: CaseChange): Promise<Case> {
		const db = await this.#open();
		const tx = db.transaction(["cases", "images"], "readwrite");
		const cases = tx.objectStore("cases");
		let result: Case | undefined;
		let failure: unknown;
		const read = cases.get(id);
		read.onsuccess = () => {
			try {
				const { value, images, deleteImages } = change(
					read.result as Case | undefined,
				);
				checkId(id, value);
				cases.put(value);
				const store = tx.objectStore("images");
				// It is here (again): no delete of it is on record.
				store.delete(deletedKey(id));
				for (const path of deleteImages ?? []) store.delete(imageKey(id, path));
				for (const [path, image] of images ?? [])
					store.put(image, imageKey(id, path));
				result = value;
			} catch (error) {
				failure = error;
				tx.abort();
			}
		};
		try {
			await done(tx);
		} catch (error) {
			throw failure ?? error;
		}
		if (result === undefined) throw failure ?? new Error("case not written");
		return result;
	}

	async deleteImages(caseId: string, paths: readonly string[]): Promise<void> {
		if (paths.length === 0) return;
		const db = await this.#open();
		const tx = db.transaction("images", "readwrite");
		const store = tx.objectStore("images");
		for (const path of paths) store.delete(imageKey(caseId, path));
		await done(tx);
	}

	async sweepPending(before: number): Promise<number> {
		const db = await this.#open();
		// Keys only: reading every image would hold up the store at each worker start.
		const keys = (await request(
			db.transaction("images").objectStore("images").getAllKeys(),
		)) as string[];
		const pending = keys.filter(isPendingKey);
		if (pending.length === 0) return 0;
		const tx = db.transaction("images", "readwrite");
		const store = tx.objectStore("images");
		let swept = 0;
		for (const key of pending) {
			const read = store.get(key);
			read.onsuccess = () => {
				const image = read.result as StoredImage | undefined;
				if (image !== undefined && (image.storedAt ?? 0) < before) {
					store.delete(key);
					swept++;
				}
			};
		}
		await done(tx);
		return swept;
	}

	async replaceCase(
		value: Case,
		images: ReadonlyMap<string, StoredImage>,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(["cases", "images"], "readwrite");
		try {
			const store = tx.objectStore("images");
			store.delete(prefixRange(value.id));
			store.delete(deletedKey(value.id));
			for (const [path, image] of images)
				store.put(image, imageKey(value.id, path));
			tx.objectStore("cases").put(value);
		} catch (error) {
			// Left alone, the transaction would commit what was asked of it so far.
			tx.abort();
			throw error;
		}
		await done(tx);
	}
}
