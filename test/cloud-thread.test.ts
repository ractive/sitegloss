/**
 * A case's thread, its closing and the AI app's name in the sync with a team
 * (DEC-046; the server's DEC-017 to DEC-019), against the API in memory.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	type Case,
	isOwnComment,
	newId,
	withAssigned,
	withCaseComment,
	withCaseCommentText,
	withClosed,
	withComment,
	withoutCaseComment,
	withoutMark,
	withResolution,
} from "../src/lib/case.ts";
import { mineFor } from "../src/lib/case-state.ts";
import { ApiFailure, type Op } from "../src/lib/cloud/api.ts";
import { type CaseBook, KEYS, membersOf } from "../src/lib/cloud/book.ts";
import { ACCOUNT_FRESH_MS } from "../src/lib/cloud/engine.ts";
import { commentIn, mergeCase, viaOf } from "../src/lib/cloud/wire.ts";
import { exportCase, readExport, storeImport } from "../src/lib/export.ts";
import { nextStep } from "../src/sidepanel/next-step.ts";
import type { FakeApi } from "./cloud-fake.ts";
import { FakeServer, TEAM } from "./cloud-fake.ts";
import {
	addMark,
	change,
	type Device,
	device,
	PAY,
	signIn,
	startCase,
	status,
	sync,
} from "./cloud-helpers.ts";

const TESS = { id: "u_tess", name: "Tess Tester" };
const DANA = { id: "u_dana", name: "Dana Developer" };
const CLAUDE = {
	id: "https://claude.ai/oauth",
	name: "Claude",
	host: "claude.ai",
};

let server: FakeServer;
let tess: Device<FakeApi>;
let dana: Device<FakeApi>;

beforeEach(() => {
	server = new FakeServer();
	tess = device("tess", server.api(TESS));
	dana = device("dana", server.api(DANA));
});

const book = (d: Device, caseId: string) =>
	d.kv.data.get(`case:${caseId}`) as CaseBook | undefined;
/** The operations a device sent, of these types. */
const sent = (d: Device<FakeApi>, ...types: Op["type"][]): Op[] =>
	(d.api as unknown as { sentOps?: Op[] }).sentOps?.filter((o) =>
		types.includes(o.type),
	) ?? [];
/** The summary for the developer, as the panel writes it. */
const withVerdict = (c: Case, verdict: string, now: string): Case => ({
	...c,
	verdict,
	updatedAt: now,
});
/** The requests a device made since the last look, and forgets them. */
const calls = (d: Device<FakeApi>): string[] => d.api.calls.splice(0);
const caseHere = async (d: Device, id = "c_flow") =>
	(await d.store.getCase(id)) as Case;

/** Record every operation a device sends. */
function recording(d: Device<FakeApi>): void {
	const api = d.api as FakeApi & { sentOps?: Op[] };
	api.sentOps = [];
	const ops = api.ops.bind(api);
	api.ops = async (team, list) => {
		api.sentOps?.push(...structuredClone(list));
		return ops(team, list);
	};
}

async function shared(): Promise<void> {
	await signIn(tess);
	await signIn(dana);
	await startCase(tess, "c_flow");
	await addMark(tess, "c_flow", "Total is cut off");
	await addMark(tess, "c_flow", "Pay button too pale", { url: PAY });
	await sync(tess, dana);
}

