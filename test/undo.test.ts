import { describe, expect, test } from "bun:test";
import {
	type AddedMark,
	AddLedger,
	MAX_REMEMBERED,
	type SessionArea,
} from "../src/lib/undo.ts";

/** `chrome.storage.session` as a map, values copied as Chrome does. */
function area(): SessionArea & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		async get(key) {
			return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
		},
		async set(items) {
			for (const [k, v] of Object.entries(items))
				data.set(k, structuredClone(v));
		},
	};
}

const mark = (n: number, more: Partial<AddedMark> = {}): AddedMark => ({
	caseId: "c_1",
	markId: `a${n}`,
	shot: `s${n}`,
	comment: `comment ${n}`,
	tabId: 7,
	documentId: "doc-a",
	...more,
});

describe("AddLedger: Undo only for marks this page added", () => {
	test("finds a mark from the same tab and document", async () => {
		const ledger = new AddLedger(area());
		await ledger.record(mark(3));
		expect(await ledger.find("c_1", "a3", 7, "doc-a")).toEqual(mark(3));
	});

	test("refuses another tab, another document (the page was reloaded), another case or mark", async () => {
		const ledger = new AddLedger(area());
		await ledger.record(mark(3));
		expect(await ledger.find("c_1", "a3", 8, "doc-a")).toBeUndefined();
		expect(await ledger.find("c_1", "a3", 7, "doc-b")).toBeUndefined();
		expect(
			await ledger.find("c_1", "a3", undefined, undefined),
		).toBeUndefined();
		expect(await ledger.find("c_2", "a3", 7, "doc-a")).toBeUndefined();
		expect(await ledger.find("c_1", "a2", 7, "doc-a")).toBeUndefined();
		// The refusals left it there for its own page.
		expect(await ledger.find("c_1", "a3", 7, "doc-a")).toBeDefined();
	});

	test("an undo is used once", async () => {
		const ledger = new AddLedger(area());
		await ledger.record(mark(3));
		await ledger.record(mark(4));
		const found = await ledger.find("c_1", "a3", 7, "doc-a");
		await ledger.remove(found as AddedMark);
		expect(await ledger.find("c_1", "a3", 7, "doc-a")).toBeUndefined();
		expect(await ledger.find("c_1", "a4", 7, "doc-a")).toBeDefined();
	});

	test("a mark added again from another page belongs to that page", async () => {
		const ledger = new AddLedger(area());
		await ledger.record(mark(3));
		await ledger.record(mark(3, { tabId: 9, documentId: "doc-c" }));
		expect(await ledger.find("c_1", "a3", 7, "doc-a")).toBeUndefined();
		expect(await ledger.find("c_1", "a3", 9, "doc-c")).toBeDefined();
	});

	test("records made at once are all kept, and the oldest go past the limit", async () => {
		const store = area();
		const ledger = new AddLedger(store);
		await Promise.all(
			Array.from({ length: MAX_REMEMBERED + 5 }, (_, i) =>
				ledger.record(mark(i + 1)),
			),
		);
		const kept = store.data.get("addedMarks") as AddedMark[];
		expect(kept).toHaveLength(MAX_REMEMBERED);
		expect(kept[0]?.markId).toBe("a6");
	});

	test("a ledger started again (the worker stopped) reads what was recorded", async () => {
		const store = area();
		await new AddLedger(store).record(mark(3));
		expect(await new AddLedger(store).find("c_1", "a3", 7, "doc-a")).toEqual(
			mark(3),
		);
	});
});
