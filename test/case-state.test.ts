import { describe, expect, test } from "bun:test";
import {
	type Case,
	type Mark,
	type ResolutionKind,
	validateCase,
	withAssigned,
} from "../src/lib/case.ts";
import {
	type CaseState,
	caseState,
	caseTurn,
	isMine,
	mineFor,
	stateOf,
	type Turn,
	turnOf,
} from "../src/lib/case-state.ts";
import vectors from "./case-state.json" with { type: "json" };
import { sampleCase } from "./fixtures.ts";

describe("where a case stands: the server's rule, held to the server's own vectors", () => {
	// test/case-state.json is sitegloss.dev's packages/api/vectors/case-state.json.
	test("caseState gives every state in the vectors", () => {
		expect(vectors.states.length).toBeGreaterThan(10);
		for (const v of vectors.states)
			expect([v, caseState(v.counts, v.closed)]).toEqual([
				v,
				v.state as CaseState,
			]);
	});

	test("caseTurn gives every turn in the vectors", () => {
		for (const v of vectors.turns)
			expect([v, caseTurn(v.state as CaseState, v.assigned)]).toEqual([
				v,
				v.turn as Turn,
			]);
	});

	test("isMine gives every answer in the vectors", () => {
		for (const v of vectors.mine)
			expect([v, isMine(v.state as CaseState, v)]).toEqual([v, v.mine]);
	});
});

const DANA = { id: "u_dana", name: "Dana" };
const TESS = { id: "u_tess", name: "Tess" };

/** A case with marks of these statuses, started by `by`. */
function caseWith(
	statuses: (ResolutionKind | "open")[],
	extra: Partial<Case> = {},
): Case {
	const marks: Mark[] = statuses.map((s, i) => ({
		id: `m${i + 1}`,
		number: i + 1,
		shot: "s1",
		comment: "",
		author: "user",
		shape: { kind: "note", at: { x: 1, y: 1 } },
		crop: `crops/m${i + 1}.webp`,
		element: null,
		...(s === "open"
			? {}
			: { resolution: { kind: s, at: "2026-11-23T10:00:00Z" } }),
	}));
	return { ...sampleCase(), marks, ...extra };
}

describe("my cases: the open ones where it is my turn", () => {
	test("a case only in this browser is mine while it is open", () => {
		expect(mineFor(caseWith(["open"]), "u_dana", false)).toBe(true);
		expect(mineFor(caseWith([]), "u_dana", false)).toBe(true);
		const closed = {
			...caseWith(["open"]),
			closed: { at: "2026-11-23T10:00:00Z" },
		};
		expect(mineFor(closed, "u_dana", false)).toBe(false);
	});

	test("a team's case with open marks is the assignee's, or its reporter's while nobody has it", () => {
		const open = caseWith(["open", "fixed"], {
			createdBy: TESS,
			assignee: DANA,
		});
		expect(stateOf(open)).toBe("in progress");
		expect(turnOf(open)).toBe("assignee");
		expect(mineFor(open, DANA.id, true)).toBe(true);
		expect(mineFor(open, TESS.id, true)).toBe(false);
		const nobody = { ...open, assignee: null };
		expect(turnOf(nobody)).toBe("nobody");
		expect(mineFor(nobody, TESS.id, true)).toBe(true);
		expect(mineFor(nobody, DANA.id, true)).toBe(false);
	});

	test("an assignment that waits to be sent counts as made", () => {
		const open = caseWith(["open"], { createdBy: TESS, assignee: null });
		const given = withAssigned(open, DANA, "2026-11-23T11:00:00.000Z");
		expect(given.assign).toEqual({ to: DANA, at: "2026-11-23T11:00:00.000Z" });
		expect(mineFor(given, DANA.id, true)).toBe(true);
		expect(mineFor(given, TESS.id, true)).toBe(false);
	});

	test("fixed or settled goes back to the reporter, whoever has it", () => {
		const check = caseWith(["fixed", "wontfix"], {
			createdBy: TESS,
			assignee: DANA,
		});
		expect(stateOf(check)).toBe("to verify");
		expect(mineFor(check, TESS.id, true)).toBe(true);
		expect(mineFor(check, DANA.id, true)).toBe(false);
		const done = caseWith(["verified" as ResolutionKind], { createdBy: TESS });
		expect(mineFor(done, TESS.id, true)).toBe(stateOf(done) === "settled");
	});

	test("a team's case whose reporter is not back from the server yet is taken as the person's own", () => {
		expect(mineFor(caseWith([]), DANA.id, true)).toBe(true);
	});
});

describe("assigning in this browser", () => {
	const at = "2026-11-23T11:00:00.000Z";

	test("waits to be sent, and the server's own assignee again takes it back", () => {
		const c = caseWith(["open"], { assignee: DANA });
		const moved = withAssigned(c, TESS, at);
		expect(moved.assign?.to).toEqual(TESS);
		expect(moved.updatedAt).toBe(at);
		const back = withAssigned(moved, DANA, "2026-11-23T11:01:00.000Z");
		expect(back.assign).toBeUndefined();
		expect(back.assignee).toEqual(DANA);
	});

	test("nobody is an assignment too, and the same again changes nothing", () => {
		const c = caseWith(["open"], { assignee: DANA });
		const cleared = withAssigned(c, null, at);
		expect(cleared.assign).toEqual({ to: null, at });
		expect(withAssigned(cleared, null, "2026-11-23T12:00:00.000Z")).toBe(
			cleared,
		);
	});

	test("the records and the waiting assignment survive validation, and a person never carries more than id and name", () => {
		const c = withAssigned(
			{ ...sampleCase(), createdBy: TESS, assignee: null },
			{ ...DANA, email: "dana@example.com" } as typeof DANA,
			at,
		);
		const read = validateCase(
			JSON.parse(
				JSON.stringify({
					...c,
					assignedBy: { at, user: TESS },
				}),
			),
		);
		expect(read.createdBy).toEqual(TESS);
		expect(read.assignee).toBeNull();
		expect(read.assignedBy).toEqual({ at, user: TESS });
		expect(read.assign).toEqual({ to: DANA, at });
	});
});