describe("the thread", () => {
	test("a comment on the case and one on a mark reach the team, with who wrote them; changed and deleted, also without a case named", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_case", text: "Looked at both pages." }, now),
		);
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(
				c,
				{ id: "k_mark", text: "Which total?", mark: "m1" },
				now,
			),
		);
		await sync(tess, dana);
		expect(server.commentsOf("c_flow").map((k) => k.text)).toEqual([
			"Looked at both pages.",
			"Which total?",
		]);
		const there = (await caseHere(dana)).comments ?? [];
		expect(there.map((k) => [k.id, k.mark ?? null, k.user?.name])).toEqual([
			["k_case", null, "Tess Tester"],
			["k_mark", "m1", "Tess Tester"],
		]);
		// Tess's own comment, changed and then deleted by her.
		await change(tess, "c_flow", (c, now) =>
			withCaseCommentText(c, "k_mark", "Which total, net or gross?", now),
		);
		await sync(tess, dana);
		const edited = (await caseHere(dana)).comments?.[1];
		expect(edited?.text).toBe("Which total, net or gross?");
		expect(edited?.edited?.user?.name).toBe("Tess Tester");
		await change(tess, "c_flow", (c, now) =>
			withoutCaseComment(c, "k_case", now),
		);
		await sync(tess, dana);
		// The server lists the delete with no case: found by the comment's id.
		expect(server.changes(0).removed).toContainEqual(
			expect.objectContaining({ type: "comment", id: "k_case" }),
		);
		expect((await caseHere(dana)).comments?.map((k) => k.id)).toEqual([
			"k_mark",
		]);
		expect(book(dana, "c_flow")?.shadow?.comments?.["k_case"]).toBeUndefined();
	});

	test("another's comment that is no longer here is not deleted for the team: only one's own", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_dana", text: "Dana's word" }, now),
		);
		await sync(dana, tess);
		recording(tess);
		// Gone from Tess's copy (a file replaced it, say).
		await change(tess, "c_flow", (c, now) => ({
			...c,
			comments: [],
			updatedAt: now,
		}));
		await sync(tess, dana);
		expect(sent(tess, "comment.delete")).toEqual([]);
		expect(server.commentsOf("c_flow").map((k) => k.id)).toEqual(["k_dana"]);
	});

	test("a comment written offline waits and goes when the server is back, at the end of the thread with its own time", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_first", text: "First" }, now),
		);
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_offline", text: "Written offline" }, now),
		);
		const writtenAt = (await caseHere(tess)).comments?.[0]?.at;
		await tess.engine.request();
		await dana.engine.request();
		tess.api.offline = false;
		await sync(tess, dana);
		expect(server.commentsOf("c_flow").map((k) => k.id)).toEqual([
			"k_first",
			"k_offline",
		]);
		expect(server.commentsOf("c_flow")[1]?.at).toBe(writtenAt as string);
		expect((await caseHere(dana)).comments?.map((k) => k.id)).toEqual([
			"k_first",
			"k_offline",
		]);
	});

	test("a comment follows its mark when the mark takes another number; one about a deleted mark stays, about a deleted mark", async () => {
		await shared();
		// Both add a mark at once: Tess's becomes 4, and her comment follows it.
		await addMark(tess, "c_flow", "Tess's third");
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(
				c,
				{ id: "k_on3", text: "About my third", mark: "m3" },
				now,
			),
		);
		await addMark(dana, "c_flow", "Dana's third");
		await dana.engine.request();
		await sync(tess, dana);
		const c = await caseHere(tess);
		const mine = c.marks.find((a) => a.comment === "Tess's third");
		expect(mine?.id).toBe("m4");
		expect(c.comments?.[0]?.mark).toBe("m4");
		expect((await caseHere(dana)).comments?.[0]?.mark).toBe("m4");
		// The mark deleted: the comment stays, about a deleted mark.
		await change(tess, "c_flow", (c, now) => withoutMark(c, "m4", now));
		await sync(tess, dana);
		const left = (await caseHere(dana)).comments?.[0];
		expect(left?.mark).toBeUndefined();
		expect(left?.markGone).toBe(true);
	});

	test("read whole again, the thread is in the server's order", async () => {
		await shared();
		for (const [who, id] of [
			[tess, "k_1"],
			[dana, "k_2"],
			[tess, "k_3"],
		] as const) {
			await change(who, "c_flow", (c, now) =>
				withCaseComment(c, { id, text: id }, now),
			);
			await who.engine.request();
		}
		await sync(tess, dana);
		// A new device of Dana's reads everything.
		const fresh = device("dana", server.api(DANA));
		await signIn(fresh);
		await sync(fresh);
		expect((await caseHere(fresh)).comments?.map((k) => k.id)).toEqual([
			"k_1",
			"k_2",
			"k_3",
		]);
	});
});

describe("closing", () => {
	test("closed for the team, with who; a new open mark opens it again at the server, and here", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) => withClosed(c, true, now));
		await sync(tess, dana);
		expect(server.caseOf("c_flow")?.closed?.user?.name).toBe("Tess Tester");
		expect((await caseHere(dana)).closed?.user?.name).toBe("Tess Tester");
		// Dana adds an open mark: the case is open again, here and there.
		await addMark(dana, "c_flow", "One more thing");
		expect((await caseHere(dana)).closed).toBeUndefined();
		await sync(dana, tess);
		expect(server.caseOf("c_flow")?.closed).toBeNull();
		expect((await caseHere(tess)).closed).toBeUndefined();
	});

	test("reopened by hand, and closed again with a new mark in the same run: the mark first, then the close", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) => withClosed(c, true, now));
		await sync(tess, dana);
		recording(dana);
		await change(dana, "c_flow", (c, now) => withClosed(c, false, now));
		await dana.engine.request();
		expect(sent(dana, "case.reopen")).toHaveLength(1);
		expect(server.caseOf("c_flow")?.closed).toBeNull();
		await addMark(dana, "c_flow", "Last one");
		await change(dana, "c_flow", (c, now) =>
			withClosed(
				withResolution(c, "m3", { kind: "fixed", note: "" }, now),
				true,
				now,
			),
		);
		await sync(dana, tess);
		const types = (dana.api as FakeApi & { sentOps: Op[] }).sentOps.map(
			(o) => o.type,
		);
		expect(types.lastIndexOf("case.close")).toBeGreaterThan(
			types.lastIndexOf("mark.create"),
		);
		expect(server.caseOf("c_flow")?.closed?.user?.name).toBe("Dana Developer");
		expect((await caseHere(tess)).closed).toBeDefined();
	});
});

