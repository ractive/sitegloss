/**
 * Findings of a team's case become comments once (DEC-081), against the
 * fake server, which holds findings as the service did and turns them into
 * comments as the service's script does (`findingsToComments`). A device
 * left by 0.4.0: the case here, its book's shadow and the server each hold
 * findings; then this build's upgrade (`upgradedCase`, `findingsIntoThreads`)
 * and a sync.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { type Case, findingCommentId } from "../src/lib/case.ts";
import type { CaseBook } from "../src/lib/cloud/book.ts";
import { findingsIntoThreads } from "../src/lib/cloud/findings.ts";
import { storeImport } from "../src/lib/export.ts";
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
const DANA = { id: "u_dana", name: "Dana Developer" };
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
 * 1, the case here has `here`; then this build's upgrade.
 */
async function leftBy040(
	had: ReturnType<typeof finding>[],
	here: ReturnType<typeof finding>[],
): Promise<void> {
	server.heldFindings.set(there(), had);
	const b = structuredClone(book());
	const shadowMark = b.shadow?.marks[there()];
	if (shadowMark) (shadowMark.content as { findings?: unknown }).findings = had;
	tess.kv.data.set("case:c_f", b);
	const c = tess.store.cases.get("c_f") as Case;
	tess.store.cases.set("c_f", {
		...c,
		marks: c.marks.map((a) => ({ ...a, findings: here })),
	});
	// This build: the store's upgrade, then the sync's.
	tess.store.cases.set(
		"c_f",
		upgradedCase(tess.store.cases.get("c_f")) as Case,
	);
	await findingsIntoThreads(tess.store, tess.kv, true);
}

const atServer = () => server.commentsOf("c_f").map((k) => [k.id, k.text]);
const here = async () =>
	((await tess.store.getCase("c_f"))?.comments ?? []).map((k) => [
		k.id,
		k.text,
	]);

describe("findings of a team's case become one comment each (DEC-081)", () => {
	test("one the server had: neither doubled nor lost, before and after the server's script", async () => {
		await leftBy040(
			[finding("f_1", "Cart_total sets overflow")],
			[finding("f_1", "Cart_total sets overflow")],
		);
		const id = findingCommentId(there(), "f_1");
		await sync(tess);
		expect(atServer()).toEqual([]);
		expect(await here()).toEqual([[id, "Cart_total sets overflow"]]);
		server.findingsToComments();
		await sync(tess);
		expect(atServer()).toEqual([[id, "Cart_total sets overflow"]]);
		expect(await here()).toEqual([[id, "Cart_total sets overflow"]]);
	});

	test("edited here and not pushed: the edit arrives as an edit of the server's comment", async () => {
		await leftBy040(
			[finding("f_1", "Old words")],
			[finding("f_1", "New words")],
		);
		server.findingsToComments();
		await sync(tess);
		const id = findingCommentId(there(), "f_1");
		expect(atServer()).toEqual([[id, "New words"]]);
		expect(await here()).toEqual([[id, "New words"]]);
	});

	test("deleted here and not pushed: the delete arrives", async () => {
		await leftBy040([finding("f_1", "Gone here")], []);
		server.findingsToComments();
		await sync(tess);
		expect(atServer()).toEqual([]);
		expect(await here()).toEqual([]);
	});

	test("never pushed: it arrives once, also after the server's script", async () => {
		await leftBy040([], [finding("f_2", "Only here")]);
		await sync(tess);
		server.findingsToComments();
		await sync(tess);
		expect(atServer().map(([, text]) => text)).toEqual(["Only here"]);
		expect((await here()).map(([, text]) => text)).toEqual(["Only here"]);
	});
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
	const fromFile = {
		...c,
		id: "c_file",
		marks: c.marks.map((a) => ({
			...a,
			findings: [{ ...finding("f_9", "WORDS FROM A FILE"), user: DANA }],
		})),
	};
	const { validateCase } = await import("../src/lib/case.ts");
	await storeImport(tess.store, {
		case: validateCase(fromFile),
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
