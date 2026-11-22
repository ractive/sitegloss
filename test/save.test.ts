import { describe, expect, test } from "bun:test";
import { lastMark } from "../src/content/adding.ts";
import {
	type Case,
	MAX_SHOTS,
	nextNumbers,
	pendingImage,
	type Shot,
	validateCase,
} from "../src/lib/case.ts";
import type { Draw } from "../src/lib/save.ts";
import {
	type Crop,
	fromPage,
	MAX_NUMBER_GAP,
	type MarkDraft,
	numberFree,
	type SaveRequest,
	saveCase,
	UNDO_WINDOW_MS,
	undoAdd,
} from "../src/lib/save.ts";
import { MemoryStore } from "../src/lib/store.ts";
import { putCase, sampleCase } from "./fixtures.ts";

const page = {
	url: "https://www.example.com/kk",
	title: "KK",
	lang: "de",
	viewport: { width: 1280, height: 800, dpr: 2 },
	userAgent: "test",
};

/** A shot with a provisional id, as the content script sends it. */
const shot = (id: string): Shot => ({
	id,
	image: pendingImage(id),
	scrollX: 0,
	scrollY: 0,
	viewport: { width: 1280, height: 800, dpr: 2 },
	capturedAt: "2026-11-04T10:00:00Z",
});

const draft = (n: number, shotId: string): MarkDraft => ({
	id: `m${n}`,
	number: n,
	shot: shotId,
	comment: `comment ${n}`,
	author: "user",
	shape: { kind: "box", rect: { x: 10, y: 10, width: 100, height: 40 } },
	element: null,
	cropRect: { x: 0, y: 0, width: 140, height: 80 },
});

let decodes = 0;
const crop: Crop = async (_image, rects) => {
	decodes++;
	return rects.map(() => ({
		blob: new Blob(["crop"]),
		width: 280,
		height: 160,
	}));
};

async function captured(store: MemoryStore, caseId: string, shotId: string) {
	await store.putImage(caseId, pendingImage(shotId), {
		blob: new Blob([`shot ${shotId}`]),
		width: 2560,
		height: 1600,
	});
}

function request(
	caseId: string,
	isNew: boolean,
	shots: Shot[],
	marks: MarkDraft[],
): SaveRequest {
	return { caseId, isNew, title: "One", page, shots, marks };
}

async function newCase(store: MemoryStore) {
	await captured(store, "c_1", "p_a");
	return saveCase(
		store,
		request("c_1", true, [shot("p_a")], [draft(1, "p_a"), draft(2, "p_a")]),
		crop,
	);
}

const keys = (store: MemoryStore) => [...store.images.keys()].sort();

