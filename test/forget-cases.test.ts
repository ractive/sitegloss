import { expect, test } from "bun:test";
import { CASES, CASES_KEY, forgetCases } from "../src/lib/cloud/book.ts";
import { memoryKv } from "../src/lib/kv.ts";

const A = "@https://app.sitegloss.dev ";
const B = "@http://localhost:3200 ";

test("forgetCases: what was kept about cases goes, for every server and 0.3.0's keys; the server, account and tokens stay (DEC-051)", async () => {
	const account = {
		server: "https://app.sitegloss.dev",
		user: { id: "u_1", name: "Tess", email: "tess@example.com" },
		teams: [],
		teamId: "t_1",
		checkedAt: 1,
	};
	const kv = memoryKv({
		server: "https://app.sitegloss.dev",
		[`${A}account`]: { ...account, expired: true, liveDeletes: ["c_1"] },
		[`${A}tokens`]: { access: "x" },
		[`${A}endpoints`]: { token: "y" },
		[`${A}case:c_1`]: { caseId: "c_1" },
		[`${A}cursor`]: 12,
		[`${A}queue`]: { ops: [] },
		[`${A}whole`]: 1,
		[`${A}modes`]: {},
		[`${A}status`]: { state: "problem" },
		[`${B}account`]: account,
		[`${B}case:c_2`]: { caseId: "c_2" },
		[`${B}cursor`]: 3,
		// As 0.3.0 kept them, before the servers' scopes (DEC-041).
		account,
		"case:c_3": { caseId: "c_3" },
		cursor: 7,
		queue: { ops: [] },
	});
	await forgetCases(kv);
	expect(await kv.all()).toEqual({
		server: "https://app.sitegloss.dev",
		[`${A}account`]: { ...account, expired: true },
		[`${A}tokens`]: { access: "x" },
		[`${A}endpoints`]: { token: "y" },
		[`${B}account`]: account,
		account,
		[CASES_KEY]: CASES,
	});
	// Once: what is kept after it is this build's, and stays.
	await kv.set({ [`${A}case:c_4`]: { caseId: "c_4" }, [`${A}cursor`]: 1 });
	await forgetCases(kv);
	expect(await kv.get(`${A}case:c_4`)).toEqual({ caseId: "c_4" });
	expect(await kv.get(`${A}cursor`)).toBe(1);
});

test("forgetCases: two contexts at once forget once, in one step; a database that cannot change in one step is refused", async () => {
	const kv = memoryKv({
		[`${A}case:c_1`]: { caseId: "c_1" },
		[`${A}cursor`]: 12,
	});
	await Promise.all([forgetCases(kv), forgetCases(kv)]);
	expect(await kv.all()).toEqual({ [CASES_KEY]: CASES });
	// What the engine writes after the marker stays, whoever calls again.
	await kv.set({ [`${A}case:c_1`]: { caseId: "c_1", again: true } });
	await forgetCases(kv);
	expect(await kv.get(`${A}case:c_1`)).toEqual({ caseId: "c_1", again: true });
	const { update: _update, ...plain } = memoryKv({ cursor: 1 });
	await expect(forgetCases(plain)).rejects.toThrow("in one step");
});
