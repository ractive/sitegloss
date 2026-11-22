/**
 * Sitegloss 0.3.0 beside this build (DEC-046): a 0.3.0 browser on the same
 * team keeps syncing while this build comments and closes; a file this build
 * writes (`sitegloss/2`) is one 0.3.0 refuses (DEC-051); and a 0.3.0
 * browser updated to this build, its cases emptied by the store's upgrade,
 * reads the team's cases again and sends nothing. 0.3.0's sync is the copy in `compat/v0.3.0` (never edited); the
 * server is the one in memory, with what the server added (closing,
 * comments, the app's name).
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	type Case,
	validateCase,
	withCaseComment,
	withClosed,
	withoutCaseComment,
} from "../src/lib/case.ts";
import { forgetCases } from "../src/lib/cloud/book.ts";
import { CloudSync } from "../src/lib/cloud/engine.ts";
import { exportCase, readExport, storeImport } from "../src/lib/export.ts";
import { MemoryStore } from "../src/lib/store.ts";
import { readZip } from "../src/lib/zip.ts";
import type { FakeApi } from "./cloud-fake.ts";
import { FakeServer } from "./cloud-fake.ts";
import {
	addMark,
	change,
	type Device,
	device,
	SERVER,
	signIn,
	startCase,
	webp,
} from "./cloud-helpers.ts";
import {
	type Case as Case030,
	validateCase as validateCase030,
	withComment as withComment030,
} from "./compat/v0.3.0/src/lib/case.ts";
import { CloudSync as CloudSync030 } from "./compat/v0.3.0/src/lib/cloud/engine.ts";
import { memoryKv as memoryKv030 } from "./compat/v0.3.0/src/lib/kv.ts";
import { MemoryStore as MemoryStore030 } from "./compat/v0.3.0/src/lib/store.ts";

const TESS = { id: "u_tess", name: "Tess Tester" };
const DANA = { id: "u_dana", name: "Dana Developer" };
const CLAUDE = {
	id: "https://claude.ai/oauth",
	name: "Claude",
	host: "claude.ai",
};

/** A browser with 0.3.0's sync. */
function device030(api: FakeApi) {
	const store = new MemoryStore030();
	const kv = memoryKv030();
	const statuses: { state: string; problems: unknown[] }[] = [];
	const clock = { now: new Date("2026-11-19T10:00:00.000Z") };
	let ids = 0;
	const engine = new CloudSync030({
		store,
		kv,
		// The server in memory speaks the contract 0.3.0 was built for, and more.
		api: () => api as never,
		now: () => {
			clock.now = new Date(clock.now.getTime() + 1000);
			return clock.now;
		},
		newId: (prefix: string) => `${prefix}_old_${++ids}`,
		onStatus: (status) => statuses.push(status),
	});
	return { store, kv, api, engine, statuses, clock };
}

let server: FakeServer;
let tess: Device<FakeApi>;
let dana: ReturnType<typeof device030>;

beforeEach(async () => {
	server = new FakeServer();
	tess = device("tess", server.api(TESS));
	dana = device030(server.api(DANA));
	await signIn(tess);
	await dana.engine.signedIn(SERVER, await dana.api.me());
});

const sync = async () => {
	for (let i = 0; i < 3; i++) {
		await tess.engine.request();
		await dana.engine.request();
	}
};
const lastStatus = () => dana.statuses.at(-1);

