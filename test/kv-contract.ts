/**
 * What every `Kv` does: worker.test.ts runs this on `memoryKv`,
 * e2e/store.test.ts on `openKv` in a browser's IndexedDB. It bundles for a
 * page, so no `bun:test` here. Each case gets an empty `Kv`.
 */

import type { Kv } from "../src/worker/kv.ts";

function same(actual: unknown, expected: unknown): void {
	const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
	if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

async function rejects(work: Promise<unknown>): Promise<void> {
	let failed = false;
	try {
		await work;
	} catch {
		failed = true;
	}
	if (!failed) throw new Error("expected a failure");
}

const sorted = (o: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export const kvContract: Record<string, (kv: Kv) => Promise<void>> = {
	"a missing key is undefined; what is set is read back": async (kv) => {
		same(await kv.get("relay"), undefined);
		same(await kv.all(), {});
		await kv.set({ relay: "https://r.test", replaced: { sibling: true } });
		same(await kv.get("relay"), "https://r.test");
		same(await kv.get("replaced"), { sibling: true });
		same(sorted(await kv.all()), {
			relay: "https://r.test",
			replaced: { sibling: true },
		});
	},

	"set overwrites, remove removes": async (kv) => {
		await kv.set({ keepAiOn: true, blurForms: true });
		await kv.set({ keepAiOn: false });
		await kv.remove("blurForms");
		await kv.remove("never-there");
		same(await kv.all(), { keepAiOn: false });
	},

	"values are copies, not the caller's objects": async (kv) => {
		const replaced = { sibling: true };
		await kv.set({ replaced });
		replaced.sibling = false;
		same(await kv.get("replaced"), { sibling: true });
		const read = (await kv.get("replaced")) as { sibling: boolean };
		read.sibling = false;
		same(await kv.get("replaced"), { sibling: true });
	},

	"a write with a value that cannot be kept writes none of it": async (kv) => {
		await rejects(kv.set({ relay: "https://r.test", bad: () => "no" }));
		same(await kv.all(), {});
		await kv.set({ relay: "https://r.test" });
		same(await kv.all(), { relay: "https://r.test" });
	},

	"update reads every entry and writes in one step; a change that throws writes nothing":
		async (kv) => {
			if (kv.update === undefined) throw new Error("no update");
			await kv.set({ a: 1, b: 2 });
			await kv.update((all) => ({
				set: { c: (all["a"] as number) + (all["b"] as number) },
				remove: ["a"],
			}));
			same(sorted(await kv.all()), { b: 2, c: 3 });
			await kv.update(() => undefined);
			same(sorted(await kv.all()), { b: 2, c: 3 });
			await rejects(
				kv.update(() => {
					throw new Error("no");
				}),
			);
			await rejects(
				kv.update(() => ({ set: { d: () => "no" }, remove: ["b"] })),
			);
			same(sorted(await kv.all()), { b: 2, c: 3 });
		},
};
