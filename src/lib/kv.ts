/**
 * A small key-value database in IndexedDB, in the extension's origin: the
 * AI settings' (the worker's alone, DEC-016) and the sync's (DEC-021) are
 * each one of these. Content scripts run in the page's origin and reach
 * neither.
 */

/** A key, a value that IndexedDB can clone. */
export interface Kv {
	get(key: string): Promise<unknown>;
	/** Every entry. */
	all(): Promise<Record<string, unknown>>;
	/** Write several entries at once (one transaction): all or none. */
	set(entries: Record<string, unknown>): Promise<void>;
	remove(key: string): Promise<void>;
	/**
	 * Read every entry and write what `change` answers, in one transaction:
	 * nobody writes in between. `change` runs synchronously and gets a copy.
	 * Where a store has none, nothing that needs it can run there.
	 */
	update?(change: KvChange): Promise<void>;
}

/** What `Kv.update` writes: entries to set and keys to remove; nothing: no write. */
export type KvChange = (
	entries: Readonly<Record<string, unknown>>,
) => { set?: Record<string, unknown>; remove?: readonly string[] } | undefined;

const STORE = "settings";

const done = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const finished = (transaction: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () =>
			reject(transaction.error ?? new Error("transaction aborted"));
	});

/**
 * The settings database, opened (and made the first time). Chrome may close
 * the connection (`onclose`: the user cleared the site's data, a disk
 * error), and another context deleting or upgrading the database asks it to
 * close (`onversionchange`): either way the next call opens it again.
 */
export async function openKv(name: string): Promise<Kv> {
	let current: Promise<IDBDatabase> | undefined;
	const connect = (): Promise<IDBDatabase> => {
		if (current !== undefined) return current;
		const opening = (async () => {
			const open = indexedDB.open(name, 1);
			open.onupgradeneeded = () => open.result.createObjectStore(STORE);
			const db = await done(open);
			const forget = () => {
				if (current === opening) current = undefined;
			};
			db.onclose = forget;
			db.onversionchange = () => {
				db.close();
				forget();
			};
			return db;
		})();
		current = opening;
		opening.catch(() => {
			if (current === opening) current = undefined;
		});
		return opening;
	};
	const store = async (mode: IDBTransactionMode) => {
		let db = await connect();
		try {
			return db.transaction(STORE, mode).objectStore(STORE);
		} catch (error) {
			// Closed under us before its event came: once more, on a new one.
			if ((error as DOMException).name !== "InvalidStateError") throw error;
			current = undefined;
			db = await connect();
			return db.transaction(STORE, mode).objectStore(STORE);
		}
	};
	await connect();
	return {
		get: async (key) => done((await store("readonly")).get(key)),
		async all() {
			const s = await store("readonly");
			const [keys, values] = await Promise.all([
				done(s.getAllKeys()),
				done(s.getAll()),
			]);
			return Object.fromEntries(keys.map((k, i) => [String(k), values[i]]));
		},
		async set(entries) {
			const s = await store("readwrite");
			const end = finished(s.transaction);
			try {
				for (const [key, value] of Object.entries(entries)) s.put(value, key);
			} catch (error) {
				// A value IndexedDB cannot clone: none of them is written.
				end.catch(() => {});
				s.transaction.abort();
				throw error;
			}
			await end;
		},
		async remove(key) {
			const s = await store("readwrite");
			s.delete(key);
			await finished(s.transaction);
		},
		async update(change) {
			const s = await store("readwrite");
			const end = finished(s.transaction);
			const keys = s.getAllKeys();
			const values = s.getAll();
			let failure: unknown;
			values.onsuccess = () => {
				try {
					const entries = Object.fromEntries(
						(keys.result as IDBValidKey[]).map((k, i) => [
							String(k),
							values.result[i],
						]),
					);
					const write = change(entries);
					for (const key of write?.remove ?? []) s.delete(key);
					for (const [key, value] of Object.entries(write?.set ?? {}))
						s.put(value, key);
				} catch (error) {
					end.catch(() => {});
					s.transaction.abort();
					failure = error;
				}
			};
			try {
				await end;
			} catch (error) {
				throw failure ?? error;
			}
			if (failure !== undefined) throw failure;
		},
	};
}

/**
 * A `Kv` usable at once: each call waits for the database to open. `open`
 * runs at the first call; when it fails, that call (and those waiting with
 * it) reject with its error, and the next call opens again, so one failed
 * open does not fail every later call until the worker or panel restarts.
 */
export function kvWhenOpen(open: () => Promise<Kv>): Kv {
	let opening: Promise<Kv> | undefined;
	const kv = (): Promise<Kv> => {
		if (opening !== undefined) return opening;
		// A throw in `open` itself rejects too.
		const attempt = (async () => open())();
		opening = attempt;
		attempt.catch(() => {
			if (opening === attempt) opening = undefined;
		});
		return attempt;
	};
	return {
		get: async (key) => (await kv()).get(key),
		all: async () => (await kv()).all(),
		set: async (entries) => (await kv()).set(entries),
		remove: async (key) => (await kv()).remove(key),
		async update(change) {
			const inner = await kv();
			if (inner.update === undefined)
				throw new Error("this database cannot change in one step");
			await inner.update(change);
		},
	};
}

/** A `Kv` in memory, for tests. */
export function memoryKv(initial: Record<string, unknown> = {}): Kv & {
	data: Map<string, unknown>;
} {
	const data = new Map(
		Object.entries(structuredClone(initial) as Record<string, unknown>),
	);
	return {
		data,
		get: async (key) => structuredClone(data.get(key)),
		all: async () => structuredClone(Object.fromEntries(data)),
		async set(entries) {
			// Like a transaction: all or nothing.
			const copy = structuredClone(entries);
			for (const [key, value] of Object.entries(copy)) data.set(key, value);
		},
		async remove(key) {
			data.delete(key);
		},
		async update(change) {
			const write = change(structuredClone(Object.fromEntries(data)));
			const set = structuredClone(write?.set ?? {});
			for (const key of write?.remove ?? []) data.delete(key);
			for (const [key, value] of Object.entries(set)) data.set(key, value);
		},
	};
}
