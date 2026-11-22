/**
 * What every `CaseStore` does: store.test.ts runs this on `MemoryStore`,
 * e2e/store.test.ts on the real `IdbStore` in a browser. It bundles for a page,
 * so no `bun:test` here.
 */

import type { Case } from "../src/lib/case.ts";
import type { CaseStore, StoredImage } from "../src/lib/store.ts";
import { putCase, sampleCase } from "./fixtures.ts";

function same(actual: unknown, expected: unknown): void {
	const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
	if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

async function rejects(work: Promise<unknown>, text: string): Promise<void> {
	let failure: Error | undefined;
	try {
		await work;
	} catch (error) {
		failure = error as Error;
	}
	if (!failure?.message.includes(text))
		throw new Error(`expected a failure with "${text}", got ${failure}`);
}

const image = (data = "x", storedAt?: number): StoredImage => ({
	blob: new Blob([data], { type: "image/webp" }),
	width: 3,
	height: 2,
	...(storedAt === undefined ? {} : { storedAt }),
});

/** Neither store can keep this, as IndexedDB cannot keep a function. */
const cannotBeStored = {
	...image(),
	blob: (() => "no") as unknown as Blob,
};

const text = async (store: CaseStore, caseId: string, path: string) =>
	(await store.getImage(caseId, path))?.blob.text();

/** Which of `paths` the case has an image for. */
async function held(
	store: CaseStore,
	caseId: string,
	paths: string[],
): Promise<string[]> {
	const found: string[] = [];
	for (const path of paths)
		if ((await store.getImage(caseId, path)) !== undefined) found.push(path);
	return found;
}

export const storeContract: Record<
	string,
	(store: CaseStore) => Promise<void>
> = {
	"a delete is on record, written with it; a case stored again under the id takes the record away":
		async (store) => {
			await putCase(store, sampleCase("c_1"));
			await putCase(store, sampleCase("c_2"));
			await putCase(store, sampleCase("c_3"));
			await store.putImage("c_1", "shots/s1.webp", image("one"));
			same(await store.deletedCases(), []);
			const before = Date.now();
			await store.deleteCase("c_1");
			same(await store.deleteCaseIf("c_2", () => true), true);
			same(await store.deleteCaseIf("c_3", () => false), false);
			// Gone because it was deleted elsewhere: no record.
			await store.deleteCase("c_3", true);
			const records = await store.deletedCases();
			same(records.map((r) => r.id).sort(), ["c_1", "c_2"]);
			same(
				records.every((r) => r.at >= before && r.at <= Date.now()),
				true,
			);
			// The records are no images, and no case's.
			same(await store.getImage("c_1", "shots/s1.webp"), undefined);
			same(await store.sweepPending(Date.now() + 1000), 0);
			same(await store.listCases(), []);
			// Stored again (an import, the team's copy): not deleted any more.
			await putCase(store, sampleCase("c_1"));
			await store.replaceCase(sampleCase("c_2"), new Map());
			same(await store.deletedCases(), []);
			await store.deleteCase("c_1");
			await store.forgetDeleted(["c_1", "c_nothing"]);
			same(await store.deletedCases(), []);
			// Asked for a case that is not there (a list that is behind): on
			// record all the same; a delete on a condition that finds none is not.
			await store.deleteCase("c_never");
			same(await store.deleteCaseIf("c_none", () => true), false);
			same(
				(await store.deletedCases()).map((r) => r.id),
				["c_never"],
			);
		},

	"a delete written takes the records older than thirty days away: they do not pile up for someone who never signs in":
		async (store) => {
			const real = Date.now;
			const day = 24 * 3600_000;
			try {
				Date.now = () => real() - 31 * day;
				await store.deleteCase("c_old");
				Date.now = () => real() - 29 * day;
				await store.deleteCase("c_recent");
			} finally {
				Date.now = real;
			}
			same((await store.deletedCases()).map((r) => r.id).sort(), [
				"c_old",
				"c_recent",
			]);
			// The next delete written, by either way of deleting.
			await putCase(store, sampleCase("c_1"));
			same(await store.deleteCaseIf("c_1", () => true), true);
			same((await store.deletedCases()).map((r) => r.id).sort(), [
				"c_1",
				"c_recent",
			]);
			// A delete for a reason elsewhere writes nothing, and takes nothing.
			Date.now = () => real() + 2 * day;
			try {
				await store.deleteCase("c_gone", true);
			} finally {
				Date.now = real;
			}
			same((await store.deletedCases()).map((r) => r.id).sort(), [
				"c_1",
				"c_recent",
			]);
		},

	"lists newest first and returns copies": async (store) => {
		await putCase(store, sampleCase("c_1", "2026-11-04T10:00:00Z"));
		await putCase(store, sampleCase("c_2", "2026-11-04T11:00:00Z"));
		same(
			(await store.listCases()).map((c) => c.id),
			["c_2", "c_1"],
		);
		const copy = await store.getCase("c_1");
		if (copy) copy.title = "changed";
		same((await store.getCase("c_1"))?.title, "Button contrast");
		same(await store.getCase("c_3"), undefined);
	},

	"an update deletes images with the case, and may write a freed path anew":
		async (store) => {
			await putCase(store, sampleCase("c_1"));
			await store.putImage("c_1", "shots/s2.webp", image("old"));
			await store.putImage("c_1", "crops/m3.webp", image("crop"));
			await store.updateCase("c_1", (c) => ({
				value: c as Case,
				deleteImages: ["shots/s2.webp", "crops/m3.webp"],
			}));
			same(await store.getImage("c_1", "shots/s2.webp"), undefined);
			same(await store.getImage("c_1", "crops/m3.webp"), undefined);
			await store.updateCase("c_1", (c) => ({
				value: c as Case,
				deleteImages: ["shots/s2.webp"],
				images: new Map([["shots/s2.webp", image("new")]]),
			}));
			same(
				await (await store.getImage("c_1", "shots/s2.webp"))?.blob.text(),
				"new",
			);
		},

	"an image comes back with its bytes, type and sizes": async (store) => {
		await store.putImage("c_1", "shots/s1.webp", image("bytes", 1000));
		const stored = await store.getImage("c_1", "shots/s1.webp");
		same(await stored?.blob.text(), "bytes");
		same(stored?.blob.type, "image/webp");
		same([stored?.width, stored?.height, stored?.storedAt], [3, 2, 1000]);
		same(await store.getImage("c_1", "shots/s2.webp"), undefined);
	},

	"deleting a case deletes all its images and nobody else's": async (store) => {
		const paths = ["crops/m1.webp", "pending/p_a.webp", "shots/s1.webp"];
		await putCase(store, sampleCase("c_1"));
		await putCase(store, sampleCase("c_10"));
		for (const id of ["c_1", "c_10", "c_0", "c_1-x"])
			for (const path of paths) await store.putImage(id, path, image());
		await store.deleteCase("c_1");
		same(await store.getCase("c_1"), undefined);
		same(await held(store, "c_1", paths), []);
		same((await store.getCase("c_10"))?.id, "c_10");
		for (const id of ["c_10", "c_0", "c_1-x"])
			same(await held(store, id, paths), paths);
	},

	"deleteCaseIf deletes only a case its check holds for, with its images":
		async (store) => {
			await putCase(store, sampleCase("c_1"));
			await putCase(store, { ...sampleCase("c_2"), title: "Kept" });
			for (const id of ["c_1", "c_2"])
				await store.putImage(id, "shots/s1.webp", image());
			const empty = (c: Case) => c.title === "Button contrast";
			same(await store.deleteCaseIf("c_2", empty), false);
			same((await store.getCase("c_2"))?.title, "Kept");
			same(await held(store, "c_2", ["shots/s1.webp"]), ["shots/s1.webp"]);
			same(await store.deleteCaseIf("c_1", empty), true);
			same(await store.getCase("c_1"), undefined);
			same(await held(store, "c_1", ["shots/s1.webp"]), []);
			// Gone already: nothing to delete, no failure.
			same(await store.deleteCaseIf("c_1", () => true), false);
			// A check that throws deletes nothing and fails.
			await rejects(
				store.deleteCaseIf("c_2", () => {
					throw new Error("no check");
				}),
				"no check",
			);
			same((await store.getCase("c_2"))?.title, "Kept");
		},

	"updateCase writes the case and its images together": async (store) => {
		await putCase(store, sampleCase("c_1"));
		const saved = await store.updateCase("c_1", (current) => ({
			value: { ...(current ?? sampleCase()), title: "New" },
			images: new Map([["crops/m1.webp", image()]]),
		}));
		same(saved.title, "New");
		same((await store.getCase("c_1"))?.title, "New");
		same(await held(store, "c_1", ["crops/m1.webp"]), ["crops/m1.webp"]);
	},

	"updateCase can create a case": async (store) => {
		const created = await store.updateCase("c_1", (current) => ({
			value: { ...sampleCase("c_1"), title: String(current) },
		}));
		same(created.title, "undefined");
		same((await store.listCases()).length, 1);
	},

	"updates at the same time all count": async (store) => {
		await putCase(store, { ...sampleCase("c_1"), title: "" });
		await Promise.all(
			["a", "b", "c"].map((letter) =>
				store.updateCase("c_1", (current) => ({
					value: {
						...(current ?? sampleCase("c_1")),
						title: `${current?.title}${letter}`,
					},
				})),
			),
		);
		same((await store.getCase("c_1"))?.title.length, 3);
	},

	"updateCase changes nothing when the change throws or renames the case":
		async (store) => {
			await putCase(store, sampleCase("c_1"));
			await rejects(
				store.updateCase("c_1", () => {
					throw new Error("no");
				}),
				"no",
			);
			await rejects(
				store.updateCase("c_1", () => ({
					value: sampleCase("c_2"),
					images: new Map([["crops/m1.webp", image()]]),
				})),
				"cannot become c_2",
			);
			same(await store.getCase("c_2"), undefined);
			same(await held(store, "c_1", ["crops/m1.webp"]), []);
			same(await held(store, "c_2", ["crops/m1.webp"]), []);
			same((await store.getCase("c_1"))?.title, "Button contrast");
		},

	"an updateCase that fails halfway keeps nothing of it": async (store) => {
		await putCase(store, { ...sampleCase("c_1"), title: "Old" });
		await rejects(
			store.updateCase("c_1", (current) => ({
				value: { ...(current ?? sampleCase("c_1")), title: "New" },
				images: new Map([
					["crops/m1.webp", image()],
					["crops/m2.webp", cannotBeStored],
				]),
			})),
			"",
		);
		same((await store.getCase("c_1"))?.title, "Old");
		same(await held(store, "c_1", ["crops/m1.webp", "crops/m2.webp"]), []);
	},

	"deleteImages deletes only the paths named": async (store) => {
		await store.putImage("c_1", "pending/p_a.webp", image());
		await store.putImage("c_1", "shots/s1.webp", image());
		await store.deleteImages("c_1", ["pending/p_a.webp", "pending/p_x.webp"]);
		same(await held(store, "c_1", ["pending/p_a.webp", "shots/s1.webp"]), [
			"shots/s1.webp",
		]);
	},

	"sweepPending deletes old and undated pending screenshots only": async (
		store,
	) => {
		await store.putImage("c_1", "pending/p_old.webp", image("x", 1000));
		await store.putImage("c_1", "pending/p_new.webp", image("x", 9000));
		await store.putImage("c_2", "pending/p_undated.webp", image());
		await store.putImage("c_1", "shots/s1.webp", image());
		await store.putImage("c_1", "shots/s2.webp", image("x", 1000));
		same(await store.sweepPending(5000), 2);
		same(
			await held(store, "c_1", [
				"pending/p_old.webp",
				"pending/p_new.webp",
				"shots/s1.webp",
				"shots/s2.webp",
			]),
			["pending/p_new.webp", "shots/s1.webp", "shots/s2.webp"],
		);
		same(await held(store, "c_2", ["pending/p_undated.webp"]), []);
		same(await store.sweepPending(5000), 0);
	},

	"replaceCase swaps the case and all its images": async (store) => {
		await putCase(store, { ...sampleCase("c_1"), title: "Old" });
		await store.putImage("c_1", "crops/m9.webp", image("old"));
		await store.putImage("c_1", "shots/s1.webp", image("old"));
		await store.putImage("c_10", "shots/s1.webp", image("other"));
		await store.replaceCase(
			{ ...sampleCase("c_1"), title: "New" },
			new Map([["shots/s1.webp", image("new")]]),
		);
		same((await store.getCase("c_1"))?.title, "New");
		same(await text(store, "c_1", "shots/s1.webp"), "new");
		same(await held(store, "c_1", ["crops/m9.webp"]), []);
		same(await text(store, "c_10", "shots/s1.webp"), "other");
	},

	"a replaceCase that fails keeps the old case and images": async (store) => {
		await putCase(store, { ...sampleCase("c_1"), title: "Old" });
		await store.putImage("c_1", "shots/s1.webp", image("old"));
		await store.putImage("c_1", "crops/m1.webp", image("old"));
		const fresh = { ...sampleCase("c_1"), title: "New" };
		const badCase = { ...fresh, verdict: (() => "no") as unknown } as Case;
		await rejects(
			store.replaceCase(badCase, new Map([["shots/s1.webp", image("new")]])),
			"",
		);
		await rejects(
			store.replaceCase(
				fresh,
				new Map([
					["shots/s1.webp", image("new")],
					["crops/m1.webp", cannotBeStored],
				]),
			),
			"",
		);
		same((await store.getCase("c_1"))?.title, "Old");
		same(await text(store, "c_1", "shots/s1.webp"), "old");
		same(await text(store, "c_1", "crops/m1.webp"), "old");
	},
};
