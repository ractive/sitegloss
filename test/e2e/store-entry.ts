/**
 * Injected into a page by `store.test.ts`: the real `IdbStore` and the store
 * contract, as a global, with a fresh database for each run.
 */

import {
	DB_VERSION,
	IdbStore,
	StoreBlockedError,
} from "../../src/lib/store.ts";
import { IdbStore as IdbStore030 } from "../compat/v0.3.0/src/lib/store.ts";
import { storeContract } from "../store-contract.ts";

declare global {
	var __siteglossStore: unknown;
}

/** An `IdbStore` on an empty database. */
async function emptyStore(): Promise<IdbStore> {
	const store = new IdbStore();
	await store.listCases(); // creates the database
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const open = indexedDB.open("sitegloss");
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
	const tx = db.transaction(["cases", "images"], "readwrite");
	tx.objectStore("cases").clear();
	tx.objectStore("images").clear();
	await new Promise((resolve) => {
		tx.oncomplete = resolve;
	});
	db.close();
	return store;
}

/** Everything that reads image records from `IDBObjectStore`, while `work` runs. */
async function recordReads(work: () => Promise<unknown>): Promise<string[]> {
	const proto = IDBObjectStore.prototype;
	const original = {
		get: proto.get,
		getAll: proto.getAll,
		openCursor: proto.openCursor,
	};
	const reads: string[] = [];
	proto.get = function (key) {
		reads.push(`get ${String(key)}`);
		return original.get.call(this, key);
	};
	proto.getAll = function (...args) {
		reads.push("getAll");
		return original.getAll.apply(this, args);
	};
	proto.openCursor = function (...args) {
		reads.push("openCursor");
		return original.openCursor.apply(this, args);
	};
	try {
		await work();
	} finally {
		Object.assign(proto, original);
	}
	return reads;
}

/** The databases `work` opens, closed after it: 0.3.0's store never closes its own. */
async function closingWhatOpens(work: () => Promise<unknown>): Promise<void> {
	const original = indexedDB.open.bind(indexedDB);
	const opened: IDBOpenDBRequest[] = [];
	indexedDB.open = (name: string, version?: number) => {
		const req = original(name, version);
		opened.push(req);
		return req;
	};
	try {
		await work();
	} finally {
		indexedDB.open = original;
		for (const req of opened) req.result?.close();
	}
}

/** The version of database `sitegloss` and what it holds, read without a store. */
function rawDatabase(): Promise<{
	version: number;
	cases: unknown[];
	imageKeys: string[];
}> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open("sitegloss");
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction(["cases", "images"]);
			const cases = tx.objectStore("cases").getAll();
			const keys = tx.objectStore("images").getAllKeys();
			tx.oncomplete = () => {
				const out = {
					version: db.version,
					cases: cases.result,
					imageKeys: (keys.result as string[]).sort(),
				};
				db.close();
				resolve(out);
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

/** A request's outcome, or "pending" after `ms`. */
function settled(req: IDBRequest, ms: number): Promise<string> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve("pending"), ms);
		req.addEventListener("success", () => {
			clearTimeout(timer);
			resolve("success");
		});
		req.addEventListener("error", () => {
			clearTimeout(timer);
			resolve(req.error?.name ?? "error");
		});
	});
}

globalThis.__siteglossStore = {
	names: Object.keys(storeContract),
	/**
	 * Database `sitegloss` held at version 1 by a connection that never
	 * closes itself (a build before this one): this build's open gives up
	 * with `StoreBlockedError`, and works once that connection goes. Then
	 * this build's own connection gives way to an upgrade and to a delete.
	 */
	async blocked() {
		indexedDB.deleteDatabase("sitegloss");
		const old = indexedDB.open("sitegloss", 1);
		old.onupgradeneeded = () => {
			old.result.createObjectStore("cases", { keyPath: "id" });
			old.result.createObjectStore("images");
		};
		await settled(old, 5000);
		const store = new IdbStore({ blockedWaitMs: 200, retryAfterMs: 400 });
		const said = (error: unknown) =>
			error instanceof StoreBlockedError ? error.message : String(error);
		const first = await store.listCases().then(() => "opened", said);
		old.result.close();
		// A call right after: the same error at once, no new open (no tight loop).
		const during = await store.listCases().then(() => "opened", said);
		await new Promise((resolve) => setTimeout(resolve, 500));
		const after = await store.listCases().then(
			(cases) => `opened, ${cases.length} cases`,
			(error: unknown) => String(error),
		);
		// A later version, while this build's connection is open: not blocked.
		const newer = indexedDB.open("sitegloss", DB_VERSION + 1);
		let blocked = false;
		newer.onblocked = () => {
			blocked = true;
		};
		const upgraded = await settled(newer, 2000);
		newer.result?.close();
		const deleting = indexedDB.deleteDatabase("sitegloss");
		const deleted = await settled(deleting, 2000);
		return { first, during, after, upgraded, blocked, deleted };
	},
	/**
	 * Database `sitegloss` (of a page whose origin has none yet) written by
	 * 0.3.0's own `IdbStore` with `old` (cases as 0.3.0 stores them), a
	 * screenshot and a crop for each, and one delete on record; then opened
	 * by this build's store, as a reloaded extension opens it.
	 */
	async upgradeFrom030(old: { id: string }[]) {
		const image = { blob: new Blob(["x"]), width: 1, height: 1 };
		await closingWhatOpens(async () => {
			const store = new IdbStore030();
			for (const c of old) {
				await store.updateCase(c.id, () => ({ value: c as never }));
				await store.putImage(c.id, "shots/s1.webp", image);
				await store.putImage(c.id, "crops/m1.webp", image);
			}
			await store.deleteCase("c_gone");
		});
		const before = await rawDatabase();
		const store = new IdbStore();
		const listed = await store.listCases();
		const deleted = (await store.deletedCases()).map((d) => d.id);
		const after = await rawDatabase();
		// A build before this one asks for version 1: it cannot open the database.
		const olderOpens = await new Promise<string>((resolve) => {
			const open = indexedDB.open("sitegloss", 1);
			open.onsuccess = () => {
				open.result.close();
				resolve("opened");
			};
			open.onerror = () => resolve(open.error?.name ?? "error");
		});
		return {
			before,
			after,
			listed,
			deleted,
			olderOpens,
			version: DB_VERSION,
		};
	},
	async run(name: string) {
		await storeContract[name]?.(await emptyStore());
	},
	/** Sweep a store of finished images and pending ones; answers what it read. */
	async sweepReads() {
		const store = await emptyStore();
		const image = (storedAt?: number) => ({
			blob: new Blob(["x"]),
			width: 1,
			height: 1,
			...(storedAt === undefined ? {} : { storedAt }),
		});
		await store.putImage("c_1", "shots/s1.webp", image());
		await store.putImage("c_1", "crops/m1.webp", image());
		await store.putImage("c_1", "pending/p_old.webp", image(1000));
		await store.putImage("c_2", "pending/p_new.webp", image(9000));
		let swept = 0;
		const reads = await recordReads(async () => {
			swept = await store.sweepPending(5000);
		});
		return { swept, reads: reads.sort() };
	},
};
