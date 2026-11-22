/**
 * The store contract (`test/store-contract.ts`) on the `IdbStore` that ships,
 * in real IndexedDB: the same cases `MemoryStore` passes in `store.test.ts`.
 * And the settings contract (`test/kv-contract.ts`) on the worker's `openKv`:
 * the same cases `memoryKv` passes in `worker.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { StoreBlockedError } from "../../src/lib/store.ts";
import { validateCase as validateCase030 } from "../case-0-3-0.ts";
import { sampleCase } from "../fixtures.ts";
import { kvContract } from "../kv-contract.ts";
import { storeContract } from "../store-contract.ts";
import type { Page } from "./browser.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";

describe.skipIf(browserBinary === undefined)("IdbStore and openKv", () => {
	let h: Harness;
	let page: Page;
	const bundles: string[] = [];

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
		({ page } = await h.open("v1"));
		for (const entry of ["store-entry.ts", "kv-entry.ts"]) {
			const bundle = await Bun.build({
				entrypoints: [join(import.meta.dir, entry)],
				target: "browser",
				format: "iife",
			});
			if (!bundle.success) throw new AggregateError(bundle.logs, entry);
			bundles.push(await (bundle.outputs[0] as Blob).text());
			await page.eval(bundles.at(-1) as string);
		}
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
	});

	test("the page runs every case of the contract", async () => {
		expect(await page.eval<string[]>("__siteglossStore.names")).toEqual(
			Object.keys(storeContract),
		);
	});

	for (const name of Object.keys(storeContract))
		test(name, async () => {
			await page.eval(`__siteglossStore.run(${JSON.stringify(name)})`);
		});

	test("the page runs every case of the settings contract", async () => {
		expect(await page.eval<string[]>("__siteglossKv.names")).toEqual(
			Object.keys(kvContract),
		);
	});

	for (const name of Object.keys(kvContract))
		test(`settings: ${name}`, async () => {
			await page.eval(`__siteglossKv.run(${JSON.stringify(name)})`);
		});

	test("settings: a database deleted under an open Kv is opened again", async () => {
		expect(await page.eval("__siteglossKv.reopens()")).toEqual({
			afterDelete: {},
			afterWrite: { relay: "https://after.test" },
		});
	});

	test("a database 0.3.0 wrote is emptied by the upgrade to version 2: no case, no image, no delete record; a build before cannot open it (DEC-051)", async () => {
		// Cases as 0.3.0 stores them: its own validateCase's result.
		const old = [
			["c_up1", "2026-11-04T10:00:00Z"],
			["c_up2", "2026-11-05T10:00:00Z"],
		].map(([id, at]) => {
			const {
				format: _f,
				marks,
				...rest
			} = JSON.parse(JSON.stringify(sampleCase(id, at)));
			return validateCase030({
				format: "sitegloss/1",
				...rest,
				annotations: marks.map((m: { number: number }) => ({
					...m,
					id: `a${m.number}`,
					crop: `crops/a${m.number}.webp`,
				})),
			});
		});
		// Another origin, so a database of its own that nothing else opened.
		const fresh = await h.browser.newPage(
			`${h.base.replace("127.0.0.1", "localhost")}/v1`,
		);
		await fresh.eval(bundles[0] as string);
		const result = await fresh.eval<{
			before: { version: number; cases: unknown[]; imageKeys: string[] };
			after: { version: number; cases: unknown[]; imageKeys: string[] };
			listed: unknown[];
			deleted: string[];
			olderOpens: string;
			version: number;
		}>(`__siteglossStore.upgradeFrom030(${JSON.stringify(old)})`);
		// What 0.3.0 left: version 1, its cases, images and a delete on record.
		expect(result.before.version).toBe(1);
		expect(result.before.cases).toHaveLength(2);
		expect(result.before.imageKeys.length).toBeGreaterThan(0);
		// This build's store: version 2, and nothing of before.
		expect(result.version).toBe(2);
		expect(result.after).toEqual({ version: 2, cases: [], imageKeys: [] });
		expect(result.listed).toEqual([]);
		expect(result.deleted).toEqual([]);
		expect(result.olderOpens).toBe("VersionError");
	});

	test("an open blocked by an older version's connection gives up with a clear error and works once it goes; this build's connection gives way to an upgrade and a delete", async () => {
		// The origin of the test above, which nothing else uses.
		const fresh = await h.browser.newPage(
			`${h.base.replace("127.0.0.1", "localhost")}/v1`,
		);
		await fresh.eval(bundles[0] as string);
		expect(
			await fresh.eval<Record<string, unknown>>("__siteglossStore.blocked()"),
		).toEqual({
			first: new StoreBlockedError().message,
			during: new StoreBlockedError().message,
			again: new StoreBlockedError().message,
			otherFirst: new StoreBlockedError().message,
			after: "opened, 0 cases",
			otherAfter: "opened, 0 cases",
			upgraded: "success",
			blocked: false,
			deleted: "success",
		});
	});

	test("sweepPending reads the pending records only, and no image of a finished case", async () => {
		expect(
			await page.eval<{ swept: number; reads: string[] }>(
				"__siteglossStore.sweepReads()",
			),
		).toEqual({
			swept: 1,
			reads: ["get c_1/pending/p_old.webp", "get c_2/pending/p_new.webp"],
		});
	});
});