describe("a 0.3.0 browser on the same team", () => {
	test("keeps syncing marks while this build comments, closes and names its AI app; what it adds opens the case again", async () => {
		await startCase(tess, "c_flow");
		await addMark(tess, "c_flow", "Total is cut off");
		await addMark(tess, "c_flow", "Pay button too pale");
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(c, { id: "k_case", text: "Both pages checked." }, now),
		);
		await change(tess, "c_flow", (c, now) =>
			withCaseComment(
				c,
				{ id: "k_mark", text: "Fixed in PR 12.", mark: "m1", app: CLAUDE },
				now,
			),
		);
		await change(tess, "c_flow", (c, now) => withClosed(c, true, now));
		await sync();
		expect(server.commentsOf("c_flow")).toHaveLength(2);
		expect(server.caseOf("c_flow")?.closed?.user?.name).toBe("Tess Tester");
		// 0.3.0 has the case and its marks, and nothing it does not know.
		const old = (await dana.store.getCase("c_flow")) as Case030;
		expect(old.annotations.map((a) => a.comment)).toEqual([
			"Total is cut off",
			"Pay button too pale",
		]);
		expect("comments" in old || "closed" in old).toBe(false);
		expect(lastStatus()?.state).toBe("synced");
		expect(lastStatus()?.problems).toEqual([]);

		// 0.3.0 changes a mark: it arrives, and the thread and the close stay.
		await dana.store.updateCase("c_flow", (c) => ({
			value: withComment030(
				c as Case030,
				"a1",
				"Total is cut off on small screens",
				new Date(dana.clock.now.getTime() + 60_000).toISOString(),
			),
		}));
		await sync();
		const here = (await tess.store.getCase("c_flow")) as Case;
		expect(here.marks[0]?.comment).toBe("Total is cut off on small screens");
		expect(here.comments?.map((k) => k.id)).toEqual(["k_case", "k_mark"]);
		expect(here.closed).toBeDefined();
		expect(server.commentsOf("c_flow")).toHaveLength(2);

		// A comment deleted here: the server lists it with no case, and 0.3.0
		// passes it by.
		await change(tess, "c_flow", (c, now) =>
			withoutCaseComment(c, "k_case", now),
		);
		await sync();
		expect(server.commentsOf("c_flow").map((k) => k.id)).toEqual(["k_mark"]);
		expect(lastStatus()?.state).toBe("synced");
		expect(lastStatus()?.problems).toEqual([]);

		// 0.3.0 adds an open mark (it knows nothing of closing): the server
		// opens the case again, and this build follows.
		await dana.store.putImage("c_flow", "crops/a3.webp", {
			blob: webp("crop by dana", 280, 160),
			width: 280,
			height: 160,
		});
		await dana.store.updateCase("c_flow", (c) => {
			const value = c as Case030;
			const first = value.annotations[0] as Case030["annotations"][number];
			return {
				value: {
					...value,
					annotations: [
						...value.annotations,
						{
							...first,
							id: "a3",
							number: 3,
							comment: "From 0.3.0",
							crop: "crops/a3.webp",
							shape: { kind: "note", at: { x: 5, y: 5 } },
							element: null,
						},
					],
					updatedAt: new Date(dana.clock.now.getTime() + 120_000).toISOString(),
				},
			};
		});
		await sync();
		expect(server.marksOf("c_flow").map((m) => m.comment)).toContain(
			"From 0.3.0",
		);
		expect(server.caseOf("c_flow")?.closed).toBeNull();
		expect(
			((await tess.store.getCase("c_flow")) as Case).closed,
		).toBeUndefined();
	});
});

describe("0.3.0's data after this build's upgrade (DEC-051): the cases emptied, the team's read again", () => {
	test("nothing is sent, not even a delete on record; the team's cases come back whole with m ids; a case only 0.3.0 had is gone", async () => {
		await startCase(tess, "c_up");
		await addMark(tess, "c_up", "Total is cut off");
		await addMark(tess, "c_up", "Pay button too pale");
		await change(tess, "c_up", (c, now) =>
			withCaseComment(c, { id: "k_up", text: "Before the upgrade" }, now),
		);
		await startCase(tess, "c_del");
		await addMark(tess, "c_del", "Logo blurred");
		await sync();
		expect((await dana.store.getCase("c_del")) !== undefined).toBe(true);
		// 0.3.0 deletes a team's case, and its sync never runs again: the
		// delete is on record in its store, not sent.
		await dana.store.deleteCase("c_del");
		expect((await dana.store.deletedCases()).map((d) => d.id)).toEqual([
			"c_del",
		]);
		// And a case 0.3.0 made that never went to the team (no book).
		const kept = (await dana.store.getCase("c_up")) as Case030;
		dana.store.cases.set("c_only", {
			...kept,
			id: "c_only",
			title: "Only here",
		});

		// The update: the store's version 2 starts empty, the cloud's
		// database forgets what it kept about cases (books, cursor, queue).
		const store = new MemoryStore();
		await forgetCases(dana.kv as never);
		const left = [...dana.kv.data.keys()];
		expect(left.some((k) => /(^|\s)(case:|cursor$|queue$)/.test(k))).toBe(
			false,
		);
		expect(left).toContain("account");
		const sent: string[] = [];
		const ops = dana.api.ops.bind(dana.api);
		dana.api.ops = async (team, list) => {
			sent.push(...list.map((o) => o.type));
			return ops(team, list);
		};
		const statuses: { state: string; problems: unknown[] }[] = [];
		const engine = new CloudSync({
			store,
			kv: dana.kv as never,
			api: () => dana.api as never,
			onStatus: (s) => statuses.push(s),
		});
		// Signed in still, with the same account and team.
		expect((await engine.account())?.server).toBe(SERVER);
		for (let i = 0; i < 3; i++) await engine.request();
		expect(statuses.at(-1)?.state).toBe("synced");
		expect(statuses.at(-1)?.problems).toEqual([]);
		// It only read: no operation at all, so no case.delete either.
		expect(sent).toEqual([]);
		expect(server.caseOf("c_del")).toBeDefined();
		expect(server.marksOf("c_up").map((m) => m.comment)).toEqual([
			"Total is cut off",
			"Pay button too pale",
		]);
		// The team's cases are here again, whole, with this build's ids.
		const here = (await store.getCase("c_up")) as Case;
		expect(here.format).toBe("sitegloss/2");
		expect(here.marks.map((a) => [a.id, a.crop, a.comment])).toEqual([
			["m1", "crops/m1.webp", "Total is cut off"],
			["m2", "crops/m2.webp", "Pay button too pale"],
		]);
		expect(here.comments?.map((k) => k.text)).toEqual(["Before the upgrade"]);
		expect(validateCase(JSON.parse(JSON.stringify(here))).marks).toHaveLength(
			2,
		);
		expect((await store.getCase("c_del"))?.marks.map((a) => a.id)).toEqual([
			"m1",
		]);
		// The case that never went to the team is gone (the owner's decision).
		expect(await store.getCase("c_only")).toBeUndefined();
		expect(await store.deletedCases()).toEqual([]);
	});
});

