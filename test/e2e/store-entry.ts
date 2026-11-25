/**
 * Injected into a page by `store.test.ts`: the real `IdbStore` and the store
 * contract, as a global, with a fresh database for each run.
 */

import {
	DB_VERSION,
	IdbStore,
	StoreBlockedError,
} from "../../src/lib/store.ts";
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

/**
 * Database `sitegloss` at version 1 (or `version`), as a build before the
 * update left it: `cases` and `images`, each case with a screenshot and a
 * crop, and a delete on record (under `!deleted/`, beside the images).
 */
function version1(cases: { id: string }[], version = 1): Promise<void> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open("sitegloss", version);
		open.onupgradeneeded = () => {
			open.result.createObjectStore("cases", { keyPath: "id" });
			open.result.createObjectStore("images");
		};
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction(["cases", "images"], "readwrite");
			const image = { blob: new Blob(["x"]), width: 1, height: 1 };
			for (const c of cases) {
				tx.objectStore("cases").put(c);
				tx.objectStore("images").put(image, `${c.id}/shots/s1.webp`);
				tx.objectStore("images").put(image, `${c.id}/crops/a1.webp`);
			}
			tx.objectStore("images").put(
				{ deletedAt: Date.now() },
				"!deleted/c_gone",
			);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		};
	});
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
		const wait = (ms: number) =>
			new Promise((resolve) => setTimeout(resolve, ms));
		const first = await store.listCases().then(() => "opened", said);
		// A call right after: the same error at once, no new open (no tight loop).
		const during = await store.listCases().then(() => "opened", said);
		// After the retry time, the old connection still open: the request
		// under way is waited on again, and given up on again, not hung on.
		await wait(500);
		const again = await store.listCases().then(() => "opened", said);
		// Another context: its request waits behind the first without a
		// blocked event of its own, and is given up on all the same.
		const other = new IdbStore({ blockedWaitMs: 200, retryAfterMs: 400 });
		const otherFirst = await other.listCases().then(() => "opened", said);
		old.result.close();
		await wait(500);
		const opened = (cases: unknown[]) => `opened, ${cases.length} cases`;
		const after = await store
			.listCases()
			.then(opened, (error: unknown) => String(error));
		const otherAfter = await other
			.listCases()
			.then(opened, (error: unknown) => String(error));
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
		return {
			first,
			during,
			again,
			otherFirst,
			after,
			otherAfter,
			upgraded,
			blocked,
			deleted,
		};
	},
	/**
	 * Database `sitegloss` (of a page whose origin has none yet) at version 1
	 * with `old`, then opened by this build's store, as a reloaded extension
	 * opens it.
	 */
	async upgradeFromVersion1(old: { id: string }[]) {
		await version1(old);
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
	/**
	 * Database `sitegloss` at version 2 with `old` (cases whose marks have
	 * findings, DEC-081), then opened by this build's store; and whether a
	 * build before this one can open it after.
	 */
	async upgradeFromVersion2(old: { id: string }[]) {
		await settled(indexedDB.deleteDatabase("sitegloss"), 5000);
		await version1(old, 2);
		const before = await rawDatabase();
		const store = new IdbStore();
		const listed = await store.listCases();
		const after = await rawDatabase();
		const olderOpens = await new Promise<string>((resolve) => {
			const open = indexedDB.open("sitegloss", 2);
			open.onsuccess = () => {
				open.result.close();
				resolve("opened");
			};
			open.onerror = () => resolve(open.error?.name ?? "error");
		});
		return { before, after, listed, olderOpens };
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