describe("saveCase", () => {
	test("a new case: final shot ids, crops, one decode per screenshot, no pending images left", async () => {
		const store = new MemoryStore();
		await captured(store, "c_1", "p_a");
		const before = decodes;
		const saved = await saveCase(
			store,
			{
				...request(
					"c_1",
					true,
					[shot("p_a")],
					[draft(1, "p_a"), draft(2, "p_a")],
				),
				title: "  Contrast  ",
			},
			crop,
			new Date("2026-11-04T12:00:00Z"),
		);
		expect(decodes - before).toBe(1);
		expect(saved.title).toBe("Contrast");
		expect(saved.shots.map((s) => [s.id, s.image])).toEqual([
			["s1", "shots/s1.webp"],
		]);
		expect(saved.marks.map((a) => [a.shot, a.crop])).toEqual([
			["s1", "crops/m1.webp"],
			["s1", "crops/m2.webp"],
		]);
		expect("cropRect" in (saved.marks[0] ?? {})).toBe(false);
		expect(keys(store)).toEqual([
			"c_1/crops/m1.webp",
			"c_1/crops/m2.webp",
			"c_1/shots/s1.webp",
		]);
		expect((await store.getCase("c_1"))?.createdAt).toBe(
			"2026-11-04T12:00:00.000Z",
		);
	});

	test("adding to a case keeps its title, verdict and link and numbers shots on", async () => {
		const store = new MemoryStore();
		await newCase(store);
		await store.updateCase("c_1", (c) => ({
			value: {
				...(c as NonNullable<typeof c>),
				verdict: "Fix it",
				link: "https://tickets.example.com/browse/ABC-123",
			},
		}));
		await captured(store, "c_1", "p_b");
		const saved = await saveCase(
			store,
			{
				...request("c_1", false, [shot("p_b")], [draft(3, "p_b")]),
				title: "x",
			},
			crop,
		);
		expect(saved.title).toBe("One");
		expect(saved.verdict).toBe("Fix it");
		expect(saved.link).toBe("https://tickets.example.com/browse/ABC-123");
		expect(saved.shots.map((s) => s.id)).toEqual(["s1", "s2"]);
		expect(saved.marks.map((a) => [a.number, a.shot])).toEqual([
			[1, "s1"],
			[2, "s1"],
			[3, "s2"],
		]);
	});

	test("a new case keeps the page's address without query or fragment", async () => {
		const store = new MemoryStore();
		await captured(store, "c_url", "p1");
		const saved = await saveCase(
			store,
			{
				...request("c_url", true, [shot("p1")], [draft(1, "p1")]),
				page: { ...page, url: "https://a.example/reset?token=abc#def" },
			},
			crop,
		);
		expect(saved.page.url).toBe("https://a.example/reset");
	});

	test("a shot keeps its page's address without query or fragment", async () => {
		const store = new MemoryStore();
		await captured(store, "c_shot", "p1");
		const saved = await saveCase(
			store,
			request(
				"c_shot",
				true,
				[{ ...shot("p1"), url: "https://a.example/route?token=abc#def" }],
				[draft(1, "p1")],
			),
			crop,
		);
		expect(saved.shots[0]?.url).toBe("https://a.example/route");
		expect(saved.shots[0]?.id).toBe("s1");
	});

	test("adding to an imported case keeps that it was imported", async () => {
		const store = new MemoryStore();
		await captured(store, "c_imp", "p1");
		await saveCase(
			store,
			request("c_imp", true, [shot("p1")], [draft(1, "p1")]),
			crop,
		);
		await store.updateCase("c_imp", (c) => ({
			value: { ...(c as Case), importedAt: "2026-11-05T09:00:00.000Z" },
		}));
		await captured(store, "c_imp", "p2");
		const saved = await saveCase(
			store,
			request("c_imp", false, [shot("p2")], [draft(2, "p2")]),
			crop,
		);
		expect(saved.importedAt).toBe("2026-11-05T09:00:00.000Z");
	});

	test("a verdict saved while the crops are cut is kept", async () => {
		const store = new MemoryStore();
		await newCase(store);
		await captured(store, "c_1", "p_b");
		const slowCrop: Crop = async (image, rects, dpr) => {
			await store.updateCase("c_1", (c) => ({
				value: { ...(c as NonNullable<typeof c>), verdict: "Agreed meanwhile" },
			}));
			return crop(image, rects, dpr);
		};
		const saved = await saveCase(
			store,
			request("c_1", false, [shot("p_b")], [draft(3, "p_b")]),
			slowCrop,
		);
		expect(saved.verdict).toBe("Agreed meanwhile");
		expect((await store.getCase("c_1"))?.marks).toHaveLength(3);
	});

	test("a number the case has already is refused without touching its images", async () => {
		const store = new MemoryStore();
		await newCase(store);
		const before = new Map(store.images);
		await captured(store, "c_1", "p_b");
		await expect(
			saveCase(
				store,
				request("c_1", false, [shot("p_b")], [draft(1, "p_b")]),
				crop,
			),
		).rejects.toThrow("mark 1 exists in the case already");
		// The very same image objects: an overwrite with equal-looking crops
		// would pass a deep comparison.
		for (const [key, image] of before)
			expect(store.images.get(key)).toBe(image);
		// Only the new screenshot is added, pending: the marks can be saved again.
		expect([...store.images.keys()].sort()).toEqual(
			[...before.keys(), "c_1/pending/p_b.webp"].sort(),
		);
		expect((await store.getCase("c_1"))?.marks).toHaveLength(2);
	});

	test("a number used twice in one save is refused and stores no case", async () => {
		const store = new MemoryStore();
		await captured(store, "c_1", "p_a");
		await expect(
			saveCase(
				store,
				request("c_1", true, [shot("p_a")], [draft(1, "p_a"), draft(1, "p_a")]),
				crop,
			),
		).rejects.toThrow();
		expect([...store.images.keys()]).toEqual(["c_1/pending/p_a.webp"]);
		expect(await store.getCase("c_1")).toBeUndefined();
	});

	test("refuses to add to a missing case, or to overwrite one as new", async () => {
		const store = new MemoryStore();
		await expect(
			saveCase(store, request("c_9", false, [], []), crop),
		).rejects.toThrow("no longer exists");
		await newCase(store);
		await captured(store, "c_1", "p_b");
		await expect(
			saveCase(
				store,
				request("c_1", true, [shot("p_b")], [draft(5, "p_b")]),
				crop,
			),
		).rejects.toThrow("exists already");
		// The marks can be saved again: their screenshot must still be there.
		expect(store.images.has("c_1/pending/p_b.webp")).toBe(true);
	});

	test("reads pending screenshots from imagesFrom and draws the marks on them", async () => {
		const store = new MemoryStore();
		await captured(store, "c_session", "p_a");
		const drawn: number[][] = [];
		const draw: Draw = async (image, marks) => {
			drawn.push(marks.map((m) => m.number));
			return { blob: image, width: 1, height: 1 };
		};
		const saved = await saveCase(
			store,
			{
				...request(
					"c_1",
					true,
					[shot("p_a")],
					[draft(1, "p_a"), draft(2, "p_a")],
				),
				imagesFrom: "c_session",
			},
			crop,
			new Date(),
			draw,
		);
		expect(saved.id).toBe("c_1");
		expect(drawn).toEqual([[1, 2]]);
		expect(store.images.has("c_session/pending/p_a.webp")).toBe(false);
		expect(store.images.has("c_1/shots/s1.webp")).toBe(true);
	});

	test("a mark is stored with a mark's fields only: no resolution, findings or anything else the draft carries (CR-07)", async () => {
		const store = new MemoryStore();
		await captured(store, "c_1", "p_a");
		const forged = {
			...draft(1, "p_a"),
			resolution: { kind: "fixed", at: "2026-11-04T10:00:00Z" },
			findings: [
				{
					id: "f1",
					text: "Invented",
					app: { id: "https://claude.ai/oauth", host: "claude.ai" },
					at: "2026-11-04T10:00:00Z",
				},
			],
			crop: "crops/other.webp",
			extra: "kept?",
		} as unknown as MarkDraft;
		const saved = await saveCase(
			store,
			request("c_1", true, [shot("p_a")], [forged]),
			crop,
		);
		const stored = saved.marks[0] as unknown as Record<string, unknown>;
		expect(Object.keys(stored).sort()).toEqual(
			[
				"author",
				"comment",
				"crop",
				"element",
				"id",
				"number",
				"shape",
				"shot",
			].sort(),
		);
		expect(stored["crop"]).toBe("crops/m1.webp");
		expect((await store.getCase("c_1"))?.marks[0]).toEqual(
			saved.marks[0] as never,
		);
	});

	test("a save from the page is the user's: an AI author in its draft does not count (CR-07)", async () => {
		const store = new MemoryStore();
		await putCase(store, sampleCase("c_1"));
		await captured(store, "c_1", "p_a");
		const ai = { ...draft(1, "p_a"), author: "ai" as const };
		const saved = await saveCase(
			store,
			fromPage(request("c_1", false, [shot("p_a")], [ai, draft(2, "p_a")])),
			crop,
		);
		expect(saved.marks.map((a) => a.author)).toEqual(["user", "user"]);
		// An AI app's own mark (add_mark) is still its own.
		await captured(store, "c_1", "p_b");
		const added = await saveCase(
			store,
			request(
				"c_1",
				false,
				[shot("p_b")],
				[{ ...draft(3, "p_b"), author: "ai" }],
			),
			crop,
		);
		expect(added.marks.map((a) => a.author)).toEqual(["user", "user", "ai"]);
	});

	test("a mark added after a delete raises lastNumber with it (was refused by the format)", async () => {
		const store = new MemoryStore();
		await newCase(store); // marks 1 and 2
		await store.updateCase("c_1", (c) => ({
			value: { ...(c as Case), lastNumber: 2 },
		}));
		await captured(store, "c_1", "p_b");
		const saved = await saveCase(
			store,
			fromPage(request("c_1", false, [shot("p_b")], [draft(3, "p_b")])),
			crop,
		);
		expect(saved.marks.map((a) => a.number)).toEqual([1, 2, 3]);
		expect(saved.lastNumber).toBe(3);
		expect(validateCase(saved)).toEqual(saved);
	});

	test("a later mark leaves the case's page as its first mark had it", async () => {
		const store = new MemoryStore();
		await putCase(store, sampleCase("c_1"));
		await captured(store, "c_1", "p_a");
		const first = await saveCase(
			store,
			fromPage(request("c_1", false, [shot("p_a")], [draft(1, "p_a")])),
			crop,
		);
		await captured(store, "c_1", "p_b");
		const second = await saveCase(
			store,
			fromPage({
				...request("c_1", false, [shot("p_b")], [draft(2, "p_b")]),
				page: { ...page, url: "https://elsewhere.example/" },
			}),
			crop,
		);
		expect(second.page).toEqual(first.page);
	});

	test("marks are kept in the order of their numbers, whatever order they went in", async () => {
		const store = new MemoryStore();
		await putCase(store, sampleCase("c_1"));
		await captured(store, "c_1", "p_b");
		await saveCase(
			store,
			fromPage(request("c_1", false, [shot("p_b")], [draft(2, "p_b")])),
			crop,
		);
		// Mark 1 goes in after mark 2 ("Add mark 1" took its screenshot later).
		await captured(store, "c_1", "p_a");
		const saved = await saveCase(
			store,
			fromPage(request("c_1", false, [shot("p_a")], [draft(1, "p_a")])),
			crop,
		);
		expect(saved.marks.map((a) => [a.number, a.shot])).toEqual([
			[1, "s2"],
			[2, "s1"],
		]);
	});

	test("a page makes no case: the side panel creates them (DEC-026)", async () => {
		const store = new MemoryStore();
		await captured(store, "c_1", "p_a");
		expect(() =>
			fromPage(request("c_1", true, [shot("p_a")], [draft(1, "p_a")])),
		).toThrow("a page adds marks to an existing case");
		expect(await store.getCase("c_1")).toBeUndefined();
	});

	test("the first mark of a case New case for this page made: s1 and m1, the page its mark's, the title kept (DEC-026)", async () => {
		const store = new MemoryStore();
		const empty = await putCase(store, {
			...sampleCase("c_1"),
			title: "Your cart",
		});
		expect(nextNumbers(empty)).toEqual({ mark: 1, shot: 1 });
		await captured(store, "c_1", "p_a");
		const saved = await saveCase(
			store,
			fromPage({
				...request("c_1", false, [shot("p_a")], [draft(1, "p_a")]),
				// The window grew, and the route changed, between the click and
				// the mark: the case's page is the mark's (review of PR 57).
				page: {
					...page,
					url: "https://elsewhere.example/checkout?step=2#top",
					viewport: { width: 1600, height: 900, dpr: 2 },
				},
				keepPending: true,
			}),
			crop,
		);
		expect(saved.title).toBe("Your cart");
		expect(saved.page).toEqual({
			...page,
			url: "https://elsewhere.example/checkout",
			viewport: { width: 1600, height: 900, dpr: 2 },
		});
		expect(saved.createdAt).toBe(empty.createdAt);
		expect(saved.shots.map((s) => s.id)).toEqual(["s1"]);
		expect(saved.marks.map((a) => [a.id, a.shot])).toEqual([["m1", "s1"]]);
		// Undo of that first mark leaves the case as it was made: empty.
		const undone = await undoAdd(
			store,
			"c_1",
			"m1",
			{ shot: "s1", comment: "comment 1" },
			new Date("2026-11-04T10:05:00Z"),
		);
		expect(undone).toEqual({ removed: true, next: 1 });

		const after = (await store.getCase("c_1")) as Case;
		expect(after.marks).toEqual([]);
		expect(after.shots).toEqual([]);
		// A mark was stored: the case is the user's now (review of PR 57),
		// and number 1 is free again.
		expect(after.lastNumber).toBe(0);
		expect(nextNumbers(after).mark).toBe(1);
		expect(validateCase(after)).toEqual(after);
	});

	test("a save from the page cannot choose a number far above the case's next (review of PR 45)", async () => {
		const store = new MemoryStore();
		await newCase(store); // marks 1 and 2
		for (const n of [99_999, 2 + 1 + MAX_NUMBER_GAP + 1]) {
			await captured(store, "c_1", "p_b");
			await expect(
				saveCase(
					store,
					fromPage(request("c_1", false, [shot("p_b")], [draft(n, "p_b")])),
					crop,
				),
			).rejects.toThrow(`mark ${n} is far above the case's next number, 3`);
		}
		expect(nextNumbers(await store.getCase("c_1")).mark).toBe(3);
		// Gaps a toolbar leaves (drafts taken out before they were added) are fine.
		await captured(store, "c_1", "p_b");
		const gap = await saveCase(
			store,
			fromPage(
				request(
					"c_1",
					false,
					[shot("p_b")],
					[draft(3 + MAX_NUMBER_GAP, "p_b")],
				),
			),
			crop,
		);
		expect(gap.marks.at(-1)?.number).toBe(3 + MAX_NUMBER_GAP);
		// Several marks in one save: each may be one more.
		await putCase(store, sampleCase("c_2"));
		await captured(store, "c_2", "p_a");
		const many = Array.from({ length: 5 }, (_, i) =>
			draft(i + 1 + MAX_NUMBER_GAP, "p_a"),
		);
		const saved = await saveCase(
			store,
			fromPage(request("c_2", false, [shot("p_a")], many)),
			crop,
		);
		expect(saved.marks).toHaveLength(5);
		// The worker's own add (an AI app's mark) is not bound by it.
		await captured(store, "c_1", "p_c");
		const ai = await saveCase(
			store,
			request(
				"c_1",
				false,
				[shot("p_c")],
				[{ ...draft(5000, "p_c"), author: "ai" }],
			),
			crop,
		);
		expect(ai.marks.at(-1)?.number).toBe(5000);
	});

	test("a missing screenshot fails the save", async () => {
		await expect(
			saveCase(
				new MemoryStore(),
				request("c_1", true, [shot("p_a")], [draft(1, "p_a")]),
				crop,
			),
		).rejects.toThrow("the screenshot p_a is missing");
	});
});

