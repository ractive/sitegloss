import { expect, test } from "bun:test";
import type { SessionArea } from "../src/lib/undo.ts";
import {
	MAX_CASES_A_TAB,
	MAX_TABS,
	TabCases,
} from "../src/worker/tab-cases.ts";

/** `chrome.storage.session` as a map, values copied as Chrome does. */
function area(): SessionArea {
	const data = new Map<string, unknown>();
	return {
		async get(key) {
			return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
		},
		async set(items) {
			for (const [k, v] of Object.entries(items))
				data.set(k, structuredClone(v));
		},
	};
}

test("a tab may add to the cases it was handed, until it closes; the oldest tabs go first", async () => {
	const cases = new TabCases(area());
	await cases.record(7, "c_1");
	expect(await cases.has(7, "c_1")).toBe(true);
	expect(await cases.has(7, "c_2")).toBe(false);
	expect(await cases.has(8, "c_1")).toBe(false);
	await cases.forget(7);
	expect(await cases.has(7, "c_1")).toBe(false);
	// Tab ids are numbers: the order kept is the order handed, not theirs.
	await cases.record(900, "c_1");
	for (let tab = 1; tab < MAX_TABS; tab++) await cases.record(tab, "c_1");
	expect(await cases.has(900, "c_1")).toBe(true);
	await cases.record(MAX_TABS, "c_1");
	expect(await cases.has(900, "c_1")).toBe(false);
	expect(await cases.has(1, "c_1")).toBe(true);
});

test("a toolbar's case stays through any number of loads; a screenshot id is the first capturing tab's", async () => {
	const cases = new TabCases(area());
	await cases.record(7, "c_toolbar", true);
	for (let n = 0; n <= MAX_CASES_A_TAB; n++) await cases.record(7, `c_${n}`);
	expect(await cases.has(7, "c_toolbar")).toBe(true);
	expect(await cases.has(7, "c_0")).toBe(false);
	expect(await cases.claimPending(7, "c_p1")).toBe(true);
	expect(await cases.claimPending(7, "c_p1")).toBe(true);
	expect(await cases.claimPending(8, "c_p1")).toBe(false);
	expect(await cases.ownsPending(7, "c_p1")).toBe(true);
	expect(await cases.ownsPending(8, "c_p1")).toBe(false);
	await cases.forget(7);
	expect(await cases.claimPending(8, "c_p1")).toBe(true);
});