describe("the hand-over (DEC-071)", () => {
	test("assigned here, it goes with the sync; the team reads who has it and who gave it, and who started the case", async () => {
		await shared();
		recording(tess);
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(tess, dana);
		expect(
			sent(tess, "case.patch").map((o) => "assignee" in o && o.assignee),
		).toEqual([DANA.id]);
		expect(server.caseOf("c_flow")?.assignee).toEqual(DANA);
		const there = await caseHere(dana);
		expect(there.assignee).toEqual(DANA);
		expect(there.assignedBy?.user).toEqual(TESS);
		expect(there.createdBy).toEqual(TESS);
		// Taken: nothing waits any more here.
		expect((await caseHere(tess)).assign).toBeUndefined();
		expect((await caseHere(tess)).assignee).toEqual(DANA);
	});

	test("a change that does not name the assignee leaves it, here and at the server", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(tess, dana);
		recording(dana);
		await change(dana, "c_flow", (c, now) =>
			withClosed(
				withVerdict(c, "Both are fixed by the new theme.", now),
				false,
				now,
			),
		);
		await change(dana, "c_flow", (c, now) =>
			withResolution(c, "m1", { kind: "fixed", note: "" }, now),
		);
		await sync(dana, tess);
		expect(sent(dana, "case.patch").some((o) => "assignee" in o)).toBe(false);
		expect(server.caseOf("c_flow")?.assignee).toEqual(DANA);
		expect((await caseHere(tess)).assignee).toEqual(DANA);
		expect((await caseHere(dana)).assignee).toEqual(DANA);
	});

	test("assigned while offline: it waits here, and goes once the server answers", async () => {
		await shared();
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await tess.engine.request();
		expect((await caseHere(tess)).assign?.to).toEqual({
			id: DANA.id,
			name: DANA.name,
		});
		expect(server.caseOf("c_flow")?.assignee).toBeNull();
		tess.api.offline = false;
		await sync(tess);
		expect(server.caseOf("c_flow")?.assignee).toEqual(DANA);
		expect((await caseHere(tess)).assign).toBeUndefined();
	});

	test("nobody is sent as null; a teammate's later assignment counts here", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(tess, dana);
		await change(dana, "c_flow", (c, now) => withAssigned(c, null, now));
		await sync(dana, tess);
		expect(server.caseOf("c_flow")?.assignee).toBeNull();
		expect((await caseHere(tess)).assignee).toBeNull();
		await change(dana, "c_flow", (c, now) =>
			withAssigned(c, { id: TESS.id, name: TESS.name }, now),
		);
		await sync(dana, tess);
		expect((await caseHere(tess)).assignee).toEqual(TESS);
	});

	test("the team's members are kept for the Assign menu; a server from before lists none", async () => {
		await shared();
		const kept = (d: Device) =>
			membersOf(d.kv.data.get(KEYS.members), TEAM)?.map((m) => m.name);
		expect(kept(tess)?.sort()).toEqual([DANA.name, TESS.name]);
		const old = new FakeServer();
		old.beforeAssignees = true;
		const pat = device("pat", old.api({ id: "u_pat", name: "Pat" }));
		await signIn(pat);
		await sync(pat);
		expect(kept(pat)).toBeUndefined();
	});

	test("an assignment the server refuses goes, and says why; the title changed with it still arrives", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withAssigned(
				{ ...c, title: "Cart and pay page" },
				{ id: "u_gone", name: "Gone" },
				now,
			),
		);
		await sync(tess);
		expect(server.caseOf("c_flow")?.title).toBe("Cart and pay page");
		expect(server.caseOf("c_flow")?.assignee).toBeNull();
		const here = await caseHere(tess);
		expect(here.assign).toBeUndefined();
		expect(here.assignee).toBeNull();
		expect(here.assignRefused?.text).toBe(
			"Gone is not in the team any more, so the case was not assigned to them.",
		);
		// Nothing more waits on it: a later change goes as usual.
		await change(tess, "c_flow", (c, now) =>
			withVerdict(c, "Both pages.", now),
		);
		await sync(tess);
		expect(server.caseOf("c_flow")?.summary).toBe("Both pages.");
		// The next assignment ends the note.
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		expect((await caseHere(tess)).assignRefused).toBeUndefined();
	});

	test("a pick back to the assignee the server has: nothing waits, nothing is sent", async () => {
		await shared();
		server.members.set("u_pat", { id: "u_pat", name: "Pat" });
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(tess);
		recording(tess);
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: "u_pat", name: "Pat" }, now),
		);
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		expect((await caseHere(tess)).assign?.to?.id).toBe(DANA.id);
		await tess.engine.request();
		expect(sent(tess, "case.patch").some((o) => "assignee" in o)).toBe(false);
		const here = await caseHere(tess);
		expect(here.assign).toBeUndefined();
		expect(here.assignee?.id).toBe(DANA.id);
		expect(server.caseOf("c_flow")?.assignee?.id).toBe(DANA.id);
	});

	test("a refusal that is not about the team says the server's reason, and goes once someone assigns the case", async () => {
		await shared();
		server.refuseWith = {
			type: "case.patch",
			code: "invalid",
			message: "Not now.",
		};
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(tess);
		expect((await caseHere(tess)).assignRefused?.text).toBe(
			"The server did not take the assignment to Dana Developer: Not now.",
		);
		server.refuseWith = undefined;
		// Dana assigns it from her device: the note is over.
		await sync(dana);
		await change(dana, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(dana, tess);
		const here = await caseHere(tess);
		expect(here.assignee?.id).toBe(DANA.id);
		expect(here.assignRefused).toBeUndefined();
	});

	test("an assignment whose request fails (the server is busy) waits, and goes later", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async () => {
			throw new ApiFailure("server", "Busy.", 503);
		};
		await tess.engine.request();
		const here = await caseHere(tess);
		expect(here.assign?.to?.id).toBe(DANA.id);
		expect(here.assignRefused).toBeUndefined();
		tess.api.ops = ops;
		await sync(tess);
		expect(server.caseOf("c_flow")?.assignee?.id).toBe(DANA.id);
		expect((await caseHere(tess)).assign).toBeUndefined();
	});

	test("a server that assigns no cases: no members kept, nothing read again, no assignee sent; once it does, the old cases are read", async () => {
		server.beforeAssignees = true;
		await shared();
		expect(tess.kv.data.get(KEYS.members)).toMatchObject({ members: null });
		expect(book(tess, "c_flow")?.reread).toBeUndefined();
		expect(book(tess, "c_flow")?.shadow?.assignee).toBeUndefined();
		recording(tess);
		await change(tess, "c_flow", (c, now) => withVerdict(c, "Both.", now));
		await sync(tess);
		expect(sent(tess, "case.patch").some((o) => "assignee" in o)).toBe(false);
		expect(book(tess, "c_flow")?.reread).toBeUndefined();
		// The server is updated: the next look at the members finds them, and
		// the case synced before is read again.
		server.beforeAssignees = false;
		tess.clock.now = new Date(tess.clock.now.getTime() + ACCOUNT_FRESH_MS);
		calls(tess);
		await tess.engine.request();
		expect(
			membersOf(tess.kv.data.get(KEYS.members), TEAM)?.length,
		).toBeGreaterThan(0);
		expect(calls(tess)).toContain("GET case c_flow");
		expect(book(tess, "c_flow")?.shadow?.assignee).toBeNull();
		expect((await caseHere(tess)).createdBy).toEqual(TESS);
	});

	test("a case synced before this version is read again once, and is nobody's until then", async () => {
		await shared();
		// As a build before DEC-071 left it: no reporter, no assignee, a
		// shadow that never heard of one.
		const {
			createdBy: _c,
			assignee: _a,
			assignedBy: _b,
			...old
		} = await caseHere(tess);
		await tess.store.updateCase("c_flow", () => ({ value: old }));
		const kept = book(tess, "c_flow") as CaseBook;
		const { assignee: _s, ...shadow } = kept.shadow as NonNullable<
			CaseBook["shadow"]
		>;
		await tess.kv.set({ "case:c_flow": { ...kept, shadow } });
		const team = {
			kind: "team" as const,
			team: "Pedal & Pine web",
			link: "https://sitegloss.test/t/pedal/cases/c_flow",
			mcp: "https://sitegloss.test/api/mcp",
			ai: "https://sitegloss.test/t/pedal/ai",
		};
		const before = await caseHere(tess);
		expect(mineFor(before, TESS.id, true)).toBe(false);
		expect(
			nextStep(before, team, { adding: false, mayClose: true, me: TESS.id })
				?.text,
		).toBe("Send the case to whoever fixes the open marks.");
		// The worker starts again: one run reads the case again.
		tess.engine = device("tess", server.api(TESS), false, {
			store: tess.store,
			kv: tess.kv,
		}).engine;
		await tess.engine.request();
		expect(book(tess, "c_flow")?.shadow?.assignee).toBeNull();
		const after = await caseHere(tess);
		expect(after.createdBy).toEqual(TESS);
		expect(after.assignee).toBeNull();
		expect(mineFor(after, TESS.id, true)).toBe(true);
		expect(
			nextStep(after, team, {
				adding: false,
				mayClose: true,
				me: TESS.id,
				mayAssign: true,
			})?.text,
		).toBe("2 marks are open: assign the case to whoever fixes them.");
	});

	test("a case shared with another team leaves the first team's hand-over behind", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		// Kept here as another team's (a switch of team before it synced).
		const kept = book(tess, "c_flow") as CaseBook;
		await tess.kv.set({
			"case:c_flow": { ...kept, mode: "local", teamId: "team_other" },
		});
		recording(tess);
		await tess.engine.share("c_flow");
		// What the new team's server says of it comes from there (the fake
		// has one team, so the same case's records come back).
		expect((await caseHere(tess)).assign).toBeUndefined();
		await sync(tess);
		expect(sent(tess, "case.patch").some((o) => "assignee" in o)).toBe(false);
	});

	test("an export carries the server's records, never what waits to be sent", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withAssigned(c, { id: DANA.id, name: DANA.name }, now),
		);
		await sync(tess, dana);
		await change(tess, "c_flow", (c, now) => withAssigned(c, null, now));
		const file = await readExport(
			await exportCase(tess.store, await caseHere(tess)),
		);
		expect(file.case.assignee).toEqual(DANA);
		expect(file.case.createdBy).toEqual(TESS);
		expect(file.case.assign).toBeUndefined();
	});
});