describe("a mark's look (DEC-048) beside 0.3.0", () => {
	test("goes out once with mark.create; 0.3.0 takes the mark without it, and neither sends anything more", async () => {
		const sent: { type: string; element?: unknown }[] = [];
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async (team, list) => {
			sent.push(
				...list.map((o) => ({
					type: o.type,
					...(o.type === "mark.create" ? { element: o.mark.element } : {}),
				})),
			);
			return ops(team, list);
		};
		const danaSent: string[] = [];
		const danaOps = dana.api.ops.bind(dana.api);
		dana.api.ops = async (team, list) => {
			danaSent.push(...list.map((o) => o.type));
			return danaOps(team, list);
		};
		await startCase(tess, "c_look");
		await addMark(tess, "c_look", "Book is hard to read", { element: true });
		const look = {
			styles: {
				color: "rgb(245, 207, 88)",
				"background-color": "rgb(242, 194, 48)",
				"font-weight": "700",
			},
			backdrop: { color: "rgb(242, 194, 48)", depth: 0 },
			siblings: [
				{ offset: -1, tag: "p", rect: { x: 1, y: 2, width: 3, height: 4 } },
			],
		};
		// As the toolbar records it with the mark, before the first sync.
		await change(tess, "c_look", (c) => ({
			...c,
			marks: c.marks.map((a) =>
				a.element === null ? a : { ...a, element: { ...a.element, ...look } },
			),
		}));
		await sync();
		await sync();
		const creates = sent.filter((o) => o.type === "mark.create");
		expect(creates).toHaveLength(1);
		expect(creates[0]?.element).toMatchObject(look);
		expect(sent.filter((o) => o.type.startsWith("mark."))).toHaveLength(1);
		// The team has it.
		expect(server.marksOf("c_look")[0]?.element).toMatchObject(look);
		// 0.3.0 has the mark, without what it does not know, and sent nothing.
		const old = (await dana.store.getCase("c_look")) as Case030;
		const element = old.annotations[0]?.element as unknown as Record<
			string,
			unknown
		>;
		expect(element["selector"]).toBe("form > button");
		expect("styles" in element || "backdrop" in element).toBe(false);
		expect(danaSent).toEqual([]);
		expect(lastStatus()?.state).toBe("synced");
		// This build, read back from the server: the same mark, nothing to send.
		const here = (await tess.store.getCase("c_look")) as Case;
		expect(here.marks[0]?.element).toMatchObject(look);
	});
});

