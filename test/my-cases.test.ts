import { describe, expect, test } from "bun:test";
import type { Case, Mark } from "../src/lib/case.ts";
import {
	cardHandOver,
	mineTest,
	waitsText,
	waitsToVerify,
} from "../src/sidepanel/my-cases.ts";
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
		members: [TESS, DANA],
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
	test("not signed in, no team, a sign-in that ran out, or a server that assigns no cases: no filter", () => {
		expect(mineTest(initialState().cloud)).toBeUndefined();
		// The server listed no members (404 from a server from before).
		expect(mineTest(cloud({ members: undefined }))).toBeUndefined();
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
		// Back with the reporter: who had it does not help, and the counts
		// say "to verify" already.
		expect(cardHandOver(one("c_1", true, { assignee: DANA }), cloud())).toEqual(
			{ state: undefined, assignee: undefined },
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
		expect(
			cardHandOver(c, cloud({ members: undefined })).assignee,
		).toBeUndefined();
		expect(cardHandOver(sampleCase(), cloud()).state).toBeUndefined();
	});
});

describe("This page for whoever came to verify (DEC-079)", () => {
	const PAGE = "https://www.example.com/kk";
	const OTHER = "https://www.example.com/other";
	/** Marks 1 and 2 on PAGE, 3 on OTHER, with these statuses. */
	const three = (
		statuses: ("open" | "fixed" | "wontfix")[],
		more: Partial<Case> = {},
	): Case => {
		const c = withOneMark(sampleCase("c_3"));
		const a = c.marks[0] as Mark;
		const shot = c.shots[0] as Case["shots"][number];
		return {
			...c,
			shots: [shot, { ...shot, id: "s2", url: OTHER }],
			marks: statuses.map((st, i) => ({
				...a,
				id: `m${i + 1}`,
				number: i + 1,
				shot: i < 2 ? "s1" : "s2",
				...(st === "open" ? {} : { resolution: { kind: st, at: c.updatedAt } }),
			})),
			...more,
		};
	};
	const signedOut = initialState().cloud;

	test("the team's case: to verify, and I started it", () => {
		const team = cloud();
		const c = three(["fixed", "fixed", "fixed"], {
			createdBy: TESS,
			assignee: DANA,
		});
		expect(waitsToVerify(c, PAGE, team)).toEqual({ here: 2, elsewhere: 1 });
		// Started by someone else: not mine to verify.
		expect(
			waitsToVerify({ ...c, createdBy: DANA }, PAGE, team),
		).toBeUndefined();
		// A mark still open: in progress, the assignee's turn.
		expect(
			waitsToVerify(
				three(["fixed", "open", "fixed"], { createdBy: TESS }),
				PAGE,
				team,
			),
		).toBeUndefined();
		// To verify, but nothing of it on this page: said, with where.
		const there = three(["wontfix", "wontfix", "fixed"], { createdBy: TESS });
		expect(waitsToVerify(there, PAGE, team)).toEqual({
			here: 0,
			elsewhere: 1,
		});
	});

	test("signed out, or a case of this browser only: fixed marks on this page", () => {
		const c = three(["fixed", "open", "fixed"]);
		expect(waitsToVerify(c, PAGE, signedOut)).toEqual({
			here: 1,
			elsewhere: 1,
		});
		const local = cloud({ modes: { c_3: "local" } });
		expect(waitsToVerify(c, PAGE, local)).toEqual({ here: 1, elsewhere: 1 });
		// None on this page: the ordinary sentence.
		expect(
			waitsToVerify(three(["open", "open", "fixed"]), PAGE, signedOut),
		).toBeUndefined();
	});

	test("what it says", () => {
		expect(waitsText({ here: 3, elsewhere: 1 })).toBe(
			"3 marks wait for you to verify on this page.",
		);
		expect(waitsText({ here: 1, elsewhere: 0 })).toBe(
			"1 mark waits for you to verify on this page.",
		);
		expect(waitsText({ here: 0, elsewhere: 2 })).toBe(
			"2 marks wait for you to verify, on other pages of this case.",
		);
	});
});
