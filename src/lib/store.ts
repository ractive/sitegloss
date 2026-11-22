/**
 * Where cases and their images live: IndexedDB in the extension's origin,
 * shared by the service worker and the side panel (database `sitegloss`, stores
 * `cases` and `images`). `MemoryStore` is the same for tests.
 */

import { CASE_FORMAT, type Case, imageKey, OLD_CASE_FORMAT } from "./case.ts";

/**
 * The database's version. 1: the stores. 2 (DEC-051): every case stored by
 * Sitegloss 0.3.1 or older brought to `sitegloss/2` (`upgradeStoredCase`), in
 * the upgrade itself, so nothing here ever reads a case of the old format.
 * A build before it cannot open the database any more: it would read no
 * marks in a case of the new format.
 */
export const DB_VERSION = 2;

/** The key a case of `sitegloss/1` kept its marks under. */
const OLD_MARKS_KEY = "annotations";

/**
 * A case as Sitegloss 0.3.1 and older stored it (`sitegloss/1`) in the
 * format of this one: its marks under `marks`, where the old key was, and
 * the format's name. Nothing else differs between the two. Anything else
 * (a case of the new format, a record that is no case) is returned as it is.
 */
export function upgradeStoredCase(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return value;
	const old = value as Record<string, unknown>;
	if (old["format"] !== OLD_CASE_FORMAT || "marks" in old) return value;
	const upgraded: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(old))
		if (key === "format") upgraded[key] = CASE_FORMAT;
		else if (key === OLD_MARKS_KEY) upgraded["marks"] = v;
		else upgraded[key] = v;
	return upgraded;
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

export class IdbStore implements CaseStore {
	#db: Promise<IDBDatabase> | undefined;

	#open(): Promise<IDBDatabase> {
		this.#db ??= new Promise((resolve, reject) => {
			const req = indexedDB.open("sitegloss", DB_VERSION);
			req.onupgradeneeded = (event) => {
				if (event.oldVersion < 1) {
					req.result.createObjectStore("cases", { keyPath: "id" });
					req.result.createObjectStore("images");
					return;
				}
				// In the upgrade's own transaction: every case is brought to the
				// new format, or (a failure aborts it) the database stays as it
				// was, at its old version, and nothing opens it.
				const walk = (req.transaction as IDBTransaction)
					.objectStore("cases")
					.openCursor();
				walk.onsuccess = () => {
					const at = walk.result;
					if (at === null) return;
					const upgraded = upgradeStoredCase(at.value);
					if (upgraded !== at.value) at.update(upgraded);
					at.continue();
				};
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => {
				this.#db = undefined;
				reject(req.error);
			};
		});
		return this.#db;
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
