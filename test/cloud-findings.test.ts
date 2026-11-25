/**
 * Findings of a team's case at the update (DEC-081), against the fake
 * server, which holds findings as the service did and turns them into
 * comments as the service's script does (`findingsToComments`). A device
 * left by 0.4.0: the case here, its book's shadow and the server hold
 * findings; then this build's upgrade (`upgradedCase`, then
 * `findingsOutOfBooks`) and syncs.
 */

import { beforeEach, expect, test } from "bun:test";
import { type Case, validateCase } from "../src/lib/case.ts";
import { type CaseBook, KEYS, type Queue } from "../src/lib/cloud/book.ts";
import { findingsOutOfBooks } from "../src/lib/cloud/findings.ts";
import { storeImport } from "../src/lib/export.ts";
import { memoryKv } from "../src/lib/kv.ts";
import { upgradedCase } from "../src/lib/store.ts";
import type { FakeApi } from "./cloud-fake.ts";
import { FakeServer } from "./cloud-fake.ts";
import {
	addMark,
	type Device,
	device,
	signIn,
	startCase,
	sync,
} from "./cloud-helpers.ts";

const TESS = { id: "u_tess", name: "Tess Tester" };
const CLAUDE = {
	id: "https://claude.ai/oauth",
	name: "Claude",
	host: "claude.ai",
};

let server: FakeServer;
let tess: Device<FakeApi>;

beforeEach(async () => {
	server = new FakeServer();
	tess = device("tess", server.api(TESS));
	await signIn(tess);
	await startCase(tess, "c_f");
	await addMark(tess, "c_f", "Total is cut off");
	await sync(tess);
});

type Finding = ReturnType<typeof finding>;
const finding = (id: string, text: string) => ({
	id,
	text,
	app: CLAUDE,
	at: "2026-11-18T10:00:00.000Z",
	user: TESS,
});
const book = () => tess.kv.data.get("case:c_f") as CaseBook;
const there = () => book().marks["m1"] as string;

/**
 * The device as 0.4.0 left it: the server and the shadow had `had` on mark
 * 1, the case here has `here` (changed since, so the next sync looks at it),
 * `queued` waited in the queue; then this build's upgrade, its books in
 * `parts` (the device's own, unless given).
 */
async function leftBy040(
	had: Finding[],
	here: Finding[],
	queued: Finding[] = [],
	parts = [tess.kv],
): Promise<void> {
	server.heldFindings.set(there(), [...had, ...queued]);
	const b = structuredClone(book());
	const mark = b.shadow?.marks[there()];
	if (mark) (mark.content as { findings?: unknown }).findings = had;
	for (const part of parts) {
		await part.set({ "case:c_f": b });
		if (queued.length > 0)
			await part.set({
				[KEYS.queue]: {
					caseId: "c_f",
					teamId: b.teamId,
					ops: [
						{
							opId: "o_queued",
							type: "mark.patch",
							markId: there(),
							findings: { upsert: queued },
						},
					],
				},
			});
	}
	const c = tess.store.cases.get("c_f") as Case;
	tess.store.cases.set("c_f", {
		...c,
		updatedAt: "2026-11-20T09:00:00.000Z",
		marks: c.marks.map((a) => ({ ...a, findings: here })),
	});
	tess.store.cases.set(
		"c_f",
		upgradedCase(tess.store.cases.get("c_f")) as Case,
	);
	expect(await findingsOutOfBooks(tess.store, parts)).toBe(true);
}

const atServer = () => server.commentsOf("c_f").map((k) => k.text);
const here = async () =>
	((await tess.store.getCase("c_f"))?.comments ?? []).map((k) => k.text);
const problems = () => tess.statuses.at(-1)?.problems ?? [];

test("a finding the server has goes from this browser and comes back as the server's comment, once; before its script, nothing is sent and nothing is wrong", async () => {
	await leftBy040(
		[finding("f_1", "Cart_total overflows")],
		[finding("f_1", "Cart_total overflows")],
	);
	expect(await here()).toEqual([]);
	expect((await tess.store.getCase("c_f"))?.marks[0]?.findings).toBeUndefined();
	await sync(tess);
	expect(atServer()).toEqual([]);
	expect(await here()).toEqual([]);
	expect(problems()).toEqual([]);
	server.findingsToComments();
	await sync(tess);
	expect(atServer()).toEqual(["Cart_total overflows"]);
	expect(await here()).toEqual(["Cart_total overflows"]);
});

test("a finding never pushed goes out once as a comment, before and after the server's script", async () => {
	await leftBy040([], [finding("f_2", "Only here")]);
	await sync(tess);
	expect(atServer()).toEqual(["Only here"]);
	server.findingsToComments();
	await sync(tess);
	expect(atServer()).toEqual(["Only here"]);
	expect(await here()).toEqual(["Only here"]);
});

test("a finding that waited in the queue goes out once, as a comment; the queue goes without it", async () => {
	await leftBy040([], [finding("f_3", "Queued")], [finding("f_3", "Queued")]);
	expect((tess.kv.data.get(KEYS.queue) as Queue).ops).toEqual([]);
	server.heldFindings.clear();
	await sync(tess);
	server.findingsToComments();
	await sync(tess);
	expect(atServer()).toEqual(["Queued"]);
	expect(await here()).toEqual(["Queued"]);
});

test("a case two servers have: a finding either has goes from here, and neither book keeps findings", async () => {
	const other = memoryKv();
	await leftBy040(
		[finding("f_1", "Both have it")],
		[finding("f_1", "Both have it")],
		[],
		[tess.kv, other],
	);
	expect(await here()).toEqual([]);
	for (const part of [tess.kv, other])
		expect(
			JSON.stringify((await part.get("case:c_f")) as CaseBook),
		).not.toContain("findings");
	await sync(tess);
	expect(atServer()).toEqual([]);
});

test("a file's finding that names a person survives its case's first sync to a team", async () => {
	const c = (await tess.store.getCase("c_f")) as Case;
	const images = new Map(
		await Promise.all(
			[...c.shots.map((s) => s.image), ...c.marks.map((a) => a.crop)].map(
				async (path) => [path, await tess.store.getImage(c.id, path)] as const,
			),
		),
	);
	await storeImport(tess.store, {
		case: validateCase({
			...c,
			id: "c_file",
			marks: c.marks.map((a) => ({
				...a,
				findings: [
					{
						...finding("f_9", "WORDS FROM A FILE"),
						user: { id: "u_dana", name: "Dana" },
					},
				],
			})),
		}),
		images: images as never,
	});
	await sync(tess);
	expect(server.commentsOf("c_file").map((k) => k.text)).toEqual([
		"WORDS FROM A FILE",
	]);
	expect(
		((await tess.store.getCase("c_file"))?.comments ?? []).map((k) => k.text),
	).toEqual(["WORDS FROM A FILE"]);
});