/** The toolbar adds a case's marks one by one (DEC-014). */
describe("adding mark by mark", () => {
	/** Add mark `n` alone, on the pending screenshot `shotId` of the session. */
	const addOne = (
		store: MemoryStore,
		n: number,
		shotId: string,
		extra: Partial<SaveRequest> = {},
		draw?: Draw,
	) =>
		saveCase(
			store,
			{
				...request("c_1", false, [shot(shotId)], [draft(n, shotId)]),
				imagesFrom: "c_session",
				keepPending: true,
				...extra,
			},
			crop,
			new Date("2026-11-04T10:05:00Z"),
			draw,
		);

	test("marks on one view share its picture: each gets a shot of its own, drawn with the marks before it", async () => {
		const store = new MemoryStore();
		await newCase(store);
		await captured(store, "c_session", "p_v");
		const drawn: number[][] = [];
		const draw: Draw = async (image, marks) => {
			drawn.push(marks.map((m) => m.number));
			return { blob: image, width: 1, height: 1 };
		};
		await addOne(store, 3, "p_v", {}, draw);
		// The pending picture stays for the next mark on the same view.
		expect(store.images.has("c_session/pending/p_v.webp")).toBe(true);
		const saved = await addOne(
			store,
			4,
			"p_v",
			{
				alsoDrawn: [
					{
						shot: "p_v",
						number: 3,
						shape: { kind: "note", at: { x: 5, y: 5 } },
					},
					// Another view's mark is not drawn here.
					{
						shot: "p_other",
						number: 2,
						shape: { kind: "note", at: { x: 5, y: 5 } },
					},
					// Nor a later mark: Undo of it would leave its pin here.
					{
						shot: "p_v",
						number: 5,
						shape: { kind: "note", at: { x: 5, y: 5 } },
					},
				],
			},
			draw,
		);
		expect(drawn).toEqual([[3], [3, 4]]);
		expect(saved.marks.map((a) => [a.number, a.shot])).toEqual([
			[1, "s1"],
			[2, "s1"],
			[3, "s2"],
			[4, "s3"],
		]);
		expect(store.images.has("c_1/shots/s3.webp")).toBe(true);
		expect(store.images.has("c_session/pending/p_v.webp")).toBe(true);
	});

	test("numberFree: a number in use or reserved by a deleted mark is not free", async () => {
		const store = new MemoryStore();
		await newCase(store);
		expect(await numberFree(store, "c_1", 3)).toEqual({ free: true, next: 3 });
		expect(await numberFree(store, "c_1", 2)).toEqual({ free: false, next: 3 });
		await store.updateCase("c_1", (c) => ({
			value: { ...(c as Case), lastNumber: 5 },
		}));
		expect(await numberFree(store, "c_1", 4)).toEqual({ free: false, next: 6 });
		expect(await numberFree(store, "c_1", 6)).toEqual({ free: true, next: 6 });
		await expect(numberFree(store, "c_9", 1)).rejects.toThrow(
			"no longer exists",
		);
	});

	/** What the worker recorded for mark `n` added on its own shot `shot`. */
	const as = (shot: string, n: number) => ({ shot, comment: `comment ${n}` });
	const at = new Date("2026-11-04T10:06:00Z");

	test("undoAdd takes the mark out with its crop and screenshot, and frees its number", async () => {
		const store = new MemoryStore();
		await newCase(store);
		await captured(store, "c_session", "p_v");
		await addOne(store, 3, "p_v");
		expect(keys(store)).toContain("c_1/shots/s2.webp");
		const result = await undoAdd(store, "c_1", "m3", as("s2", 3), at);
		expect(result).toEqual({ removed: true, next: 3 });
		const c = (await store.getCase("c_1")) as Case;
		expect(c.marks.map((a) => a.number)).toEqual([1, 2]);
		expect(c.shots.map((s) => s.id)).toEqual(["s1"]);
		// It records that marks were stored (review of PR 57), below the freed number.
		expect(c.lastNumber).toBe(2);
		expect(keys(store)).toEqual([
			"c_1/crops/m1.webp",
			"c_1/crops/m2.webp",
			"c_1/shots/s1.webp",
			"c_session/pending/p_v.webp",
		]);
		// Added again, it takes the same number and the next shot number.
		const again = await addOne(store, 3, "p_v");
		expect(again.marks.at(-1)?.shot).toBe("s2");
	});

	test("undoAdd: a mark already gone is no error", async () => {
		const store = new MemoryStore();
		await newCase(store);
		expect(await undoAdd(store, "c_1", "m7", as("s9", 7), at)).toEqual({
			removed: false,
			next: 3,
		});
		await expect(undoAdd(store, "c_9", "m1", as("s1", 1), at)).rejects.toThrow(
			"no longer exists",
		);
	});

	/** Change mark `n` of case c_1 as the side panel or an AI app would. */
	const change = (
		store: MemoryStore,
		n: number,
		edit: (a: Case["marks"][number]) => Case["marks"][number],
	) =>
		store.updateCase("c_1", (c) => ({
			value: {
				...(c as Case),
				marks: (c as Case).marks.map((a) => (a.number === n ? edit(a) : a)),
			},
		}));

	test("undoAdd refuses a mark resolved or edited since, or with marks after it", async () => {
		const store = new MemoryStore();
		await newCase(store);
		await captured(store, "c_session", "p_v");
		await addOne(store, 3, "p_v");
		await change(store, 3, (a) => ({
			...a,
			resolution: { kind: "fixed", at: "2026-11-04T10:05:30Z" },
		}));
		await expect(undoAdd(store, "c_1", "m3", as("s2", 3), at)).rejects.toThrow(
			"was resolved since",
		);
		await change(store, 3, ({ resolution: _, ...a }) => ({
			...a,
			comment: "edited in the side panel",
		}));
		await expect(undoAdd(store, "c_1", "m3", as("s2", 3), at)).rejects.toThrow(
			"was edited since",
		);
		await change(store, 3, (a) => ({ ...a, comment: "comment 3" }));
		await captured(store, "c_session", "p_w");
		await addOne(store, 4, "p_w");
		await expect(undoAdd(store, "c_1", "m3", as("s2", 3), at)).rejects.toThrow(
			"has marks after it",
		);
		expect((await store.getCase("c_1"))?.marks).toHaveLength(4);
		// The last one can go, then the one before it.
		await undoAdd(store, "c_1", "m4", as("s3", 4), at);
		await undoAdd(store, "c_1", "m3", as("s2", 3), at);
		expect((await store.getCase("c_1"))?.marks).toHaveLength(2);
	});

	test("undoAdd refuses a mark that shares its screenshot, an AI app's, another shot, or an old one", async () => {
		const store = new MemoryStore();
		await newCase(store);
		// Marks 1 and 2 were saved together, on one screenshot.
		await expect(undoAdd(store, "c_1", "m2", as("s1", 2), at)).rejects.toThrow(
			"cannot be undone here",
		);
		await captured(store, "c_session", "p_v");
		await addOne(store, 3, "p_v");
		await expect(undoAdd(store, "c_1", "m3", as("s9", 3), at)).rejects.toThrow(
			"cannot be undone here",
		);
		const later = new Date(Date.parse("2026-11-04T10:00:00Z") + UNDO_WINDOW_MS);
		await expect(
			undoAdd(store, "c_1", "m3", as("s2", 3), later),
		).rejects.toThrow("cannot be undone here");
		await change(store, 3, (a) => ({ ...a, author: "ai" as const }));
		await expect(undoAdd(store, "c_1", "m3", as("s2", 3), at)).rejects.toThrow(
			"was edited since",
		);
		expect((await store.getCase("c_1"))?.marks).toHaveLength(3);
	});

	test("a case with as many screenshots as it can hold says so before anything is drawn", async () => {
		const store = new MemoryStore();
		await newCase(store);
		await store.updateCase("c_1", (c) => {
			const one = (c as Case).shots[0] as Shot;
			return {
				value: validateCase({
					...(c as Case),
					shots: Array.from({ length: MAX_SHOTS }, (_, i) => ({
						...one,
						id: `s${i + 1}`,
						image: `shots/s${i + 1}.webp`,
					})),
				}),
			};
		});
		await captured(store, "c_session", "p_v");
		let drawnAny = false;
		const draw: Draw = async (image) => {
			drawnAny = true;
			return { blob: image, width: 1, height: 1 };
		};
		await expect(addOne(store, 3, "p_v", {}, draw)).rejects.toThrow(
			`holds ${MAX_SHOTS} screenshots, the most a case can; start a new case`,
		);
		expect(drawnAny).toBe(false);
		expect(MAX_SHOTS).toBe(1000);
	});
});

describe("lastMark", () => {
	test("is the mark with the highest number, wherever it is in the list", () => {
		expect(lastMark([])).toBeUndefined();
		const marks = [{ number: 12 }, { number: 14 }, { number: 13 }];
		expect(lastMark(marks)).toBe(marks[1]);
	});
});
