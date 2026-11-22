/**
 * Sitegloss 0.3.0 beside this build (DEC-046): a 0.3.0 browser on the same
 * team keeps syncing while this build comments and closes, and 0.3.0 reads a
 * file this build writes. 0.3.0's sync is the copy in `compat/v0.3.0` (never
 * edited); the server is the one in memory, with what the server added
 * (closing, comments, the app's name).
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	type Case,
	type Shape,
	withCaseComment,
	withClosed,
	withFinding,
	withoutCaseComment,
	withReopen,
	withResolution,
} from "../src/lib/case.ts";
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
				{ id: "k_mark", text: "Fixed in PR 12.", mark: "a1", app: CLAUDE },
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

describe("0.3.0's data opened by this build", () => {
	test("its cases, books and account open as they are, keep syncing, and get the thread and closing 0.3.0 passed by", async () => {
		await startCase(tess, "c_up");
		await addMark(tess, "c_up", "Total is cut off");
		await sync();
		// What 0.3.0 reads past and does not keep.
		await change(tess, "c_up", (c, now) =>
			withClosed(
				withCaseComment(c, { id: "k_before", text: "Before the upgrade" }, now),
				true,
				now,
			),
		);
		await sync();
		expect(lastStatus()?.state).toBe("synced");
		// The extension is reloaded with this build: the same database.
		const statuses: { state: string; problems: unknown[] }[] = [];
		const engine = new CloudSync({
			store: dana.store as never,
			kv: dana.kv as never,
			api: () => dana.api as never,
			onStatus: (s) => statuses.push(s),
		});
		expect((await engine.account())?.server).toBe(SERVER);
		await engine.request();
		await engine.request();
		expect(statuses.at(-1)?.state).toBe("synced");
		expect(statuses.at(-1)?.problems).toEqual([]);
		const here = (await dana.store.getCase("c_up")) as unknown as Case;
		expect(here.comments?.map((k) => k.text)).toEqual(["Before the upgrade"]);
		expect(here.closed?.user?.name).toBe("Tess Tester");
		// And on: a comment of Dana's reaches the team.
		await dana.store.updateCase("c_up", (c) => ({
			value: withCaseComment(
				c as unknown as Case,
				{ id: "k_after", text: "After the upgrade" },
				new Date(dana.clock.now.getTime() + 60_000).toISOString(),
			) as never,
		}));
		await engine.request();
		expect(server.commentsOf("c_up").map((k) => k.text)).toEqual([
			"Before the upgrade",
			"After the upgrade",
		]);
		// Looked for once: a run after that reads no case anew.
		let reads = 0;
		const getCase = dana.api.getCase.bind(dana.api);
		dana.api.getCase = (team, id) => {
			reads++;
			return getCase(team, id);
		};
		await engine.request();
		expect(reads).toBe(0);
	});
});

describe("0.3.0's data opened by this build sends nothing nobody did (review of #25)", () => {
	test("marks of every kind, settled, reopened, with a finding, one renumbered, and an edit left in 0.3.0's queue: only that edit goes, once", async () => {
		await startCase(tess, "c_rich");
		// The first a box on an element, as the toolbar draws it; then one of
		// each other kind.
		for (const text of ["Element", "Box", "Arrow", "Pen", "Note"])
			await addMark(tess, "c_rich", text, { element: text === "Element" });
		const shapes: Record<string, Shape | undefined> = {
			a1: undefined,
			a2: { kind: "box", rect: { x: 10, y: 10, width: 80, height: 40 } },
			a3: { kind: "arrow", from: { x: 5, y: 5 }, to: { x: 60, y: 40 } },
			a4: {
				kind: "pen",
				points: [
					{ x: 1, y: 1 },
					{ x: 20, y: 9 },
					{ x: 40, y: 2 },
				],
			},
			a5: { kind: "note", at: { x: 30, y: 30 } },
		};
		await change(tess, "c_rich", (c, now) =>
			withFinding(
				withReopen(
					withResolution(
						withResolution(
							{
								...c,
								marks: c.marks.map((a) => {
									const shape = shapes[a.id];
									return shape === undefined ? a : { ...a, shape };
								}),
							},
							"a2",
							{ kind: "fixed", note: "Padding" },
							now,
						),
						"a3",
						{ kind: "fixed" },
						now,
					),
					"a3",
					{ note: "Still off" },
					now,
				),
				"a4",
				{
					id: "f_1",
					text: "The stroke is on the price",
					app: CLAUDE,
					at: now,
				},
				now,
			),
		);
		await sync();
		// A sixth mark, made on both at once: the server renumbers 0.3.0's.
		await addMark(tess, "c_rich", "Tess's sixth");
		await tess.engine.request();
		await dana.store.putImage("c_rich", "crops/a6.webp", {
			blob: webp("crop by 0.3.0", 280, 160),
			width: 280,
			height: 160,
		});
		await dana.store.updateCase("c_rich", (c) => {
			const value = c as Case030;
			const one = value.annotations[0] as Case030["annotations"][number];
			return {
				value: {
					...value,
					annotations: [
						...value.annotations,
						{
							...one,
							id: "a6",
							number: 6,
							comment: "Dana's sixth",
							crop: "crops/a6.webp",
							shape: { kind: "note", at: { x: 8, y: 8 } },
							element: null,
						},
					],
					updatedAt: new Date(dana.clock.now.getTime() + 60_000).toISOString(),
				},
			};
		});
		await sync();
		const marks = server.marksOf("c_rich");
		expect(marks.map((m) => [m.number, m.comment])).toEqual([
			[1, "Element"],
			[2, "Box"],
			[3, "Arrow"],
			[4, "Pen"],
			[5, "Note"],
			[6, "Tess's sixth"],
			[7, "Dana's sixth"],
		]);
		// 0.3.0 edits a mark; the server takes it, and the reply is lost: the
		// edit stays in 0.3.0's queue, sent and not known to be.
		await dana.store.updateCase("c_rich", (c) => ({
			value: withComment030(
				c as Case030,
				"a1",
				"Element, edited by 0.3.0",
				new Date(dana.clock.now.getTime() + 120_000).toISOString(),
			),
		}));
		dana.api.loseReplies = 1;
		await dana.engine.request();
		const queued = dana.kv.data.get("queue") as
			| { ops: { opId: string; type: string }[] }
			| undefined;
		expect(queued?.ops.map((o) => o.type)).toEqual(["mark.patch"]);

		// This build, on the same database: every request it makes until the
		// test's own first change.
		const sent: { opId: string; type: string }[] = [];
		const ops = dana.api.ops.bind(dana.api);
		dana.api.ops = async (team, list) => {
			sent.push(...list.map((o) => ({ opId: o.opId, type: o.type })));
			return ops(team, list);
		};
		const from = dana.api.calls.length;
		const engine = new CloudSync({
			store: dana.store as never,
			kv: dana.kv as never,
			api: () => dana.api as never,
		});
		await engine.request();
		await engine.request();
		await engine.request();
		// Only 0.3.0's edit, as it was queued (the server knows it: once).
		expect(sent).toEqual(
			(queued?.ops ?? []).map((o) => ({ opId: o.opId, type: o.type })),
		);
		const calls = dana.api.calls.slice(from);
		expect(calls.filter((c) => c.startsWith("PUT blob"))).toEqual([]);
		expect(calls.filter((c) => c.startsWith("HEAD blob"))).toEqual([]);
		expect(server.marksOf("c_rich").find((m) => m.number === 1)?.comment).toBe(
			"Element, edited by 0.3.0",
		);
		expect(server.marksOf("c_rich")).toHaveLength(7);
		// The case here is the team's, mark for mark.
		const here = (await dana.store.getCase("c_rich")) as unknown as Case;
		expect(here.marks.map((a) => [a.number, a.shape.kind])).toEqual([
			[1, "box"],
			[2, "box"],
			[3, "arrow"],
			[4, "pen"],
			[5, "note"],
			[6, "box"],
			[7, "note"],
		]);
		expect(here.marks[1]?.resolution?.kind).toBe("fixed");
		expect(here.marks[2]?.reopens).toHaveLength(1);
		expect(here.marks[3]?.findings?.[0]?.id).toBe("f_1");
	});
});

describe("0.3.0's data opened by this build, when the database fails once (review of #25)", () => {
	test("the look for old books is made again at the next run", async () => {
		await startCase(tess, "c_fail");
		await addMark(tess, "c_fail", "Total is cut off");
		await sync();
		await change(tess, "c_fail", (c, now) =>
			withCaseComment(c, { id: "k_fail", text: "Before the upgrade" }, now),
		);
		await sync();
		// The first write of a book after the upgrade fails.
		let fail = true;
		const kv = {
			...dana.kv,
			set: async (entries: Record<string, unknown>) => {
				if (fail && Object.keys(entries).some((k) => k.startsWith("case:"))) {
					fail = false;
					throw new Error("The database could not be written.");
				}
				return dana.kv.set(entries);
			},
		};
		const engine = new CloudSync({
			store: dana.store as never,
			kv: kv as never,
			api: () => dana.api as never,
		});
		await engine.request().catch(() => undefined);
		await engine.request();
		await engine.request();
		const here = (await dana.store.getCase("c_fail")) as unknown as Case;
		expect(here.comments?.map((k) => k.text)).toEqual(["Before the upgrade"]);
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
	test("0.3.0 reads it, without what it does not know; this build reads it back whole, without this browser's notes", async () => {
		await startCase(tess, "c_file");
		await addMark(tess, "c_file", "Total is cut off");
		// The thread, a close and a mark made through Claude, as the tools
		// and the panel make them.
		const c = await change(tess, "c_file", (k, now) => ({
			...withClosed(
				withCaseComment(
					withCaseComment(k, { id: "k_1", text: "On the case" }, now),
					{ id: "k_2", text: "On mark 1", mark: "a1", app: CLAUDE },
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
		// 0.3.0: the case and its marks, nothing else.
		const old = validateCase030(json);
		expect(old.annotations.map((a) => a.comment)).toEqual(["Total is cut off"]);
		expect(Object.keys(old)).not.toContain("comments");
		expect(Object.keys(old)).not.toContain("closed");
		expect(Object.keys(old.annotations[0] ?? {})).not.toContain("createdVia");
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
			["k_2", "a1", "Claude", true],
		]);
		expect(back.closed?.app?.name).toBe("Claude");
		expect(back.marks[0]?.createdVia).toBeUndefined();
		expect(back.via).toBeUndefined();
		expect(back.createdVia).toBeUndefined();
	});
	test("an element's look (DEC-048): 0.3.0 reads the file without it; this build reads it back", async () => {
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
		const old = validateCase030(json);
		const element = old.annotations[0]?.element as unknown as Record<
			string,
			unknown
		>;
		expect(element["selector"]).toBe("form > button");
		for (const key of ["styles", "backdrop", "siblings"])
			expect(key in element).toBe(false);
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