describe("the AI app's name (via)", () => {
	test("what an AI app did through this browser names the app; what the person did does not", async () => {
		await shared();
		recording(tess);
		// By an app: its comment, its close, its summary.
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(
				c,
				{ id: newId("k"), text: "Fixed in PR 12.", app: CLAUDE },
				now,
			),
		);
		await change(tess, "c_flow", (c, now) => ({
			...withVerdict(c, "Shorter labels", now),
			via: { app: CLAUDE, at: now },
		}));
		await tess.engine.request();
		const comment = sent(tess, "comment.create")[0];
		expect(comment && "via" in comment ? comment.via : undefined).toEqual(
			CLAUDE,
		);
		const patch = sent(tess, "case.patch")[0];
		expect(patch && "via" in patch ? patch.via : undefined).toEqual(CLAUDE);
		expect(server.commentsOf("c_flow")[0]?.app?.name).toBe("Claude");
		expect(server.caseOf("c_flow")?.summaryBy?.app?.name).toBe("Claude");
		await dana.engine.request();
		const there = await caseHere(dana);
		expect(there.comments?.[0]?.app?.name).toBe("Claude");
		expect(there.summaryBy?.user?.name).toBe("Tess Tester");
		expect(there.summaryBy?.app?.name).toBe("Claude");
		// By hand after it: no app.
		await change(tess, "c_flow", (c, now) =>
			withVerdict(c, "Shorter labels, by hand", now),
		);
		await tess.engine.request();
		const second = sent(tess, "case.patch")[1];
		expect(second && "via" in second).toBe(false);
	});

	test("a mark made through an AI app is the app's at the server, beside the person", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) => ({
			...c,
			marks: c.marks.map((a) => (a.id === "m2" ? a : a)),
			updatedAt: now,
		}));
		const made = await addMark(tess, "c_flow", "Made by Claude");
		await change(tess, "c_flow", (c, now) => ({
			...c,
			marks: c.marks.map((a) =>
				a.id === made.id
					? { ...a, author: "ai" as const, createdVia: CLAUDE }
					: a,
			),
			updatedAt: now,
		}));
		await sync(tess, dana);
		const wire = server
			.marksOf("c_flow")
			.find((m) => m.comment === "Made by Claude");
		expect(wire?.createdVia?.name).toBe("Claude");
		expect(wire?.author).toBe("ai");
		const there = (await caseHere(dana)).marks.find(
			(a) => a.comment === "Made by Claude",
		);
		expect(there?.createdVia?.name).toBe("Claude");
		expect(there?.createdBy?.name).toBe("Tess Tester");
	});

	test("a comment from a file goes as the importer's, never as the app the file names; an app may not take it over", async () => {
		await shared();
		recording(tess);
		await change(tess, "c_flow", (c, now) => ({
			...c,
			comments: [
				{
					id: "k_file",
					text: "From the file",
					at: now,
					app: CLAUDE,
					imported: true,
				},
			],
			updatedAt: now,
		}));
		await tess.engine.request();
		const create = sent(tess, "comment.create")[0];
		expect(create && "via" in create).toBe(false);
		expect(server.commentsOf("c_flow")[0]?.user?.name).toBe("Tess Tester");
		expect(server.commentsOf("c_flow")[0]?.app).toBeUndefined();
		expect(
			isOwnComment(
				{ id: "k", text: "x", at: "t", app: CLAUDE, imported: true },
				undefined,
				CLAUDE.id,
			),
		).toBe(false);
	});
});