describe("a file this build writes", () => {
	test("0.3.0 refuses it (sitegloss/2, DEC-051); this build reads it back whole, without this browser's notes", async () => {
		await startCase(tess, "c_file");
		await addMark(tess, "c_file", "Total is cut off");
		// The thread, a close and a mark made through Claude, as the tools
		// and the panel make them.
		const c = await change(tess, "c_file", (k, now) => ({
			...withClosed(
				withCaseComment(
					withCaseComment(k, { id: "k_1", text: "On the case" }, now),
					{ id: "k_2", text: "On mark 1", mark: "m1", app: CLAUDE },
					now,
				),
				true,
				now,
				CLAUDE,
			),
			marks: k.marks.map((a) => ({ ...a, createdVia: CLAUDE })),
			createdVia: CLAUDE,
		}));
		expect(c.via?.app.name).toBe("Claude");
		const zip = await exportCase(tess.store, c);
		const json = JSON.parse(
			new TextDecoder().decode(
				(await readZip(zip)).get("case.json") as Uint8Array,
			),
		);
		// This browser's notes for its sync are not in the file.
		expect("via" in json || "createdVia" in json).toBe(false);
		expect("createdVia" in (json.marks[0] ?? {})).toBe(true);
		// 0.3.0 reads sitegloss/1 only.
		expect(() => validateCase030(json)).toThrow(
			'case.format: is "sitegloss/2"; Sitegloss reads "sitegloss/1" only',
		);
		// This build, imported as a user imports it: the thread and the close;
		// who wrote a comment is what the file says; a mark's app, the server's
		// to say, is left out.
		const into = new MemoryStore();
		const back = await storeImport(into, await readExport(zip));
		expect(
			back.comments?.map((k) => [
				k.id,
				k.mark ?? null,
				k.app?.name ?? null,
				k.imported ?? false,
			]),
		).toEqual([
			["k_1", null, null, true],
			["k_2", "m1", "Claude", true],
		]);
		expect(back.closed?.app?.name).toBe("Claude");
		expect(back.marks[0]?.createdVia).toBeUndefined();
		expect(back.via).toBeUndefined();
		expect(back.createdVia).toBeUndefined();
	});
	test("an element's look (DEC-048): this build reads the file back with it", async () => {
		await startCase(tess, "c_file_look");
		await addMark(tess, "c_file_look", "Book is hard to read", {
			element: true,
		});
		const look = {
			styles: { color: "rgb(245, 207, 88)", "font-size": "16px" },
			backdrop: { color: "rgb(242, 194, 48)", depth: 0, image: true },
			siblings: [
				{ offset: 1, tag: "a", rect: { x: 1, y: 2, width: 3, height: 4 } },
			],
		};
		const c = await change(tess, "c_file_look", (k) => ({
			...k,
			marks: k.marks.map((a) =>
				a.element === null ? a : { ...a, element: { ...a.element, ...look } },
			),
		}));
		const zip = await exportCase(tess.store, c);
		const json = JSON.parse(
			new TextDecoder().decode(
				(await readZip(zip)).get("case.json") as Uint8Array,
			),
		);
		expect(json.marks[0]?.element).toMatchObject(look);
		const back = await storeImport(new MemoryStore(), await readExport(zip));
		expect(back.marks[0]?.element).toMatchObject(look);
	});
});

describe("a screenshot's query (DEC-050) beside 0.3.0", () => {
	test("goes out once with shot.create, filtered; this build's other browsers keep it, 0.3.0 takes the screenshot without it and sends nothing", async () => {
		const sent: { type: string; query?: string }[] = [];
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async (team, list) => {
			sent.push(
				...list.map((o) => ({
					type: o.type,
					...(o.type === "shot.create" && o.shot.query !== undefined
						? { query: o.shot.query }
						: {}),
				})),
			);
			return ops(team, list);
		};
		const danaSent: string[] = [];
		const danaOps = dana.api.ops.bind(dana.api);
		dana.api.ops = async (team, list) => {
			danaSent.push(...list.map((o) => o.type));
			return danaOps(team, list);
		};
		await startCase(tess, "c_query");
		await addMark(tess, "c_query", "Sorted wrong", {
			url: "https://shop.example/search?q=shoes&sort=price&token=abc",
		});
		await sync();
		await sync();
		expect(sent.filter((o) => o.type === "shot.create")).toEqual([
			{ type: "shot.create", query: "q=shoes&sort=price" },
		]);
		// 0.3.0 has the screenshot and its plain address, without the query.
		const old = (await dana.store.getCase("c_query")) as Case030;
		expect(old.shots[0]?.url).toBe("https://shop.example/search");
		expect("query" in (old.shots[0] as object)).toBe(false);
		expect(danaSent).toEqual([]);
		expect(lastStatus()?.state).toBe("synced");
		// Another browser of this build gets it from the team.
		const kim = device("kim", server.api({ id: "u_kim", name: "Kim" }));
		await signIn(kim);
		await kim.engine.request();
		const there = (await kim.store.getCase("c_query")) as Case;
		expect(there.shots[0]?.url).toBe("https://shop.example/search");
		expect(there.shots[0]?.query).toBe("q=shoes&sort=price");
	});
});
