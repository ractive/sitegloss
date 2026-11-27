import { describe, expect, test } from "bun:test";
import {
	type Case,
	FINDING_COMMENT,
	findingCommentId,
	findingsAsComments,
	validateCase,
} from "../src/lib/case.ts";
import { exportCase } from "../src/lib/export.ts";
import { MemoryStore, upgradedCase } from "../src/lib/store.ts";
import { readZip } from "../src/lib/zip.ts";
import vectors from "./finding-comment-id.json" with { type: "json" };
import { putCase, putMarked, sampleCase, withOneMark } from "./fixtures.ts";

const CLAUDE = {
	id: "https://claude.ai/oauth",
	name: "Claude",
	host: "claude.ai",
};

/** Case c_old as a build before DEC-081 stored it: mark 1 with two findings, and a comment of the thread. */
const stored = () => {
	const c = withOneMark(sampleCase("c_old"));
	return {
		...c,
		comments: [
			{ id: "k_1", text: "Before", at: "2026-11-10T09:00:00Z" },
			{ id: "k_2", text: "After", at: "2026-11-10T12:00:00Z" },
		],
		marks: c.marks.map((a) => ({
			...a,
			findings: [
				{
					id: "f_a",
					text: "  Button_primary sets the grey.  ",
					app: CLAUDE,
					at: "2026-11-10T10:00:00Z",
					editedAt: "2026-11-10T11:00:00Z",
					user: { id: "u_dana", name: "Dana" },
				},
				{
					id: "f_b",
					text: "From the file.",
					app: CLAUDE,
					at: "2026-11-10T13:00:00Z",
					imported: true,
				},
				{ id: "f_c", text: "   ", app: CLAUDE, at: "2026-11-10T14:00:00Z" },
			],
		})),
	};
};

describe("findings become comments on their mark (DEC-081)", () => {
	// test/finding-comment-id.json is sitegloss.dev's packages/api/vectors/finding-comment-id.json.
	// The id has the server's shape and its function; made from the ids here, not the server's value.
	test("the comment's id is the server's function, for every case of its vectors", () => {
		for (const v of vectors.vectors)
			expect([v, findingCommentId(v.markId, v.findingId)]).toEqual([v, v.id]);
	});

	test("each keeps its text, time, app, person and whether it came from a file, in the thread by its time", () => {
		const c = validateCase(findingsAsComments(stored()));
		expect("findings" in (c.marks[0] as object)).toBe(false);
		expect(c.comments).toEqual([
			{ id: "k_1", text: "Before", at: "2026-11-10T09:00:00Z" },
			{
				id: findingCommentId("m1", "f_a"),
				mark: "m1",
				text: "  Button_primary sets the grey.  ",
				at: "2026-11-10T10:00:00Z",
				user: { id: "u_dana", name: "Dana" },
				app: CLAUDE,
				edited: {
					at: "2026-11-10T11:00:00Z",
					user: { id: "u_dana", name: "Dana" },
					app: CLAUDE,
				},
			},
			{ id: "k_2", text: "After", at: "2026-11-10T12:00:00Z" },
			{
				id: findingCommentId("m1", "f_b"),
				mark: "m1",
				text: "From the file.",
				at: "2026-11-10T13:00:00Z",
				app: CLAUDE,
				imported: true,
			},
		]);
		expect(c.comments?.[1]?.id).toMatch(FINDING_COMMENT);
	});

	test("what does not fit the thread's 1,000 comments stays on its mark, as it was, until there is room; an export leaves it out", async () => {
		const full = {
			...stored(),
			comments: Array.from({ length: 999 }, (_, i) => ({
				id: `k_${i}`,
				text: "x",
				at: "2026-11-01T00:00:00Z",
			})),
		};
		const once = validateCase(full);
		expect(once.comments).toHaveLength(1000);
		expect(once.marks[0]?.findings).toEqual([stored().marks[0]?.findings[1]]);
		const store = new MemoryStore();
		// Its images, then the case as it is, the finding left on its mark.
		await putMarked(store, once);
		await putCase(store, once);
		expect((await store.getCase(once.id))?.marks[0]?.findings).toHaveLength(1);
		const files = await readZip(await exportCase(store, once));
		expect(new TextDecoder().decode(files.get("case.json"))).not.toContain(
			'"findings"',
		);
	});

	test("once: run again, or on a case with none, nothing changes", () => {
		const once = findingsAsComments(stored());
		expect(findingsAsComments(once)).toBe(once);
		// Read again from a file that still has them: the same comments, no second.
		const again = findingsAsComments({
			...(once as Case),
			marks: stored().marks,
		}) as Case;
		expect(again.comments).toEqual((once as Case).comments);
		const plain = withOneMark(sampleCase("c_new"));
		expect(findingsAsComments(plain)).toBe(plain);
	});

	test("the store's upgrade rewrites a case with findings, leaves others alone, and keeps a case it cannot read as it was", () => {
		expect(upgradedCase(stored())).toEqual(findingsAsComments(stored()));
		expect(upgradedCase(withOneMark(sampleCase("c_new")))).toBeUndefined();
		const broken = {
			...stored(),
			marks: [{ id: "m1", findings: [{ id: 3, text: null }] }],
		};
		expect(upgradedCase(broken)).toBeUndefined();
	});
});