describe("who did it, per thing (DEC-046)", () => {
	test("a hand delete of one's own comment and an app's change to the case, in one push: the delete names no app and is taken", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_hand", text: "By hand" }, now),
		);
		await tess.engine.request();
		expect(server.commentsOf("c_flow")).toHaveLength(1);
		recording(tess);
		// By hand: the comment goes. Then the app changes the summary, last.
		await change(tess, "c_flow", (c, now) =>
			withoutCaseComment(c, "k_hand", now),
		);
		await change(tess, "c_flow", (c, now) => ({
			...withVerdict(c, "Shorter labels", now),
			via: { app: CLAUDE, at: now },
		}));
		await tess.engine.request();
		const del = sent(tess, "comment.delete")[0];
		expect(del && "via" in del).toBe(false);
		const patch = sent(tess, "case.patch")[0];
		expect(patch && "via" in patch ? patch.via : undefined).toEqual(CLAUDE);
		expect(server.commentsOf("c_flow")).toEqual([]);
		expect(status(tess)?.problems).toEqual([]);
	});

	test("a comment the app deleted goes with the app's name, whatever came after", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_app", text: "By Claude", app: CLAUDE }, now),
		);
		await tess.engine.request();
		recording(tess);
		await change(tess, "c_flow", (c, now) =>
			withoutCaseComment(c, "k_app", now, CLAUDE),
		);
		// A hand change after it.
		await change(tess, "c_flow", (c, now) => withVerdict(c, "By hand", now));
		await tess.engine.request();
		const del = sent(tess, "comment.delete")[0];
		expect(del && "via" in del ? del.via : undefined).toEqual(CLAUDE);
		expect(server.commentsOf("c_flow")).toEqual([]);
		// Once the server has it, the note goes.
		await tess.engine.request();
		expect((await caseHere(tess)).deletedVia).toBeUndefined();
	});

	test("a hand edit of a mark's comment, before or after an app's change to the case: the person's, and stays so", async () => {
		await shared();
		recording(tess);
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Edited by hand", now),
		);
		await change(tess, "c_flow", (c, now) => ({
			...withVerdict(c, "From Claude", now),
			via: { app: CLAUDE, at: now },
		}));
		await tess.engine.request();
		const patch = sent(tess, "mark.patch")[0];
		expect(patch && "via" in patch).toBe(false);
		const wire = server.marksOf("c_flow")[0];
		expect(wire?.author).toBe("user");
		expect(wire?.commentBy?.app).toBeUndefined();
		await tess.engine.request();
		const a = (await caseHere(tess)).marks[0];
		expect(a?.comment).toBe("Edited by hand");
		expect(a?.author).toBe("user");
	});

	test("a case shared by hand after an app touched it: its making names no app; one an app's call made does", async () => {
		await signIn(tess);
		await startCase(tess, "c_local");
		await addMark(tess, "c_local", "First");
		recording(tess);
		// The app changes the summary last, before the case first goes.
		await change(tess, "c_local", (c, now) => ({
			...withVerdict(c, "From Claude", now),
			via: { app: CLAUDE, at: now },
		}));
		await tess.engine.request();
		const made = sent(tess, "case.create")[0];
		expect(made && "via" in made).toBe(false);
		// A case an app's call made.
		await startCase(tess, "c_app");
		await addMark(tess, "c_app", "First");
		await change(tess, "c_app", (c) => ({ ...c, createdVia: CLAUDE }));
		await tess.engine.request();
		const byApp = sent(tess, "case.create").find(
			(o) => o.type === "case.create" && o.case.id === "c_app",
		);
		expect(byApp && "via" in byApp ? byApp.via : undefined).toEqual(CLAUDE);
	});

	test("an app's change still waiting keeps its name when the sync changes the case first", async () => {
		await shared();
		// The app's change waits (a push comes first in a run; a merge before
		// it happens when the push could not go, or the change came while
		// the run was reading).
		const waiting = await change(tess, "c_flow", (c, now) => ({
			...withVerdict(c, "From Claude", now),
			via: { app: CLAUDE, at: now },
		}));
		await change(dana, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_dana", text: "From Dana" }, now),
		);
		await dana.engine.request();
		const merged = mergeCase(
			waiting,
			book(tess, "c_flow"),
			{
				shots: [],
				marks: [],
				removedMarks: [],
				removedShots: [],
				comments: server.commentsOf("c_flow"),
			},
			new Map(),
			new Map(),
			{
				teamId: "team_1",
				whole: false,
				now: "2030-01-01T00:00:00.000Z",
				me: TESS.id,
			},
		);
		const c = merged?.value as Case;
		expect(c.comments?.map((k) => k.id)).toEqual(["k_dana"]);
		expect(c.updatedAt).not.toBe(waiting.updatedAt);
		expect(viaOf(c).via).toEqual(CLAUDE);
		// A merge that changes the case's own content ends it: that is no
		// longer what the app left.
		const renamed = mergeCase(
			waiting,
			book(tess, "c_flow"),
			{
				case: {
					...(server.caseOf("c_flow") as NonNullable<
						ReturnType<FakeServer["caseOf"]>
					>),
					title: "Renamed by Dana",
				},
				shots: [],
				marks: [],
				removedMarks: [],
				removedShots: [],
			},
			new Map(),
			new Map(),
			{
				teamId: "team_1",
				whole: false,
				now: "2030-01-01T00:00:00.000Z",
				me: TESS.id,
			},
		);
		expect(viaOf(renamed?.value as Case).via).toBeUndefined();
	});
});

