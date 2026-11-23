import { describe, expect, test } from "bun:test";
import type { Case, Mark } from "../src/lib/case.ts";
import { cardHandOver, mineTest } from "../src/sidepanel/my-cases.ts";
import { initialState, type PanelState } from "../src/sidepanel/state.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";

const TESS = { id: "u_tess", name: "Tess" };
const DANA = { id: "u_dana", name: "Dana" };

function cloud(
	more: Partial<PanelState["cloud"]> = {},
	account: object = {},
): PanelState["cloud"] {
	return {
		...initialState().cloud,
		account: {
			name: "Tess",
			email: "tess@example.com",
			userId: TESS.id,
			server: "https://app.sitegloss.dev",
			teams: [{ id: "t_1", name: "Web", permissions: ["case:update"] }],
			teamId: "t_1",
			expired: false,
			...account,
		},
		...more,
	};
}

/** Case `id` with one open mark, or one fixed. */
function one(id: string, fixed = false, more: Partial<Case> = {}): Case {
	const c = withOneMark(sampleCase(id));
	const a = c.marks[0] as Mark;
	return {
		...c,
		marks: [
			fixed ? { ...a, resolution: { kind: "fixed", at: c.updatedAt } } : a,
		],
		...more,
	};
}

describe("My cases in the list", () => {
	test("not signed in, no team, or a sign-in that ran out: no filter", () => {
		expect(mineTest(initialState().cloud)).toBeUndefined();
		expect(mineTest(cloud({}, { teamId: undefined }))).toBeUndefined();
		expect(mineTest(cloud({}, { expired: true }))).toBeUndefined();
	});

	test("the team's cases where it is my turn, and every open case only in this browser", () => {
		const mine = mineTest(cloud({ modes: { c_here: "local" } }));
		const cases = [
			one("c_given", false, { createdBy: DANA, assignee: TESS }),
			one("c_theirs", false, { createdBy: TESS, assignee: DANA }),
			one("c_back", true, { createdBy: TESS, assignee: DANA }),
			one("c_waits", false, { createdBy: TESS, assignee: null }),
			one("c_here", false, { createdBy: DANA, assignee: DANA }),
		];
		expect(cases.filter((c) => mine?.(c)).map((c) => c.id)).toEqual([
			"c_given",
			"c_back",
			"c_waits",
			"c_here",
		]);
	});
});

describe("a card's hand-over", () => {
	test("the state as a badge, and who has the open marks in the team's case", () => {
		expect(
			cardHandOver(one("c_1", false, { assignee: DANA }), cloud()),
		).toEqual({ state: "New", assignee: "Assigned to Dana" });
		expect(
			cardHandOver(one("c_1", false, { assignee: TESS }), cloud()),
		).toEqual({ state: "New", assignee: "Assigned to you" });
		expect(
			cardHandOver(one("c_1", false, { assignee: null }), cloud()).assignee,
		).toBe("Nobody assigned");
		// Back with the reporter: who had it does not help.
		expect(cardHandOver(one("c_1", true, { assignee: DANA }), cloud())).toEqual(
			{ state: "To verify", assignee: undefined },
		);
	});

	test("nothing about assignees when not signed in, for a case kept here, or from a server that tells none", () => {
		const c = one("c_1", false, { assignee: DANA });
		expect(cardHandOver(c, initialState().cloud)).toEqual({
			state: "New",
			assignee: undefined,
		});
		expect(
			cardHandOver(c, cloud({ modes: { c_1: "local" } })).assignee,
		).toBeUndefined();
		expect(cardHandOver(one("c_1"), cloud()).assignee).toBeUndefined();
		expect(cardHandOver(sampleCase(), cloud()).state).toBeUndefined();
	});
});