describe("the thread kept right (DEC-046)", () => {
	test("a server restored without a case's comments gets them again", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_1", text: "Before the restore" }, now),
		);
		await tess.engine.request();
		expect(server.commentsOf("c_flow")).toHaveLength(1);
		// The backup had the case, not its comment.
		for (const [id, k] of server.comments)
			if (k.value.caseId === "c_flow") server.comments.delete(id);
		server.restore();
		await tess.engine.request();
		await tess.engine.request();
		expect(server.commentsOf("c_flow").map((k) => k.id)).toEqual(["k_1"]);
	});

	test("another's comment changed here is not sent, takes the server's text back, and does not hold the case", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_dana", text: "Dana's words" }, now),
		);
		await sync(dana, tess);
		recording(tess);
		await change(tess, "c_flow", (c, now) => ({
			...c,
			comments: (c.comments ?? []).map((k) => ({ ...k, text: "Changed here" })),
			updatedAt: now,
		}));
		await tess.engine.request();
		expect(sent(tess, "comment.patch")).toEqual([]);
		expect(server.commentsOf("c_flow")[0]?.text).toBe("Dana's words");
		// At the next merge the server's text is back.
		await change(dana, "c_flow", (c, now) => withVerdict(c, "Anything", now));
		await dana.engine.request();
		await tess.engine.request();
		expect((await caseHere(tess)).comments?.[0]?.text).toBe("Dana's words");
		expect(status(tess)?.problems).toEqual([]);
	});

	test("comments past the most a case holds are parked, said, and go once there is room", async () => {
		await shared();
		// Dana fills the thread to one short of the limit.
		await change(dana, "c_flow", (c, now) => {
			let next = c;
			for (let i = 0; i < 999; i++)
				next = withCaseComment(next, { id: `k_d${i}`, text: `Dana ${i}` }, now);
			return next;
		});
		// Tess, offline, writes two.
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(
				withCaseComment(c, { id: "k_t1", text: "Tess one" }, now),
				{ id: "k_t2", text: "Tess two" },
				now,
			),
		);
		await tess.engine.request();
		await dana.engine.request();
		expect(server.commentsOf("c_flow")).toHaveLength(999);
		tess.api.offline = false;
		await tess.engine.request();
		await tess.engine.request();
		const here = await caseHere(tess);
		expect(here.comments).toHaveLength(1000);
		expect(server.commentsOf("c_flow")).toHaveLength(1000);
		expect(book(tess, "c_flow")?.parkedComments?.map((k) => k.id)).toEqual([
			"k_t2",
		]);
		expect(
			status(tess)
				?.problems.map((p) => p.text)
				.join(" "),
		).toContain("kept back and not sent");
		// Dana deletes one: the parked one comes back and goes.
		await change(dana, "c_flow", (c, now) =>
			withoutCaseComment(c, "k_d0", now),
		);
		await dana.engine.request();
		await tess.engine.request();
		await tess.engine.request();
		expect(server.commentsOf("c_flow").map((k) => k.id)).toContain("k_t2");
		expect(book(tess, "c_flow")?.parkedComments).toBeUndefined();
	}, 60_000);

	test("a synced comment whose writer is gone is nobody's own; one not synced yet is one's own", () => {
		const gone = commentIn(
			{
				id: "k_1",
				caseId: "c_1",
				markId: null,
				text: "Old",
				at: "2026-11-20T10:00:00.000Z",
				user: null,
				rev: 1,
			} as never,
			new Map(),
		);
		expect(gone.writerGone).toBe(true);
		expect(isOwnComment(gone, "u_tess")).toBe(false);
		expect(isOwnComment({ id: "k_2", text: "Mine", at: "x" }, "u_tess")).toBe(
			true,
		);
	});
});

describe("a file put in place of a synced case (DEC-046)", () => {
	test("an older file without the thread deletes none of it, and an older text does not replace a newer one", async () => {
		await shared();
		const before = await caseHere(tess);
		// The file: the case before anybody commented.
		const zip = await exportCase(tess.store, before);
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_tess", text: "Tess, after the file" }, now),
		);
		await change(dana, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_dana", text: "Dana, after the file" }, now),
		);
		await sync(tess, dana);
		recording(tess);
		await storeImport(tess.store, await readExport(zip));
		await tess.engine.request();
		expect(sent(tess, "comment.delete", "comment.patch")).toEqual([]);
		expect(server.commentsOf("c_flow").map((k) => k.text)).toEqual([
			"Tess, after the file",
			"Dana, after the file",
		]);
		expect((await caseHere(tess)).comments?.map((k) => k.id)).toEqual([
			"k_tess",
			"k_dana",
		]);
	});
});

describe("an arrow's ends (DEC-047; the server's DEC-020)", () => {
	const element = (tag: string, testId: string) => ({
		tag,
		testId,
		classes: [],
		attributes: {},
		ancestors: [],
		rect: { x: 1, y: 2, width: 30, height: 20 },
		page: { width: 1280, height: 800 },
		selector: `[data-testid=${testId}]`,
	});

	test("go with the new mark, come to the other device, and are never patched", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_ends");
		const a = await addMark(tess, "c_ends", "From the badge to the price");
		await change(tess, "c_ends", (c, now) => ({
			...c,
			marks: c.marks.map((x) =>
				x.id === a.id
					? {
							...x,
							shape: {
								kind: "arrow",
								from: { x: 5, y: 5 },
								to: { x: 50, y: 40 },
							},
							ends: { start: element("span", "badge"), end: null },
						}
					: x,
			),
			updatedAt: now,
		}));
		recording(tess);
		await tess.engine.request();
		const made = sent(tess, "mark.create")[0];
		expect(
			made?.type === "mark.create" ? made.mark.ends?.start?.testId : undefined,
		).toBe("badge");
		expect(server.marksOf("c_ends")[0]?.ends?.end).toBeNull();
		await dana.engine.request();
		const there = (await caseHere(dana, "c_ends")).marks[0];
		expect(there?.ends?.start?.testId).toBe("badge");
		expect(there?.ends?.end).toBeNull();
		// A change to the mark: a patch without its ends.
		await change(tess, "c_ends", (c, now) =>
			withComment(c, a.id, "Changed", now),
		);
		await tess.engine.request();
		const patch = sent(tess, "mark.patch")[0];
		expect(patch && "ends" in patch).toBe(false);
		expect(status(tess)?.problems).toEqual([]);
		// Nothing waits on either side.
		await sync(tess, dana);
		expect(sent(tess, "mark.patch")).toHaveLength(1);
	});
});
