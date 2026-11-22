/**
 * The sync with a team (DEC-039), against the API in memory
 * (`cloud-fake.ts`), which keeps the server's rules: two devices that end up
 * the same, changes that wait while the server is away, marks that take the
 * number the server gives, deletes that reach everyone, and a contract that
 * has grown since this build.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	addedImage,
	type Case,
	isOwnFinding,
	type Mark,
	markFor,
	markKey,
	validateCase,
	withChoice,
	withComment,
	withFinding,
	withImages,
	withLink,
	withoutImage,
	withoutMark,
	withTitle,
	withVerified,
} from "../src/lib/case.ts";
import {
	ApiFailure,
	type Op,
	SMALL_PAGE,
	TOO_LARGE,
	type WireMark,
} from "../src/lib/cloud/api.ts";
import {
	type Account,
	type CaseBook,
	type CloudStatus,
	KEYS,
	type Queue,
} from "../src/lib/cloud/book.ts";
import { undoAdd } from "../src/lib/save.ts";
import type { StoredImage } from "../src/lib/store.ts";
import { statusLine, syncNowHelps } from "../src/sidepanel/cloud-view.ts";
import { markAsked } from "../src/sidepanel/picked.ts";
import {
	editAfter,
	heldAfter,
	type MarkEdit,
	type PanelState,
} from "../src/sidepanel/state.ts";
import type { FakeApi } from "./cloud-fake.ts";
import { FakeServer, requestProblem, TEAM } from "./cloud-fake.ts";
import {
	addMark,
	CART,
	change,
	type Device,
	device,
	images,
	keys,
	look,
	PAY,
	removeCase,
	signIn,
	startCase,
	status,
	sync,
	tagOf,
	webp,
} from "./cloud-helpers.ts";

const TESS = { id: "u_tess", name: "Tess Tester" };
const DANA = { id: "u_dana", name: "Dana Developer" };

let server: FakeServer;
let tess: Device<FakeApi>;
let dana: Device<FakeApi>;

beforeEach(() => {
	server = new FakeServer();
	tess = device("tess", server.api(TESS));
	dana = device("dana", server.api(DANA));
});

/** The same device after its worker started anew: its store and database, nothing kept in memory. */
function restarted(d: Device<FakeApi>): Device<FakeApi> {
	const again = device(d.name, d.api);
	for (const [key, value] of d.kv.data) again.kv.data.set(key, value);
	for (const [key, value] of d.store.cases) again.store.cases.set(key, value);
	for (const [key, value] of d.store.images) again.store.images.set(key, value);
	for (const [key, value] of d.store.deleted)
		again.store.deleted.set(key, value);
	again.clock.now = d.clock.now;
	return again;
}

/** Wait until something is so (a run under way reaches a point). */
async function until(is: () => boolean): Promise<void> {
	for (let i = 0; i < 400 && !is(); i++) await Bun.sleep(5);
	if (!is()) throw new Error("it never came to that");
}

const book = (d: Device, caseId: string) =>
	d.kv.data.get(`case:${caseId}`) as CaseBook | undefined;
const posts = (d: Device<FakeApi>) =>
	d.api.calls.filter((c) => c.startsWith("POST ops"));

/** Both signed in, and a case of Tess's with two marks on two pages at both. */
async function shared(): Promise<void> {
	await signIn(tess);
	await signIn(dana);
	await startCase(tess, "c_flow");
	await addMark(tess, "c_flow", "Total is cut off", { element: true });
	await addMark(tess, "c_flow", "Pay button too pale", {
		url: PAY,
		title: "Payment",
	});
	await sync(tess, dana);
}

describe("the first time a device meets its team", () => {
	test("cases that were here before are not sent without a word: the user is asked", async () => {
		await startCase(tess, "c_old");
		await addMark(tess, "c_old", "Was here before");
		await startCase(tess, "c_older");
		await addMark(tess, "c_older", "This one too");
		await signIn(tess);
		expect(server.cases.size).toBe(0);
		expect(posts(tess)).toEqual([]);
		expect(status(tess)?.undecided).toBe(2);
		expect(tess.kv.data.get(KEYS.modes)).toEqual({
			c_old: "undecided",
			c_older: "undecided",
		});
		// "Sync them".
		await tess.engine.decide(true);
		expect([...server.cases.keys()].sort()).toEqual(["c_old", "c_older"]);
		expect(status(tess)?.undecided).toBe(0);
		expect(status(tess)?.state).toBe("synced");
	});

	test("Keep them on this device: nothing goes, and one can be shared later", async () => {
		await startCase(tess, "c_old");
		await addMark(tess, "c_old", "Was here before");
		await startCase(tess, "c_other");
		await addMark(tess, "c_other", "Stays private");
		await signIn(tess);
		await tess.engine.decide(false);
		expect(server.cases.size).toBe(0);
		expect(status(tess)?.undecided).toBe(0);
		// Changing it changes nothing about that.
		await change(tess, "c_old", (c, now) => withTitle(c, "Renamed", now));
		await tess.engine.request();
		expect(server.cases.size).toBe(0);
		// "Share with team" on one of them.
		await tess.engine.share("c_old");
		expect([...server.cases.keys()]).toEqual(["c_old"]);
		expect(server.caseOf("c_old")?.title).toBe("Renamed");
		expect(tess.kv.data.get(KEYS.modes)).toEqual({
			c_old: "synced",
			c_other: "local",
		});
	});

	test("a case made after that is the team's, once it has a mark", async () => {
		await signIn(tess);
		await startCase(tess, "c_new");
		await tess.engine.request();
		// As the folder sync: a case without marks is not sent.
		expect(server.cases.size).toBe(0);
		await addMark(tess, "c_new", "First mark");
		await tess.engine.request();
		expect(server.caseOf("c_new")?.title).toBe("Your cart");
		expect(server.marksOf("c_new").map((m) => m.comment)).toEqual([
			"First mark",
		]);
		expect(server.caseOf("c_new")?.createdBy).toEqual(TESS);
	});

	test("images go before the operations that name them, and one the team has is not sent again", async () => {
		await signIn(tess);
		await startCase(tess, "c_new");
		await addMark(tess, "c_new", "First mark");
		await tess.engine.request();
		const calls = tess.api.calls.filter((c) => !c.startsWith("GET"));
		// The new case goes alone, before any image is read (it names none);
		// then the images, then the screenshots and marks that name them.
		expect(calls[0]).toBe("POST ops 1");
		const firstPost = calls.findIndex(
			(c, i) => i > 0 && c.startsWith("POST ops"),
		);
		expect(
			calls.slice(0, firstPost).filter((c) => c.startsWith("PUT blob")),
		).toHaveLength(2);
		expect(calls.slice(firstPost).some((c) => c.startsWith("PUT blob"))).toBe(
			false,
		);
		expect(server.blobs.size).toBe(2);
		// Dana fetches them; a second mark of Tess's uploads only its own two.
		await signIn(dana);
		expect(dana.api.calls.filter((c) => c.startsWith("GET blob"))).toHaveLength(
			2,
		);
		expect(dana.api.calls.some((c) => c.startsWith("PUT blob"))).toBe(false);
		tess.api.calls.length = 0;
		await addMark(tess, "c_new", "Second mark");
		await tess.engine.request();
		expect(tess.api.calls.filter((c) => c.startsWith("PUT blob"))).toHaveLength(
			2,
		);
	});
});

describe("two devices and one team", () => {
	test("a case made on one is on the other, with its pages, marks and images", async () => {
		await shared();
		const there = await dana.store.getCase("c_flow");
		expect(look(there)).toEqual(look(await tess.store.getCase("c_flow")));
		expect(look(there)).toMatchObject({
			title: "Your cart",
			pages: [CART, PAY],
			marks: [
				{ number: 1, id: "m1", comment: "Total is cut off", page: CART },
				{ number: 2, id: "m2", comment: "Pay button too pale", page: PAY },
			],
		});
		expect(await images(dana, "c_flow")).toEqual(await images(tess, "c_flow"));
		expect(Object.values(await images(dana, "c_flow"))).not.toContain(
			"MISSING",
		);
		expect(there?.marks[0]?.element?.selector).toBe("form > button");
		// The case's first page, and who made the marks.
		expect(there?.page.url).toBe(CART);
		expect(there?.marks[0]?.createdBy).toEqual(TESS);
		expect(status(dana)?.state).toBe("synced");
		expect(dana.changed).toContain("c_flow");
	});

	test("a case that came from the server is no import, and its findings keep whose they are", async () => {
		await shared();
		const app = {
			id: "https://claude.ai/oauth",
			name: "Claude",
			host: "claude.ai",
		};
		await change(tess, "c_flow", (c, now) =>
			withFinding(
				c,
				"m1",
				{ id: "f_1", text: "The total wraps", app, at: now },
				now,
			),
		);
		await sync(tess, dana);
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.importedAt).toBeUndefined();
		const finding = there.marks[0]?.findings?.[0];
		expect(finding?.imported).toBeUndefined();
		expect(finding?.text).toBe("The total wraps");
		// Written for Tess: Tess's app's own on her device, nobody's on Dana's.
		expect(finding?.user).toEqual(TESS);
		expect(finding && isOwnFinding(finding, app.id, TESS.id)).toBe(true);
		expect(finding && isOwnFinding(finding, app.id, DANA.id)).toBe(false);
		expect(finding && isOwnFinding(finding, app.id, undefined)).toBe(false);
		const mine = (await tess.store.getCase("c_flow"))?.marks[0]?.findings?.[0];
		expect(mine?.user).toEqual(TESS);
		// A finding that never left this device is its app's, as before.
		expect(
			isOwnFinding({ id: "f", text: "x", app, at: "now" }, app.id, undefined),
		).toBe(true);
	});

	test("what each changes reaches the other, with who did it", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) =>
			withChoice(c, "m1", "fixed", "Widened the column", now),
		);
		await change(tess, "c_flow", (c, now) =>
			withLink(
				withTitle(c, "Checkout flow", now),
				"https://tickets.example/7",
				now,
			),
		);
		await sync(tess, dana);
		for (const d of [tess, dana])
			expect(look(await d.store.getCase("c_flow"))).toMatchObject({
				title: "Checkout flow",
				link: "https://tickets.example/7",
				marks: [
					{ status: "fixed", note: "Widened the column", by: "Dana Developer" },
					{ status: "open" },
				],
			});
		// The tester verifies: that is hers.
		await change(tess, "c_flow", (c, now) =>
			withVerified(c, "m1", undefined, now),
		);
		await sync(tess, dana);
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.marks[0]?.resolution?.user).toEqual(DANA);
		expect(there.marks[0]?.resolution?.verified?.user).toEqual(TESS);
	});

	test("two changes to different things of one mark both stay; the same thing: the later one", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Total is cut off on small windows", now),
		);
		await change(dana, "c_flow", (c, now) =>
			withChoice(c, "m1", "wontfix", "", now),
		);
		await sync(tess, dana);
		for (const d of [tess, dana])
			expect(look(await d.store.getCase("c_flow"))?.marks[0]).toMatchObject({
				comment: "Total is cut off on small windows",
				status: "wontfix",
			});
		// Both change the comment: who sends later wins, on both.
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m2", "Tess's words", now),
		);
		await change(dana, "c_flow", (c, now) =>
			withComment(c, "m2", "Dana's words", now),
		);
		await tess.engine.request();
		await dana.engine.request();
		await sync(tess, dana);
		for (const d of [tess, dana])
			expect(look(await d.store.getCase("c_flow"))?.marks[1]?.comment).toBe(
				"Dana's words",
			);
	});

	test("nothing is sent twice: a run with nothing new asks only for the changes", async () => {
		await shared();
		tess.api.calls.length = 0;
		dana.api.calls.length = 0;
		await sync(tess, dana);
		expect(tess.api.calls.every((c) => c.startsWith("GET changes"))).toBe(true);
		expect(dana.api.calls.every((c) => c.startsWith("GET changes"))).toBe(true);
		// And the cases were not written again: nothing changed here.
		const before = tess.changed.length;
		await tess.engine.request();
		expect(tess.changed).toHaveLength(before);
	});
});

describe("the status line, from the engine's real states (DEC-045)", () => {
	type Cloud = PanelState["cloud"];
	/** The panel's view of Tess's sync: her account, her engine's status, the stream. */
	const panelOf = async (
		d: Device,
		live: boolean | undefined,
	): Promise<Cloud> => {
		const account = (await d.engine.account()) as Account;
		return {
			server: account.server,
			account: {
				name: account.user.name,
				email: account.user.email,
				userId: account.user.id,
				server: account.server,
				teams: account.teams.map((t) => ({
					id: t.id,
					name: t.name,
					permissions: [...(t.permissions ?? [])],
				})),
				teamId: account.teamId,
				expired: account.expired === true,
			},
			status: status(d),
			modes: {},
			signingIn: false,
			problem: undefined,
			live,
			minute: 0,
		};
	};

	test("up to date only when nothing waits and the stream is open; offline says what waits; Sync now only when it helps", async () => {
		await shared();
		const panel = await panelOf(tess, true);
		expect(status(tess)?.waiting).toBe(0);
		expect(statusLine(panel)).toStartWith("Up to date");
		expect(syncNowHelps(panel)).toBe(false);
		// The stream closed: when it last synced, and Sync now.
		const closed = await panelOf(tess, false);
		expect(statusLine(closed, tess.clock.now.getTime())).toStartWith(
			"Last synced just now.",
		);
		expect(syncNowHelps(closed)).toBe(true);
		// Offline with a change: the change waits, and says so.
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Edited offline", now),
		);
		await tess.engine.request();
		const offline = await panelOf(tess, false);
		expect(status(tess)?.state).toBe("offline");
		expect(status(tess)?.waiting).toBe(1);
		expect(statusLine(offline)).toStartWith("Offline:");
		expect(statusLine(offline)).toContain("1 case waits to be sent");
		expect(syncNowHelps(offline)).toBe(true);
		// A run said "syncing" on its way.
		tess.api.offline = false;
		tess.statuses.length = 0;
		await tess.engine.request();
		expect(tess.statuses.some((x) => x.state === "syncing")).toBe(true);
		expect(
			statusLine({
				...(await panelOf(tess, true)),
				status: {
					...(tess.statuses.find((x) => x.state === "syncing") as CloudStatus),
				},
			}),
		).toStartWith("Syncing");
		// Sent: up to date again.
		expect(status(tess)?.waiting).toBe(0);
		expect(statusLine(await panelOf(tess, true))).toStartWith("Up to date");
	});

	test("what is not the team's does not wait: a case kept on this device, one not decided about, one without a mark", async () => {
		await startCase(tess, "c_old");
		await addMark(tess, "c_old", "Was here before");
		await signIn(tess);
		expect(status(tess)?.undecided).toBe(1);
		await tess.engine.decide(false);
		await startCase(tess, "c_empty");
		await tess.engine.request();
		expect(status(tess)?.waiting).toBe(0);
		expect(statusLine(await panelOf(tess, true))).toStartWith("Up to date");
	});
});

describe("the account looked at again when the panel is shown (DEC-045)", () => {
	test("one request, only after a minute; a team joined meanwhile is written, said and synced with", async () => {
		await signIn(tess);
		const me = tess.api.me.bind(tess.api);
		tess.api.calls.length = 0;
		// Shown at once again: nothing asked.
		expect(await tess.engine.checkAccount()).toBe(false);
		expect(tess.api.calls).toEqual([]);
		// A minute later, nothing changed: one request, no run.
		tess.clock.now = new Date(tess.clock.now.getTime() + 61_000);
		expect(await tess.engine.checkAccount()).toBe(false);
		expect(tess.api.calls).toEqual(["GET me"]);
		// Another team joined on the web app: written, and a run follows.
		tess.api.me = async () => {
			const answer = await me();
			return {
				...answer,
				teams: [
					...(answer.teams ?? []),
					{
						id: "t_other",
						name: "Other team",
						slug: "other",
						role: "contributor",
						permissions: [],
					},
				],
			};
		};
		tess.clock.now = new Date(tess.clock.now.getTime() + 61_000);
		tess.api.calls.length = 0;
		expect(await tess.engine.checkAccount()).toBe(true);
		expect(
			((await tess.engine.account()) as Account).teams.map((t) => t.name),
		).toEqual(["Pedal & Pine web", "Other team"]);
		expect(tess.api.calls[0]).toBe("GET me");
	});

	test("a role that allows again what it did not: the case that waits is said to wait, as it is about to be sent", async () => {
		await signIn(tess);
		tess.api.permissions = tess.api.permissions.filter(
			(p) => p !== "mark:create" && p !== "case:create",
		);
		await tess.engine.retry();
		await startCase(tess, "c_held");
		await addMark(tess, "c_held", "Held back");
		await tess.engine.request();
		// Held back by the role: not waiting, said as a problem.
		expect(status(tess)?.waiting).toBe(0);
		expect(status(tess)?.problems).toHaveLength(1);
		// The role allows it again, and the panel's look finds that out.
		tess.api.permissions = [
			...tess.api.permissions,
			"mark:create",
			"case:create",
		];
		tess.clock.now = new Date(tess.clock.now.getTime() + 61_000);
		tess.statuses.length = 0;
		const later = tess.engine.checkAccount();
		expect(await later).toBe(true);
		// Said with the new role, before the run sends it: it waits.
		expect(tess.statuses[0]?.waiting).toBe(1);
		await tess.engine.request();
		expect(server.cases.has("c_held")).toBe(true);
		expect(status(tess)?.waiting).toBe(0);
	});
});

describe("changes that wait", () => {
	test("offline: every change is kept, said so, and sent when the server is back", async () => {
		await shared();
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Edited offline", now),
		);
		await addMark(tess, "c_flow", "Added offline");
		await tess.engine.request();
		expect(status(tess)?.state).toBe("offline");
		expect(status(tess)?.text).toContain("kept and sent");
		expect(look(await tess.store.getCase("c_flow"))?.marks).toHaveLength(3);
		expect(server.marksOf("c_flow")).toHaveLength(2);
		tess.api.offline = false;
		await sync(tess, dana);
		expect(status(tess)?.state).toBe("synced");
		expect(
			look(await dana.store.getCase("c_flow"))?.marks.map((m) => m.comment),
		).toEqual(["Edited offline", "Pay button too pale", "Added offline"]);
	});

	test("a change made while the server was away survives what the team did meanwhile", async () => {
		await shared();
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Tess, offline", now),
		);
		await tess.engine.request();
		// Meanwhile Dana settles that mark and edits the other.
		await change(dana, "c_flow", (c, now) =>
			withComment(
				withChoice(c, "m1", "fixed", "Done", now),
				"m2",
				"Dana's edit",
				now,
			),
		);
		await dana.engine.request();
		tess.api.offline = false;
		await tess.engine.request();
		expect(look(await tess.store.getCase("c_flow"))?.marks).toMatchObject([
			{ comment: "Tess, offline", status: "fixed", note: "Done" },
			{ comment: "Dana's edit" },
		]);
		await dana.engine.request();
		expect(look(await dana.store.getCase("c_flow"))).toEqual(
			look(await tess.store.getCase("c_flow")),
		);
	});

	test("a change made while the team's changes are fetched is not overwritten, and goes next", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) =>
			withComment(c, "m1", "Dana's words", now),
		);
		await dana.engine.request();
		// Tess types while her device fetches.
		const changes = tess.api.changes.bind(tess.api);
		tess.api.changes = async (team, since) => {
			const answer = await changes(team, since);
			tess.api.changes = changes;
			await change(tess, "c_flow", (c, now) =>
				withChoice(
					withComment(c, "m1", "Tess, just now", now),
					"m2",
					"fixed",
					"",
					now,
				),
			);
			return answer;
		};
		await tess.engine.request();
		expect(look(await tess.store.getCase("c_flow"))?.marks).toMatchObject([
			{ comment: "Tess, just now" },
			{ status: "fixed" },
		]);
		await sync(tess, dana);
		expect(look(await dana.store.getCase("c_flow"))?.marks).toMatchObject([
			{ comment: "Tess, just now" },
			{ status: "fixed" },
		]);
	});

	test("a reply that never came: the same operations go again, and the server applies them once", async () => {
		await signIn(tess);
		await startCase(tess, "c_lost");
		await addMark(tess, "c_lost", "One");
		await addMark(tess, "c_lost", "Two");
		// The new case goes alone, and its answer is lost.
		tess.api.loseReplies = 1;
		await tess.engine.request();
		expect(status(tess)?.state).toBe("offline");
		expect(server.cases.has("c_lost")).toBe(true);
		const first = (tess.kv.data.get(KEYS.queue) as Queue).ops.map(
			(op) => op.opId,
		);
		expect(first).toHaveLength(1);
		// Then its screenshots and marks, whose answer is lost too.
		tess.api.loseReplies = 0;
		const ops = tess.api.ops.bind(tess.api);
		let requests = 0;
		tess.api.ops = async (team, list) => {
			if (++requests === 2) tess.api.loseReplies = 1;
			return ops(team, list);
		};
		await tess.engine.request();
		tess.api.ops = ops;
		expect(status(tess)?.state).toBe("offline");
		// Applied at the server, not known here: written down, to go again.
		expect(server.marksOf("c_lost")).toHaveLength(2);
		const queue = tess.kv.data.get(KEYS.queue) as Queue;
		const ids = [...first, ...queue.ops.map((op) => op.opId)];
		expect(ids.length).toBeGreaterThan(3);
		tess.api.calls.length = 0;
		await tess.engine.request();
		expect(status(tess)?.state).toBe("synced");
		expect(tess.kv.data.get(KEYS.queue)).toBeUndefined();
		expect(server.marksOf("c_lost").map((m) => m.comment)).toEqual([
			"One",
			"Two",
		]);
		expect([...server.applied.keys()].sort()).toEqual([...ids].sort());
		// Not derived a second time under new ids.
		expect(posts(tess)).toHaveLength(1);
		tess.api.calls.length = 0;
		await tess.engine.request();
		expect(posts(tess)).toEqual([]);
	});
});

describe("mark numbers", () => {
	test("two add a mark at once: the later one takes the server's number, id and crop path with it", async () => {
		await shared();
		const mine = await addMark(tess, "c_flow", "Tess's third");
		const theirs = await addMark(dana, "c_flow", "Dana's third");
		expect([mine.id, theirs.id]).toEqual(["m3", "m3"]);
		const danaCrop = await (
			await dana.store.getImage("c_flow", "crops/m3.webp")
		)?.blob.text();
		await tess.engine.request();
		await dana.engine.request();
		// Dana's mark is 4 now, everywhere it is named.
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.marks.map((a) => [a.id, a.number, a.crop, a.comment])).toEqual(
			[
				["m1", 1, "crops/m1.webp", "Total is cut off"],
				["m2", 2, "crops/m2.webp", "Pay button too pale"],
				["m3", 3, "crops/m3.webp", "Tess's third"],
				["m4", 4, "crops/m4.webp", "Dana's third"],
			],
		);
		expect(
			await (await dana.store.getImage("c_flow", "crops/m4.webp"))?.blob.text(),
		).toBe(danaCrop);
		expect(there.lastNumber).toBe(4);
		expect(keys(dana, "c_flow").filter((k) => k.includes("/crops/"))).toEqual([
			"c_flow/crops/m1.webp",
			"c_flow/crops/m2.webp",
			"c_flow/crops/m3.webp",
			"c_flow/crops/m4.webp",
		]);
		expect(book(dana, "c_flow")?.marks["m4"]).toBe(
			server.marksOf("c_flow")[3]?.id as string,
		);
		await sync(tess, dana);
		expect(look(await tess.store.getCase("c_flow"))).toEqual(look(there));
		expect(await images(tess, "c_flow")).toEqual(await images(dana, "c_flow"));
		expect(server.marksOf("c_flow").map((m) => m.number)).toEqual([1, 2, 3, 4]);
	});

	test("a mark that came from the team takes its number; a mark here that holds it, not sent yet, moves", async () => {
		await shared();
		await addMark(tess, "c_flow", "Tess's third");
		await tess.engine.request();
		// Dana's own third cannot go (her role may not add marks): it stays here.
		dana.api.permissions = dana.api.permissions.filter(
			(p) => p !== "mark:create",
		);
		await dana.engine.retry();
		await addMark(dana, "c_flow", "Dana's, not sent");
		await dana.engine.request();
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.marks.map((a) => [a.id, a.comment])).toEqual([
			["m1", "Total is cut off"],
			["m2", "Pay button too pale"],
			["m3", "Tess's third"],
			["m4", "Dana's, not sent"],
		]);
		expect(status(dana)?.problems[0]?.text).toContain("does not allow");
		// Allowed again: it goes, as 4.
		dana.api.permissions.push("mark:create");
		await dana.engine.retry();
		await sync(tess, dana);
		expect(
			look(await tess.store.getCase("c_flow"))?.marks.map((m) => m.comment),
		).toEqual([
			"Total is cut off",
			"Pay button too pale",
			"Tess's third",
			"Dana's, not sent",
		]);
	});

	test("a number the team has used is not given again here after the panel's delete", async () => {
		await shared();
		await addMark(tess, "c_flow", "Third");
		await sync(tess, dana);
		// Tess takes it out again: the panel's delete, which keeps the number.
		await change(tess, "c_flow", (c, now) => withoutMark(c, "m3", now));
		await sync(tess, dana);
		const next = await addMark(dana, "c_flow", "Dana's next");
		expect(next.number).toBe(4);
		await sync(tess, dana);
		expect(server.marksOf("c_flow").map((m) => m.number)).toEqual([1, 2, 4]);
	});
});

describe("a form open on a mark that takes another number", () => {
	test("the form follows its mark: what was typed for one's own mark is not saved onto the teammate's that got its id", async () => {
		await shared();
		// Each adds a third mark; Tess has her comment form open on hers.
		await addMark(tess, "c_flow", "Tess's third");
		await addMark(dana, "c_flow", "Dana's third", { url: PAY });
		const before = (await tess.store.getCase("c_flow")) as Case;
		const mine = before.marks.find((a) => a.id === "m3") as Mark;
		const edit: MarkEdit = {
			markId: "m3",
			mark: markKey(before, mine),
			mode: "comment",
			kind: "fixed",
			text: "Typed while the sync ran",
		};
		await dana.engine.request();
		await sync(tess, dana);
		// Her mark is 4 now, and "m3" is Dana's.
		const after = (await tess.store.getCase("c_flow")) as Case;
		expect(after.marks.map((a) => [a.id, a.comment])).toEqual([
			["m1", "Total is cut off"],
			["m2", "Pay button too pale"],
			["m3", "Dana's third"],
			["m4", "Tess's third"],
		]);
		expect(editAfter(edit, after)).toEqual({ ...edit, markId: "m4" });
		// A change is held to the mark it was opened on, not to the id.
		expect(markFor(after, "m3", edit.mark)).toMatchObject({
			id: "m4",
			comment: "Tess's third",
		});
		expect(markKey(after, after.marks[2] as Mark)).not.toBe(edit.mark);
		// The mark deleted meanwhile: the form closes, and nothing is its mark.
		const gone = withoutMark(after, "m4", after.updatedAt).value;
		expect(editAfter(edit, gone)).toBeUndefined();
		expect(markFor(gone, "m3", edit.mark)).toBeUndefined();
		// A mark that nothing tells apart from the form's mark (the same
		// element marked twice on one screenshot) came since: neither is the
		// form's mark, whatever the ids say, and nothing is changed.
		const twin = {
			...(after.marks[3] as Mark),
			id: "m5",
			number: 5,
		};
		const twins = { ...after, marks: [...after.marks, twin] };
		expect(markFor(twins, "m4", edit.mark)).toBe("ambiguous");
		expect(markFor(twins, "m5", edit.mark)).toBe("ambiguous");
		expect(markFor(twins, "m3", edit.mark)).toBe("ambiguous");
		expect(editAfter(edit, twins)).toBeUndefined();
		// A delete asked once ("Really delete?") follows its mark the same
		// way: its second click must not find the teammate's mark.
		const armed = { markId: "m3", mark: edit.mark, at: 1 };
		expect(heldAfter(armed, after)).toEqual({ ...armed, markId: "m4" });
		expect(heldAfter(armed, gone)).toBeUndefined();
		expect(heldAfter(armed, before)).toBe(armed);
		// Unchanged: the same form.
		expect(editAfter(edit, before)).toBe(edit);
	});

	test("twins (the same element marked twice on one screenshot): held to their ids while those stay; once a renumbering moves them, every change is refused", async () => {
		await shared();
		await addMark(tess, "c_flow", "Tess's third");
		const one = (await tess.store.getCase("c_flow")) as Case;
		const third = one.marks.find((a) => a.id === "m3") as Mark;
		// Before: M = m3, T = m4, the same drawing on the same screenshot.
		const before: Case = {
			...one,
			marks: [
				...one.marks.filter((a) => a.id !== "m3"),
				{ ...third, comment: "M" },
				{ ...third, id: "m4", number: 4, comment: "T" },
			],
		};
		const t = before.marks[3] as Mark;
		const key = markKey(before, t);
		// Nothing moved: each twin is its own, and can be changed.
		expect(markFor(before, "m4", key)).toMatchObject({ comment: "T" });
		expect(
			markFor(before, "m3", markKey(before, before.marks[2] as Mark)),
		).toMatchObject({ comment: "M" });
		// A teammate's mark takes 3: M is m4, T is m5. What was opened on T
		// (m4) must not land on M, which has T's id and drawing now.
		const dana3 = {
			...(one.marks[0] as Mark),
			id: "m3",
			number: 3,
			comment: "Dana's",
		};
		const after: Case = {
			...one,
			marks: [
				...one.marks.filter((a) => a.id !== "m3"),
				dana3,
				{ ...third, id: "m4", number: 4, comment: "M" },
				{ ...third, id: "m5", number: 5, comment: "T" },
			],
		};
		expect(markFor(after, "m4", key)).toBe("ambiguous");
		// The popover's page and the panel answer by it.
		expect(
			markAsked(
				{
					open: after,
					loaded: { caseId: "c_flow", tabId: 1 },
					front: undefined,
				},
				{ caseId: "c_flow", markId: "m4", mark: key },
				1,
			),
		).toBe("changed");
		// The panel's form and a "Really delete?" let go.
		const edit: MarkEdit = {
			markId: "m4",
			mark: key,
			mode: "comment",
			kind: "fixed",
			text: "Typed for T",
		};
		expect(editAfter(edit, after)).toBeUndefined();
		expect(heldAfter({ markId: "m4", mark: key, at: 1 }, after)).toBe(
			undefined,
		);
		// A confirmed AI call held to T's key finds none at mark 4.
		expect(markKey(after, after.marks[3] as Mark)).not.toBe(key);
	});
});

describe("the toolbar's Undo in a synced case", () => {
	/** Undo the add of a mark, as the toolbar does: its number and its screenshot's id are free again. */
	async function undo(d: Device, id: string): Promise<void> {
		const c = (await d.store.getCase("c_flow")) as Case;
		const a = c.marks.find((x) => x.id === id) as Mark;
		d.clock.now = new Date(d.clock.now.getTime() + 1000);
		const done = await undoAdd(
			d.store,
			"c_flow",
			id,
			{ shot: a.shot, comment: a.comment },
			d.clock.now,
		);
		expect(done.removed).toBe(true);
	}
	const agree = async () => {
		const mine = await tess.store.getCase("c_flow");
		expect(look(mine)).toEqual(look(await dana.store.getCase("c_flow")));
		expect(await images(tess, "c_flow")).toEqual(await images(dana, "c_flow"));
		expect(server.marksOf("c_flow").map((m) => [m.number, m.comment])).toEqual(
			look(mine)?.marks.map((m) => [m.number, m.comment]) as never,
		);
		expect(server.shotsOf("c_flow")).toHaveLength(mine?.shots.length ?? -1);
		expect(status(tess)?.problems).toEqual([]);
	};

	test("undone, and the same element marked again before any run: the team gets the new mark with the new screenshot, and the old one goes", async () => {
		await shared();
		await addMark(tess, "c_flow", "Third", { element: true });
		await sync(tess, dana);
		const old = (await tess.store.getCase("c_flow"))?.marks.find(
			(a) => a.id === "m3",
		) as Mark;
		const before = server.shotsOf("c_flow").map((s) => s.id);
		await undo(tess, "m3");
		const again = await addMark(tess, "c_flow", "Third", { element: true });
		// The very same drawing, on a screenshot with the id the old one had.
		expect(again.shot).toBe(old.shot);
		await change(tess, "c_flow", (c, now) => ({
			...c,
			updatedAt: now,
			marks: c.marks.map((a) =>
				a.id === again.id
					? { ...a, shape: old.shape, element: old.element }
					: a,
			),
		}));
		await sync(tess, dana);
		await sync(tess, dana);
		await agree();
		// Not the old screenshot under the new mark.
		const now = server.shotsOf("c_flow").map((s) => s.id);
		expect(now).toHaveLength(3);
		expect(now.filter((id) => !before.includes(id))).toHaveLength(1);
	});

	test("undone and marked again with another drawing, with and without a run in between", async () => {
		await shared();
		await addMark(tess, "c_flow", "Third", { element: true });
		await sync(tess, dana);
		await undo(tess, "m3");
		await addMark(tess, "c_flow", "Third, taken again");
		await sync(tess, dana);
		await sync(tess, dana);
		await agree();
		// And with a run after the Undo: the number is the team's to give.
		const last = (await tess.store.getCase("c_flow"))?.marks.at(-1);
		await undo(tess, last?.id as string);
		await sync(tess, dana);
		await addMark(tess, "c_flow", "Once more");
		await sync(tess, dana);
		await sync(tess, dana);
		await agree();
	});
});

describe("what a mark stores differently from what the server keeps is compared as it is sent", () => {
	const times = [
		"2026-11-19T10:00:05+00:00",
		"2026-11-19T10:00Z",
		"2026-11-19 10:00:05",
		"yesterday",
	];
	const rows: [string, (c: Case) => Case, (() => Promise<void>)?][] = [
		...times.map((written): [string, (c: Case) => Case] => [
			`a screenshot taken at “${written}” (a case from a file)`,
			(c) => ({
				...c,
				shots: c.shots.map((x) => ({ ...x, capturedAt: written })),
			}),
		]),
		[
			"an element whose id is longer than the server takes",
			(c) => ({
				...c,
				marks: c.marks.map((a) => ({
					...a,
					element:
						a.element === null
							? null
							: {
									...a.element,
									id: "x".repeat(600),
									testId: "t".repeat(700),
									role: "r".repeat(300),
								},
				})),
			}),
			async () => {
				// The server has it cut, as its contract asks; here it is whole.
				expect(server.marksOf("c_form")[0]?.element?.id).toHaveLength(500);
				expect(
					(await tess.store.getCase("c_form"))?.marks[0]?.element?.id,
				).toHaveLength(600);
			},
		],
	];
	for (const [what, edit, extra] of rows)
		test(`${what}: its mark stays one mark, change after change`, async () => {
			await signIn(tess);
			await signIn(dana);
			await startCase(tess, "c_form");
			await addMark(tess, "c_form", "One", { element: true });
			await change(tess, "c_form", (c, now) =>
				validateCase({ ...edit(c), updatedAt: now }),
			);
			await sync(tess, dana);
			for (let i = 0; i < 3; i++) {
				await change(tess, "c_form", (c, now) =>
					withTitle(c, `Title ${i}`, now),
				);
				await sync(tess, dana);
			}
			tess.api.calls.length = 0;
			for (let i = 0; i < 3; i++) await sync(tess, dana);
			expect(
				[...server.marks.values()].map((r) => [r.value.number, r.deleted]),
			).toEqual([[1, false]]);
			expect(server.shotsOf("c_form")).toHaveLength(1);
			expect(look(await dana.store.getCase("c_form"))?.marks).toHaveLength(1);
			expect(posts(tess)).toEqual([]);
			expect(status(tess)?.state).toBe("synced");
			await extra?.();
		});
});

describe("an id that passes from one mark to another in a merge", () => {
	test("a renumbering that could not be stored, then a worker that stops between the ids and the case: both marks survive, each its own", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_flow");
		await addMark(tess, "c_flow", "One");
		await addMark(tess, "c_flow", "Two");
		await sync(tess, dana);
		await addMark(tess, "c_flow", "Tess's third");
		await addMark(dana, "c_flow", "Dana's third", { url: PAY });
		await dana.engine.request();
		// Tess's device sends hers; the server gives it 4; storing the new
		// number fails, once, and the run ends there.
		const update = tess.store.updateCase.bind(tess.store);
		const ops = tess.api.ops.bind(tess.api);
		let posted = false;
		tess.api.ops = async (team, list) => {
			const answer = await ops(team, list);
			posted = true;
			return answer;
		};
		let failed = false;
		tess.store.updateCase = async (id, how) => {
			if (posted && !failed) {
				failed = true;
				throw new Error("the store failed once");
			}
			return update(id, how);
		};
		await tess.engine.request();
		tess.api.ops = ops;
		expect(failed).toBe(true);
		// The next run: the worker stops between the ids and the case.
		let reached = false;
		tess.store.updateCase = () =>
			new Promise<never>(() => {
				reached = true;
			});
		void tess.engine.request();
		await until(() => reached);
		tess.store.updateCase = update;
		// The id "m3" passes from Tess's mark to Dana's in that merge: it is
		// announced, with Dana's drawing, like a new one.
		expect(Object.keys(book(tess, "c_flow")?.announced?.marks ?? {})).toContain(
			"m3",
		);
		const again = restarted(tess);
		for (let i = 0; i < 4; i++) {
			await again.engine.request();
			await dana.engine.request();
		}
		const rows = [...server.marks.values()]
			.filter((r) => !r.deleted)
			.map((r) => [r.value.comment, r.value.createdBy?.name])
			.sort();
		expect(rows).toEqual([
			["Dana's third", "Dana Developer"],
			["One", "Tess Tester"],
			["Tess's third", "Tess Tester"],
			["Two", "Tess Tester"],
		]);
		expect([...server.marks.values()].filter((r) => r.deleted)).toEqual([]);
		expect(look(await again.store.getCase("c_flow"))).toEqual(
			look(await dana.store.getCase("c_flow")),
		);
		expect(await images(again, "c_flow")).toEqual(await images(dana, "c_flow"));
	});
});

describe("operations written down, and their images", () => {
	test("taken up from the queue when the server no longer has their images: not held against the case, the same run sends them with the images", async () => {
		await shared();
		await addMark(tess, "c_flow", "Third");
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async () => {
			throw new ApiFailure("offline", "gone");
		};
		await tess.engine.request();
		tess.api.ops = ops;
		expect(
			(tess.kv.data.get(KEYS.queue) as Queue).ops.map((op) => op.type),
		).toEqual(["case.patch", "shot.create", "mark.create"]);
		// More than a day later: the server swept the images nothing named.
		const kept = new Set(
			[...server.shots.values()].map((s) => s.value.image.sha256),
		);
		for (const m of server.marks.values()) kept.add(m.value.crop.sha256);
		for (const sha of [...server.blobs.keys()])
			if (!kept.has(sha)) server.blobs.delete(sha);
		// A new worker: nothing is remembered of what was uploaded.
		const again = restarted(tess);
		await again.engine.request();
		expect(status(again)?.state).toBe("synced");
		expect(status(again)?.problems).toEqual([]);
		expect(server.marksOf("c_flow").map((m) => m.comment)).toEqual([
			"Total is cut off",
			"Pay button too pale",
			"Third",
		]);
		expect(book(again, "c_flow")?.rejected).toBeUndefined();
	});

	test("the operations and the ids they name are written in one transaction: a worker that stops there makes no mark twice", async () => {
		await shared();
		await addMark(tess, "c_flow", "Third");
		const put = tess.kv.set.bind(tess.kv);
		const writes: string[][] = [];
		let stopped = false;
		tess.kv.set = async (entries) => {
			if (stopped) throw new Error("stopped");
			writes.push(Object.keys(entries));
			await put(entries);
			// The worker is gone right after the queue is written.
			if (entries[KEYS.queue] !== undefined) stopped = true;
		};
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = (() => {
			throw new Error("stopped");
		}) as never;
		await tess.engine.request();
		tess.kv.set = put;
		tess.api.ops = ops;
		expect(writes.at(-1)?.sort()).toEqual(["case:c_flow", KEYS.queue].sort());
		expect(Object.keys(book(tess, "c_flow")?.marks ?? {})).toContain("m3");
		await sync(restarted(tess), dana);
		// One mark 3, no mark deleted and made again under 4.
		expect(
			[...server.marks.values()].map((r) => [r.value.number, r.deleted]),
		).toEqual([
			[1, false],
			[2, false],
			[3, false],
		]);
	});
});

describe("what the server refused", () => {
	test("a refusal the fetch settles goes with it: a change to a mark a teammate deleted is not said for ever", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) => withoutMark(c, "m2", now));
		await dana.engine.request();
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m2", "Tess edits the deleted mark", now),
		);
		await tess.engine.request();
		// The mark is gone here too, and there is nothing left to say.
		expect(
			(await tess.store.getCase("c_flow"))?.marks.map((a) => a.id),
		).toEqual(["m1"]);
		await tess.engine.request();
		expect(status(tess)?.problems).toEqual([]);
		expect(status(tess)?.state).toBe("synced");
		expect(book(tess, "c_flow")?.rejected).toBeUndefined();
	});

	test("more refusals than are kept: sending for that case stops and says so, instead of sending them again in turns", async () => {
		await signIn(tess);
		await startCase(tess, "c_many");
		await addMark(tess, "c_many", "The first");
		await tess.engine.request();
		for (let i = 0; i < 60; i++) await addMark(tess, "c_many", `Mark ${i}`);
		// A server that takes no further mark of this case.
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async (team, list) => {
			const answer = await ops(
				team,
				list.filter((op) => op.type !== "mark.create"),
			);
			return {
				...answer,
				results: list.map(
					(op) =>
						answer.results?.find((r) => r.opId === op.opId) ?? {
							opId: op.opId,
							status: "rejected" as const,
							error: { code: "limit" as const, message: "No more marks." },
						},
				),
			};
		};
		await tess.engine.request();
		expect(book(tess, "c_many")?.rejected).toHaveLength(50);
		for (let run = 0; run < 3; run++) {
			tess.api.calls.length = 0;
			await tess.engine.request();
			expect(posts(tess)).toEqual([]);
		}
		expect(status(tess)?.problems.map((p) => p.text)).toContainEqual(
			expect.stringContaining("50 changes to this case were not taken"),
		);
	});
});

describe("what a run costs", () => {
	/** Count what a run reads. */
	function counted(d: Device<FakeApi>) {
		const count = { images: 0, hashed: 0, lists: 0, all: 0 };
		const getImage = d.store.getImage.bind(d.store);
		d.store.getImage = async (a, b) => {
			count.images++;
			return getImage(a, b);
		};
		const list = d.store.listCases.bind(d.store);
		d.store.listCases = async () => {
			count.lists++;
			return list();
		};
		const all = d.kv.all.bind(d.kv);
		d.kv.all = async () => {
			count.all++;
			return all();
		};
		const digest = crypto.subtle.digest.bind(crypto.subtle);
		crypto.subtle.digest = (async (algorithm: never, data: never) => {
			count.hashed++;
			return digest(algorithm, data);
		}) as never;
		const zero = () => {
			count.images = count.hashed = count.lists = count.all = 0;
			d.api.calls.length = 0;
		};
		return {
			count,
			zero,
			done: () => {
				crypto.subtle.digest = digest;
			},
		};
	}

	test("cases the role may not send: no image is read or hashed, at the first run or any later, and it stays said", async () => {
		await signIn(tess);
		tess.api.permissions = tess.api.permissions.filter(
			(p) => p !== "mark:create" && p !== "case:create",
		);
		await tess.engine.retry();
		for (let n = 0; n < 5; n++) {
			await startCase(tess, `c_${n}`);
			for (let i = 0; i < 4; i++) await addMark(tess, `c_${n}`, `Mark ${i}`);
		}
		const { count, zero, done } = counted(tess);
		try {
			for (let run = 0; run < 3; run++) {
				zero();
				await tess.engine.request();
				expect([count.images, count.hashed]).toEqual([0, 0]);
				expect(
					tess.api.calls.filter((c) => !c.startsWith("GET changes")),
				).toEqual([]);
				expect(status(tess)?.problems).toHaveLength(5);
				expect(status(tess)?.problems[0]?.text).toContain(
					"Your role in “Pedal & Pine web” does not allow",
				);
			}
			// The role allows it again: a reason to look once more.
			tess.api.permissions = [
				...tess.api.permissions,
				"mark:create",
				"case:create",
			];
			await tess.engine.retry();
			expect(server.cases.size).toBe(5);
			expect(status(tess)?.problems).toEqual([]);
		} finally {
			done();
		}
	});

	test("a run with nothing to do reads the cases once and the sync's database once; a first sync of thirty cases does not read them thirty times", async () => {
		await signIn(tess);
		for (let n = 0; n < 30; n++) {
			await startCase(tess, `c_${n}`);
			await addMark(tess, `c_${n}`, "Mark");
		}
		const { count, zero, done } = counted(tess);
		try {
			zero();
			await tess.engine.request();
			expect(server.cases.size).toBe(30);
			// (Before: the cases 33 times, the database 35 times.)
			expect(count.lists).toBeLessThan(6);
			expect(count.all).toBeLessThan(10);
			// (The run after it fetches what it sent itself; then there is nothing.)
			await tess.engine.request();
			zero();
			await tess.engine.request();
			expect([count.lists, count.all, count.images, count.hashed]).toEqual([
				1, 1, 0, 0,
			]);
		} finally {
			done();
		}
	});

	test("a case the server refuses whole, in a worker that starts anew: nothing is read, hashed, asked or uploaded for it again", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_big");
		for (let i = 0; i < 10; i++) await addMark(tess, "c_big", `Mark ${i}`);
		await sync(tess, dana);
		// Dana keeps hers, the team deletes the case, and Dana shares hers
		// again: the id is taken (open question 10b).
		await dana.engine.signOut();
		await removeCase(tess, "c_big");
		await tess.engine.request();
		await signIn(dana);
		await dana.engine.share("c_big");
		await dana.engine.request();
		expect(
			status(dana)
				?.problems.map((p) => p.text)
				.join(" "),
		).toContain("The case's id is taken");
		server.blobs.clear();
		for (let start = 0; start < 2; start++) {
			const again = restarted(dana);
			const { count, done } = counted(again);
			again.api.calls.length = 0;
			try {
				await again.engine.request();
				expect([count.images, count.hashed]).toEqual([0, 0]);
				expect(
					again.api.calls.filter((c) => !c.startsWith("GET changes")),
				).toEqual([]);
				expect(status(again)?.state).toBe("problem");
			} finally {
				done();
			}
		}
	});
});

describe("every run keeps to the API's contract", () => {
	const good: Op = {
		opId: "o_1",
		type: "case.patch",
		caseId: "c_1",
		title: "A title",
	};
	// The operations are built in the test: a row is formatted for its title
	// and the reporter, and a 50,000-character summary must not be.
	test.each([
		["a good operation", undefined, () => [good]],
		[
			"a title over 500 characters",
			400,
			() => [{ ...good, title: "t".repeat(501) }],
		],
		["a field of another type", 400, () => [{ ...good, title: 7 }]],
		[
			"an operation the API does not have",
			400,
			() => [{ ...good, type: "case.rename" }],
		],
		[
			"a capturedAt that is no UTC time",
			400,
			() => [
				{
					opId: "o_2",
					type: "shot.create",
					caseId: "c_1",
					shot: {
						id: "sh_1",
						url: "https://shop.example/",
						image: { sha256: "a".repeat(64), width: 1, height: 1, bytes: 1 },
						scrollX: 0,
						scrollY: 0,
						viewport: { width: 1, height: 1, dpr: 1 },
						capturedAt: "yesterday",
					},
				},
			],
		],
		// 500 characters are 500 characters, also when each is two code units.
		[
			"500 emoji in a title",
			undefined,
			() => [{ ...good, title: "😀".repeat(500) }],
		],
		["201 operations", 400, () => Array.from({ length: 201 }, () => good)],
		[
			"a summary of 50,000 characters",
			undefined,
			() => [{ ...good, summary: "s".repeat(50_000) }],
		],
		[
			"a request over the size one may hold",
			413,
			() =>
				Array.from({ length: 200 }, (_, i) => ({
					...good,
					opId: `o_${i}`,
					summary: "s".repeat(50_000),
				})),
		],
	] as const)(
		"the server in memory keeps to the API's schemas: %s gives %p",
		(_what, status, ops) => {
			expect(requestProblem(ops() as never)?.status).toBe(status);
		},
	);

	test("a request the server refuses whole is found out one operation at a time: the one it does not take is said, the others go", async () => {
		await shared();
		await addMark(tess, "c_flow", "A good one");
		await addMark(tess, "c_flow", "One this server does not take");
		// A server whose contract is narrower in something (a later one's
		// rule, a proxy's): the request with that mark is refused whole.
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async (team, list) => {
			if (
				list.some(
					(op) =>
						op.type === "mark.create" &&
						op.mark.comment === "One this server does not take",
				)
			)
				throw new ApiFailure(
					"refused",
					"The request is not one the API takes.",
					400,
					"invalid",
				);
			return ops(team, list);
		};
		await tess.engine.request();
		expect(server.marksOf("c_flow").map((m) => m.comment)).toEqual([
			"Total is cut off",
			"Pay button too pale",
			"A good one",
		]);
		expect(status(tess)?.state).toBe("problem");
		expect(status(tess)?.problems.map((p) => p.text)).toEqual([
			expect.stringContaining("Mark 4 was not taken"),
		]);
		// Not asked again at every run.
		tess.api.calls.length = 0;
		await tess.engine.request();
		expect(posts(tess)).toEqual([]);
	});
});

describe("a case the team already has", () => {
	/** Dana gets Tess's case as a file: the same id, the same marks, the same images. */
	async function fromFile(id: string): Promise<void> {
		const copy = (await tess.store.getCase(id)) as Case;
		const files = new Map<string, StoredImage>();
		for (const path of [
			...copy.shots.map((s) => s.image),
			...copy.marks.map((a) => a.crop),
		]) {
			const image = await tess.store.getImage(id, path);
			if (image !== undefined) files.set(path, image);
		}
		await dana.store.replaceCase(structuredClone(copy), files);
	}
	const numbered = (id: string) =>
		server.marksOf(id).map((m) => [m.number, m.comment]);
	async function tessShares(): Promise<void> {
		await signIn(tess);
		await startCase(tess, "c_file");
		await addMark(tess, "c_file", "One", { element: true });
		await addMark(tess, "c_file", "Two");
		await tess.engine.request();
	}

	test("imported on a synced device before it fetched: the fetch comes first, the marks are the same marks, none is made twice", async () => {
		await signIn(dana);
		await tessShares();
		await fromFile("c_file");
		await sync(dana, tess);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
		]);
		expect(look(await dana.store.getCase("c_file"))).toEqual(
			look(await tess.store.getCase("c_file")),
		);
		expect(status(dana)?.state).toBe("synced");
	});

	test("the fetch did not bring it (it was read before): the case goes alone, the server says it has it, nothing else is sent, and the two are joined", async () => {
		await signIn(dana);
		await tessShares();
		// Dana's device has read past the case, and does not have it (it was
		// deleted here unsent, say; here: the book is simply gone).
		await dana.engine.request();
		await dana.store.deleteCase("c_file");
		await dana.kv.remove("case:c_file");
		await fromFile("c_file");
		// Her own words on mark 2, and a mark only she has.
		await change(dana, "c_file", (c, now) =>
			withComment(c, "m2", "Dana's words", now),
		);
		await addMark(dana, "c_file", "Only Dana's", { url: PAY });
		const sent: Op[] = [];
		const ops = dana.api.ops.bind(dana.api);
		dana.api.ops = async (team, list) => {
			sent.push(...list);
			return ops(team, list);
		};
		dana.api.calls.length = 0;
		await dana.engine.request();
		// The case alone; then a read of the case. Mark 2 says something
		// else here, and nobody was told: nothing more is sent, and it is asked.
		expect(sent.map((op) => op.type)).toEqual(["case.create"]);
		expect(dana.api.calls).toContain("GET case c_file");
		expect(status(dana)?.joins).toEqual({ cases: 1, marks: 1 });
		expect((await dana.store.getCase("c_file"))?.marks[1]?.comment).toBe(
			"Dana's words",
		);
		// Yes: then only what the team lacks goes.
		await dana.engine.decide(true);
		expect(
			sent.filter((op) => op.type === "mark.create").map((op) => op.type),
		).toHaveLength(1);
		await sync(dana, tess);
		// The team's two marks once, the team's words where both had some, and
		// Dana's own mark as a new one.
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
			[3, "Only Dana's"],
		]);
		expect(look(await dana.store.getCase("c_file"))).toEqual(
			look(await tess.store.getCase("c_file")),
		);
		expect(status(dana)?.state).toBe("synced");
	});

	test("not asked about yet, and the first fetch fails: “Sync them” sends nothing twice", async () => {
		await tessShares();
		await fromFile("c_file");
		const changes = dana.api.changes.bind(dana.api);
		dana.api.changes = async () => {
			throw new ApiFailure("offline", "gone");
		};
		await signIn(dana);
		expect(status(dana)?.state).toBe("offline");
		expect(status(dana)?.undecided).toBe(1);
		dana.api.changes = changes;
		await dana.engine.decide(true);
		await sync(dana, tess);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
		]);
	});

	test("kept back, with other words on a mark the team has too: the question says how many marks the team's text replaces, and sharing does that and nothing else", async () => {
		await tessShares();
		await fromFile("c_file");
		await change(dana, "c_file", (c, now) =>
			withComment(c, "m1", "Dana's newer words", now),
		);
		await addMark(dana, "c_file", "Dana's own third");
		await signIn(dana);
		// Before any answer: nothing taken, nothing sent, and the banner's
		// question can say what "Sync them" would replace.
		expect(tess.kv.data.get(KEYS.modes)).toEqual({ c_file: "synced" });
		expect(dana.kv.data.get(KEYS.modes)).toEqual({ c_file: "undecided" });
		expect(status(dana)?.joins).toEqual({ cases: 1, marks: 1 });
		expect(
			(await dana.store.getCase("c_file"))?.marks.map((a) => a.comment),
		).toEqual(["Dana's newer words", "Two", "Dana's own third"]);
		expect(numbered("c_file")).toHaveLength(2);
		// "Keep them on this device": still nothing, and it stays said.
		await dana.engine.decide(false);
		await dana.engine.request();
		expect(numbered("c_file")).toHaveLength(2);
		expect(status(dana)?.joins).toBeUndefined();
		expect(status(dana)?.state).toBe("synced");
		expect(status(dana)?.problems).toEqual([]);
		expect(status(dana)?.notes?.map((p) => p.text)).toEqual([
			expect.stringContaining("the team's text is kept: 1 mark"),
		]);
		// Shared, having been told: the team's text on mark 1, her mark sent.
		await dana.engine.share("c_file");
		await sync(dana, tess);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
			[3, "Dana's own third"],
		]);
		expect(
			(await dana.store.getCase("c_file"))?.marks.map((a) => a.comment),
		).toEqual(["One", "Two", "Dana's own third"]);
		expect(status(dana)?.problems).toEqual([]);
	});

	test("a join nobody was told about does not replace text: it stops and asks with the count; with nothing to replace it goes through", async () => {
		await tessShares();
		await fromFile("c_file");
		await change(dana, "c_file", (c, now) =>
			withComment(c, "m1", "Dana's newer words", now),
		);
		await addMark(dana, "c_file", "Dana's own third");
		// The first fetch fails, so the question has no count; she says yes.
		const changes = dana.api.changes.bind(dana.api);
		dana.api.changes = async () => {
			throw new ApiFailure("offline", "gone");
		};
		await signIn(dana);
		expect(status(dana)?.undecided).toBe(1);
		expect(status(dana)?.joins).toBeUndefined();
		dana.api.changes = changes;
		await dana.engine.decide(true);
		await dana.engine.request();
		// The team has the case, and mark 1 says something else here: not
		// replaced, not sent; asked again, now with what it would replace.
		expect(
			(await dana.store.getCase("c_file"))?.marks.map((a) => a.comment),
		).toEqual(["Dana's newer words", "Two", "Dana's own third"]);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
		]);
		expect(dana.kv.data.get(KEYS.modes)).toEqual({ c_file: "undecided" });
		expect(status(dana)?.undecided).toBe(1);
		expect(status(dana)?.joins).toEqual({ cases: 1, marks: 1 });
		// Told, and yes: the team's text on mark 1, her mark sent.
		await dana.engine.decide(true);
		await sync(dana, tess);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
			[3, "Dana's own third"],
		]);
		expect(
			(await dana.store.getCase("c_file"))?.marks.map((a) => a.comment),
		).toEqual(["One", "Two", "Dana's own third"]);
		expect(status(dana)?.state).toBe("synced");
	});

	test("a join the user was told about stays one when its read fails: not asked a second time", async () => {
		await tessShares();
		await fromFile("c_file");
		await change(dana, "c_file", (c, now) =>
			withComment(c, "m1", "Dana's newer words", now),
		);
		await addMark(dana, "c_file", "Dana's own third");
		await signIn(dana);
		expect(status(dana)?.joins).toEqual({ cases: 1, marks: 1 });
		// "Sync them", told what it replaces; the first read is too large.
		const getCase = dana.api.getCase.bind(dana.api);
		let tooLarge = 1;
		dana.api.getCase = async (team, caseId) => {
			if (tooLarge-- > 0)
				throw new ApiFailure("server", "Too large.", 200, TOO_LARGE);
			return getCase(team, caseId);
		};
		await dana.engine.decide(true);
		await dana.engine.request();
		expect(book(dana, "c_file")?.reread).toMatchObject({
			why: "join",
			told: true,
		});
		// The read works later: joined, and nobody is asked again.
		dana.clock.now = new Date(dana.clock.now.getTime() + 24 * 3600_000);
		await sync(dana, tess);
		expect(dana.kv.data.get(KEYS.modes)).toEqual({ c_file: "synced" });
		expect(status(dana)?.undecided).toBe(0);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
			[3, "Dana's own third"],
		]);
	});

	test("the same for a file imported on a synced device: other words on a mark the team has are asked about, not replaced", async () => {
		await signIn(dana);
		await tessShares();
		await fromFile("c_file");
		await change(dana, "c_file", (c, now) =>
			withComment(c, "m2", "Dana's words in the file", now),
		);
		await dana.engine.request();
		expect(
			(await dana.store.getCase("c_file"))?.marks.map((a) => a.comment),
		).toEqual(["One", "Dana's words in the file"]);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
		]);
		expect(status(dana)?.joins).toEqual({ cases: 1, marks: 1 });
		// "Keep it on this device": hers stay hers, and it is a note.
		await dana.engine.decide(false);
		await dana.engine.request();
		expect(dana.kv.data.get(KEYS.modes)).toEqual({ c_file: "local" });
		expect(status(dana)?.notes?.[0]?.text).toContain(
			"where both differ the team's text is kept: 1 mark",
		);
		expect(numbered("c_file")).toEqual([
			[1, "One"],
			[2, "Two"],
		]);
	});

	test("this device's own new case whose answer was lost, and the record of the request too: the server's empty case is found, and everything here is sent once", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_mine");
		await addMark(tess, "c_mine", "One");
		tess.api.loseReplies = 1;
		await tess.engine.request();
		expect(server.cases.has("c_mine")).toBe(true);
		// The queue is lost with the answer (the browser's storage was reset
		// to before it, say): the same case is made under a new request.
		await tess.kv.remove(KEYS.queue);
		await sync(tess, dana);
		expect(numbered("c_mine")).toEqual([[1, "One"]]);
		expect(status(tess)?.state).toBe("synced");
		expect((await dana.store.getCase("c_mine"))?.marks).toHaveLength(1);
	});
});

describe("a change of the team's that cannot be stored", () => {
	const numbered = async (d: Device) =>
		look(await d.store.getCase("c_flow"))?.marks.map((m) => [
			m.number,
			m.comment,
		]);
	/** The next write of a case here fails, once: no room, a closed database. */
	function failOnce(d: Device): () => void {
		const update = d.store.updateCase.bind(d.store);
		let failed = 0;
		d.store.updateCase = async (id, how) => {
			if (failed++ === 0) throw new DOMException("quota", "QuotaExceededError");
			return update(id, how);
		};
		return () => {
			d.store.updateCase = update;
		};
	}

	test("the cursor goes on, the case does not: it is marked to be read again, the problem stays, and a minute later it arrives", async () => {
		await shared();
		await change(dana, "c_flow", (c, now) =>
			withComment(c, "m1", "Dana's words", now),
		);
		await addMark(dana, "c_flow", "Dana's third");
		await dana.engine.request();
		const restore = failOnce(tess);
		await tess.engine.request();
		restore();
		expect(tess.kv.data.get(KEYS.cursor)).toBe(server.seq);
		const said = [
			{
				caseId: "c_flow",
				title: "Your cart",
				text: expect.stringContaining("could not be stored here: quota"),
			},
		];
		expect(status(tess)?.state).toBe("problem");
		expect(status(tess)?.problems).toEqual(said);
		// The ids written down for the marks that were not stored are taken back.
		expect(Object.keys(book(tess, "c_flow")?.marks ?? {})).toEqual([
			"m1",
			"m2",
		]);
		expect(book(tess, "c_flow")?.announced).toBeUndefined();
		// Run after run it stays said, and nothing is fetched for it yet.
		tess.api.calls.length = 0;
		for (let i = 0; i < 3; i++) await tess.engine.request();
		expect(status(tess)?.problems).toEqual(said);
		expect(tess.api.calls.filter((c) => c.startsWith("GET case"))).toEqual([]);
		// A minute later the case is read by itself, and all of it is here.
		tess.clock.now = new Date(tess.clock.now.getTime() + 61_000);
		await tess.engine.request();
		expect(tess.api.calls).toContain("GET case c_flow");
		expect(await numbered(tess)).toEqual([
			[1, "Dana's words"],
			[2, "Pay button too pale"],
			[3, "Dana's third"],
		]);
		expect(status(tess)?.state).toBe("synced");
		expect(status(tess)?.problems).toEqual([]);
		expect(book(tess, "c_flow")?.reread).toBeUndefined();
	});

	const strandings: [string, () => Promise<Device<FakeApi>>][] = [
		[
			"the store fails once",
			async () => {
				const restore = failOnce(tess);
				await tess.engine.request();
				restore();
				return tess;
			},
		],
		[
			"the worker stops between the ids and the case",
			async () => {
				// Tess's worker writes the ids down and is stopped before the case.
				const update = tess.store.updateCase.bind(tess.store);
				tess.store.updateCase = () => new Promise(() => undefined);
				void tess.engine.request();
				await until(() => book(tess, "c_flow")?.announced !== undefined);
				const stopped = structuredClone(book(tess, "c_flow")) as CaseBook;
				expect(Object.keys(stopped.announced?.marks ?? {})).toEqual(["m3"]);
				// A new worker, with the book as the stopped one left it.
				const again = device("tess", server.api(TESS));
				for (const [key, value] of tess.kv.data) again.kv.data.set(key, value);
				again.kv.data.set("case:c_flow", stopped);
				for (const [key, value] of tess.store.cases)
					again.store.cases.set(key, value);
				for (const [key, value] of tess.store.images)
					again.store.images.set(key, value);
				tess.store.updateCase = update;
				return again;
			},
		],
	];
	for (const [what, strand] of strandings)
		test(`a mark made here meanwhile under the number the team's mark has is not taken for the team's: ${what}`, async () => {
			await shared();
			await addMark(dana, "c_flow", "Dana's third");
			await dana.engine.request();
			const here = await strand();
			// Tess's own next mark gets the id here that Dana's would have had.
			const own = await addMark(here, "c_flow", "Tess's own third");
			const theirs = server
				.marksOf("c_flow")
				.find((m) => m.comment === "Dana's third");
			expect(own.id).toBe("m3");
			here.clock.now = new Date(here.clock.now.getTime() + 61_000);
			await sync(here, dana);
			await sync(here, dana);
			// Both marks are there, each its own, on every device and at the server.
			const all = server
				.marksOf("c_flow")
				.map((m) => [m.comment, m.createdBy?.name]);
			expect(all).toContainEqual(["Dana's third", "Dana Developer"]);
			expect(all).toContainEqual(["Tess's own third", "Tess Tester"]);
			expect(all).toHaveLength(4);
			expect(
				server.marksOf("c_flow").find((m) => m.id === theirs?.id)?.comment,
			).toBe("Dana's third");
			expect(look(await here.store.getCase("c_flow"))).toEqual(
				look(await dana.store.getCase("c_flow")),
			);
			expect(await images(here, "c_flow")).toEqual(
				await images(dana, "c_flow"),
			);
			expect(status(here)?.state).toBe("synced");
		});

	test("an image the server cannot give is that case's matter: the other cases arrive, the cursor is written, the membership is not doubted", async () => {
		await shared();
		await startCase(tess, "c_a");
		await addMark(tess, "c_a", "A");
		await tess.engine.request();
		// The server lost the image of that case's screenshot.
		const sha = server.shotsOf("c_a")[0]?.image.sha256 as string;
		server.blobs.delete(sha);
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Tess's newer words", now),
		);
		await tess.engine.request();
		const checked = (dana.kv.data.get(KEYS.account) as Account).checkedAt;
		await dana.engine.request();
		expect(dana.kv.data.get(KEYS.cursor)).toBe(server.seq);
		expect(look(await dana.store.getCase("c_flow"))?.marks[0]?.comment).toBe(
			"Tess's newer words",
		);
		expect(status(dana)?.state).toBe("problem");
		expect(status(dana)?.text).toBeUndefined();
		expect(status(dana)?.problems.map((p) => [p.caseId, p.text])).toEqual([
			["c_a", expect.stringContaining("is not the image named")],
		]);
		expect((dana.kv.data.get(KEYS.account) as Account).checkedAt).toBe(checked);
	});
});

describe("a book taken up again", () => {
	test("a mark deleted while signed out is not deleted for the team: it is back, and that is said once", async () => {
		await shared();
		await tess.engine.signOut();
		expect(tess.kv.data.get(KEYS.modes)).toEqual({ c_flow: "local" });
		// While not syncing: one mark deleted, one edited, one added.
		await change(tess, "c_flow", (c, now) => withoutMark(c, "m2", now));
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Edited while signed out", now),
		);
		await addMark(tess, "c_flow", "Added while signed out");
		const sent: Op[] = [];
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async (team, list) => {
			sent.push(...list);
			return ops(team, list);
		};
		await signIn(tess);
		// A note, not a problem: nothing went wrong and nothing is to be done.
		expect(status(tess)?.notes).toEqual([
			{
				caseId: "c_flow",
				title: "Your cart",
				text: expect.stringContaining(
					"1 mark deleted while not syncing is back",
				),
			},
		]);
		expect(status(tess)?.problems).toEqual([]);
		expect(status(tess)?.state).toBe("synced");
		await sync(tess, dana);
		// No delete was sent; the edit and the new mark were.
		expect(sent.filter((op) => op.type.endsWith(".delete"))).toEqual([]);
		expect(server.marksOf("c_flow").map((m) => m.comment)).toEqual([
			"Edited while signed out",
			"Pay button too pale",
			"Added while signed out",
		]);
		expect(look(await tess.store.getCase("c_flow"))).toEqual(
			look(await dana.store.getCase("c_flow")),
		);
		// Said once: the next run has nothing to say.
		expect(status(tess)?.notes).toBeUndefined();
		expect(status(tess)?.problems).toEqual([]);
		expect(status(tess)?.state).toBe("synced");
		// From here on a delete is a delete again.
		await change(tess, "c_flow", (c, now) => withoutMark(c, "m2", now));
		await sync(tess, dana);
		expect(server.marksOf("c_flow").map((m) => m.comment)).toEqual([
			"Edited while signed out",
			"Added while signed out",
		]);
	});
});

describe("a delete for the team is the user's delete", () => {
	test("the cases' database is lost and the sync's is not: nothing is deleted for the team, and the cases are read again", async () => {
		await signIn(tess);
		await signIn(dana);
		for (let n = 0; n < 5; n++) {
			await startCase(tess, `c_${n}`);
			await addMark(tess, `c_${n}`, "A mark");
		}
		await sync(tess, dana);
		// The database of the cases is empty (made anew after a corruption).
		tess.store.cases.clear();
		tess.store.images.clear();
		tess.api.calls.length = 0;
		await tess.engine.request();
		expect(posts(tess)).toEqual([]);
		expect([...server.cases.values()].filter((r) => !r.deleted)).toHaveLength(
			5,
		);
		expect(await tess.store.listCases()).toHaveLength(5);
		expect(Object.values(await images(tess, "c_3"))).not.toContain("MISSING");
		expect(status(tess)?.state).toBe("synced");
		// Said once, as a note: nothing went wrong that the user could mend.
		expect(status(tess)?.notes?.map((n) => n.text)).toContainEqual(
			expect.stringContaining("was no longer on this device"),
		);
		await tess.engine.request();
		expect(status(tess)?.notes).toBeUndefined();
		await dana.engine.request();
		expect(await dana.store.listCases()).toHaveLength(5);
	});

	test("the user's delete is on record in the store, with the delete itself: it waits for no run, needs no message, and has no time limit", async () => {
		await shared();
		await startCase(tess, "c_slow");
		await addMark(tess, "c_slow", "Takes long to send");
		// A run is under way and stuck in an upload.
		const put = tess.api.putBlob.bind(tess.api);
		let release: () => void = () => undefined;
		const held = new Promise<void>((done) => {
			release = done;
		});
		let reached = false;
		tess.api.putBlob = async (team, sha, image) => {
			reached = true;
			await held;
			return put(team, sha, image);
		};
		const running = tess.engine.request();
		await until(() => reached);
		// The user deletes a case meanwhile: done at once, whatever the engine does.
		const started = performance.now();
		await tess.store.deleteCase("c_flow");
		expect(performance.now() - started).toBeLessThan(100);
		expect(await tess.store.getCase("c_flow")).toBeUndefined();
		expect((await tess.store.deletedCases()).map((r) => r.id)).toEqual([
			"c_flow",
		]);
		// Hours later the run ends, and a new worker takes it up: deleted
		// for the team, because the user deleted it.
		tess.clock.now = new Date(tess.clock.now.getTime() + 5 * 3600_000);
		release();
		await running;
		tess.api.putBlob = put;
		await sync(restarted(tess), dana);
		expect(server.caseOf("c_flow")).toBeUndefined();
		expect(await dana.store.getCase("c_flow")).toBeUndefined();
	});

	test("a record is taken up once and leaves; one nobody needs leaves too", async () => {
		await shared();
		await removeCase(tess, "c_flow");
		await sync(tess, dana);
		expect(server.caseOf("c_flow")).toBeUndefined();
		expect(await tess.store.deletedCases()).toEqual([]);
		// A case that never synced, deleted: no book could need its record.
		await startCase(tess, "c_empty");
		await tess.store.deleteCase("c_empty");
		expect(await tess.store.deletedCases()).toHaveLength(1);
		await tess.engine.request();
		expect(await tess.store.deletedCases()).toEqual([]);
	});

	test("deleted while signed out, back at the sign-in, and then lost: the old delete is not a delete for the team", async () => {
		await shared();
		await tess.engine.signOut();
		await tess.store.deleteCase("c_flow");
		await signIn(tess);
		await sync(tess, dana);
		// Back (DEC-041), whole, and its record went with the case's return.
		expect((await tess.store.getCase("c_flow"))?.marks).toHaveLength(2);
		expect(server.caseOf("c_flow")).toBeDefined();
		expect(await tess.store.deletedCases()).toEqual([]);
		// Now the database is lost.
		tess.store.cases.clear();
		tess.store.images.clear();
		await sync(tess, dana);
		expect(server.caseOf("c_flow")).toBeDefined();
		expect(await tess.store.getCase("c_flow")).toBeDefined();
		// And a delete while signed in is one again.
		await removeCase(tess, "c_flow");
		await sync(tess, dana);
		expect(server.caseOf("c_flow")).toBeUndefined();
	});

	/** How a case comes to wait for a read (`reread.why`), and how to end that. */
	const waiting: ["resumed" | "failed", string, () => Promise<() => void>][] = [
		[
			"resumed",
			"signed in again with no network, so the case waits to be read again",
			async () => {
				await tess.engine.signOut();
				const getCase = tess.api.getCase.bind(tess.api);
				tess.api.getCase = async () => {
					throw new ApiFailure("offline", "gone");
				};
				await signIn(tess);
				return () => {
					tess.api.getCase = getCase;
				};
			},
		],
		[
			"failed",
			"the change of the team's could not be stored, so the case waits to be read again",
			async () => {
				await addMark(dana, "c_flow", "Dana's third");
				await dana.engine.request();
				const update = tess.store.updateCase.bind(tess.store);
				let failed = 0;
				tess.store.updateCase = async (id, how) => {
					if (failed++ === 0) throw new Error("no room");
					return update(id, how);
				};
				await tess.engine.request();
				tess.store.updateCase = update;
				return () => {};
			},
		],
	];
	for (const [why, what, wait] of waiting)
		test(`a delete of a case that waits to be read again (${what}) goes at once, for the team`, async () => {
			await shared();
			const end = await wait();
			expect(book(tess, "c_flow")?.reread?.why).toBe(why);
			await removeCase(tess, "c_flow");
			end();
			tess.api.calls.length = 0;
			// At once: the next run sends it, and reads nothing first.
			await tess.engine.request();
			expect(tess.api.calls).not.toContain("GET case c_flow");
			expect(server.caseOf("c_flow")).toBeUndefined();
			await sync(tess, dana);
			expect(tess.api.calls).not.toContain("GET case c_flow");
			expect(await tess.store.getCase("c_flow")).toBeUndefined();
			expect(await dana.store.getCase("c_flow")).toBeUndefined();
			expect(await tess.store.deletedCases()).toEqual([]);
			expect(status(tess)?.problems).toEqual([]);
		});

	test("deleted while the sign-in had run out (the panel said “from this browser”): no delete for the team, the case is back after the sign-in", async () => {
		await shared();
		tess.api.unauthorized = true;
		await tess.engine.request();
		expect(((await tess.engine.account()) as Account).expired).toBe(true);
		await removeCase(tess, "c_flow");
		// An hour later she signs in again.
		tess.clock.now = new Date(tess.clock.now.getTime() + 3600_000);
		tess.api.unauthorized = false;
		await signIn(tess);
		await sync(tess, dana);
		expect(server.caseOf("c_flow")).toBeDefined();
		expect(await dana.store.getCase("c_flow")).toBeDefined();
		expect(await tess.store.getCase("c_flow")).toBeDefined();
		expect(await tess.store.deletedCases()).toEqual([]);
	});

	test("deleted while the sign-in was live, and it ran out before the delete went: the delete goes after the sign-in", async () => {
		await shared();
		await removeCase(tess, "c_flow");
		// The run that would send it finds the sign-in gone.
		tess.api.unauthorized = true;
		await tess.engine.request();
		expect(((await tess.engine.account()) as Account).expired).toBe(true);
		expect(server.caseOf("c_flow")).toBeDefined();
		tess.api.unauthorized = false;
		await signIn(tess);
		await sync(tess, dana);
		expect(server.caseOf("c_flow")).toBeUndefined();
		expect(await dana.store.getCase("c_flow")).toBeUndefined();
	});

	test("deleted while its first push is under way: the delete is not forgotten, and goes for the team", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_new");
		await addMark(tess, "c_new", "Made and gone");
		// The user deletes it right after the server took the new case.
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async (team, list, ...rest) => {
			const answer = await ops(team, list, ...rest);
			if (list.some((op) => op.type === "case.create"))
				await removeCase(tess, "c_new");
			return answer;
		};
		await tess.engine.request();
		tess.api.ops = ops;
		await sync(tess, dana);
		expect(await tess.store.getCase("c_new")).toBeUndefined();
		expect(server.caseOf("c_new")).toBeUndefined();
		expect(await dana.store.getCase("c_new")).toBeUndefined();
	});
});

describe("a cursor of 0", () => {
	test("is a revision like any other: an empty team is not read whole at every run, and says nothing", async () => {
		await signIn(tess);
		expect(tess.kv.data.get(KEYS.cursor)).toBe(0);
		const list = tess.store.listCases.bind(tess.store);
		let lists = 0;
		tess.store.listCases = async () => {
			lists++;
			return list();
		};
		tess.statuses.length = 0;
		tess.api.calls.length = 0;
		for (let run = 0; run < 3; run++) await tess.engine.request();
		expect(tess.api.calls).toEqual([
			"GET changes 0",
			"GET changes 0",
			"GET changes 0",
		]);
		expect(tess.statuses.map((s) => s.state)).not.toContain("syncing");
		expect(lists).toBe(3);
	});

	test("a first push leaves it at 0, and a teammate's delete after that is told: of a mark, and of the whole case", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_zero");
		await addMark(tess, "c_zero", "One");
		await addMark(tess, "c_zero", "Two");
		// Tess's run fetches (nothing: the cursor is 0) and then sends them.
		await tess.engine.request();
		expect(tess.kv.data.get(KEYS.cursor)).toBe(0);
		expect(server.marksOf("c_zero")).toHaveLength(2);
		await dana.engine.request();
		await change(dana, "c_zero", (c, now) => withoutMark(c, "m2", now));
		await dana.engine.request();
		await tess.engine.request();
		expect(
			look(await tess.store.getCase("c_zero"))?.marks.map((m) => m.comment),
		).toEqual(["One"]);
		// A second case, sent with the cursor still behind; the teammate
		// deletes it whole: it goes here too, it is not kept as "local".
		await startCase(tess, "c_gone");
		await addMark(tess, "c_gone", "Short-lived");
		tess.kv.data.set(KEYS.cursor, 0);
		await tess.engine.request();
		await dana.engine.request();
		await removeCase(dana, "c_gone");
		await dana.engine.request();
		tess.kv.data.set(KEYS.cursor, 0);
		await tess.engine.request();
		expect(await tess.store.getCase("c_gone")).toBeUndefined();
		expect(status(tess)?.problems).toEqual([]);
	});
});

describe("the pages of a synced case are the server's (DEC-039)", () => {
	const LOCAL_PAY = "http://localhost:3000/checkout/pay/";

	test("a page is added by its first screenshot, with its title; no patch ever names the pages", async () => {
		const sent: Op[] = [];
		for (const d of [tess, dana]) {
			const ops = d.api.ops.bind(d.api);
			d.api.ops = async (team, list) => {
				sent.push(...list);
				return ops(team, list);
			};
		}
		await shared();
		expect(server.caseOf("c_flow")?.pages).toEqual([
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		]);
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.pages).toEqual([
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		]);
		// The same page on localhost is no second page, here or there.
		await addMark(dana, "c_flow", "On my machine too", {
			url: LOCAL_PAY,
			title: "Payment (dev)",
		});
		// A third page, then its mark goes again: the page comes and leaves.
		const done = await addMark(dana, "c_flow", "Thanks page", {
			url: "https://shop.example/done",
			title: "Thank you",
		});
		await sync(dana, tess);
		expect(server.caseOf("c_flow")?.pages.map((p) => p.url)).toEqual([
			CART,
			PAY,
			"https://shop.example/done",
		]);
		expect(look(await tess.store.getCase("c_flow"))?.pages).toEqual([
			CART,
			PAY,
			"https://shop.example/done",
		]);
		expect(
			(await tess.store.getCase("c_flow"))?.pages?.find(
				(p) => p.url === "https://shop.example/done",
			)?.title,
		).toBe("Thank you");
		await change(dana, "c_flow", (c, now) => withoutMark(c, done.id, now));
		await sync(dana, tess);
		expect(server.caseOf("c_flow")?.pages.map((p) => p.url)).toEqual([
			CART,
			PAY,
		]);
		expect(look(await tess.store.getCase("c_flow"))?.pages).toEqual([
			CART,
			PAY,
		]);
		// All of that without one patch of the list, and no list in a new case.
		expect(sent.length).toBeGreaterThan(5);
		for (const op of sent) {
			if (op.type === "case.patch") expect(op.pages).toBeUndefined();
			if (op.type === "case.create") expect(op.case.pages).toBeUndefined();
		}
		expect(look(await dana.store.getCase("c_flow"))).toEqual(
			look(await tess.store.getCase("c_flow")),
		);
	});

	test("page is the first page of the server's list, with the window of that page's first screenshot", async () => {
		await shared();
		const mine = (await tess.store.getCase("c_flow")) as Case;
		const pay = mine.shots.find((s) => s.url === PAY);
		expect(mine.page.url).toBe(CART);
		// Someone changes the list at the server (the web app): the payment
		// page is first now.
		const pages = [...(server.caseOf("c_flow")?.pages ?? [])].reverse();
		server
			.api(DANA)
			.ops(TEAM, [
				{ opId: "o_pages", type: "case.patch", caseId: "c_flow", pages },
			]);
		await sync(tess, dana);
		for (const d of [tess, dana]) {
			const c = (await d.store.getCase("c_flow")) as Case;
			expect(c.pages?.map((p) => p.url)).toEqual([PAY, CART]);
			expect(c.page.url).toBe(PAY);
			expect(c.page.title).toBe("Payment");
			expect(c.page.viewport).toEqual(pay?.viewport as never);
			// Every mark is still on its own page.
			expect(look(c)?.marks.map((m) => m.page)).toEqual([CART, PAY]);
		}
		// Taking the list did not make anything to send.
		tess.api.calls.length = 0;
		await sync(tess, dana);
		expect(posts(tess)).toEqual([]);
	});
});

describe("deleting", () => {
	test("a mark deleted on one device goes on the other, its screenshot with its last mark", async () => {
		await shared();
		await change(tess, "c_flow", (c, now) => withoutMark(c, "m2", now));
		await sync(tess, dana);
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.marks.map((a) => a.id)).toEqual(["m1"]);
		expect(there.shots).toHaveLength(1);
		expect(keys(dana, "c_flow")).toHaveLength(2);
		expect(server.marksOf("c_flow")).toHaveLength(1);
		expect(server.shotsOf("c_flow")).toHaveLength(1);
		// The page that lost its last mark left the case, on both.
		expect(there.pages?.map((p) => p.url)).toEqual([CART]);
		expect(look(there)).toEqual(look(await tess.store.getCase("c_flow")));
	});

	test("a case deleted on one device is deleted for the team, and goes on the other", async () => {
		await shared();
		await removeCase(tess, "c_flow");
		await tess.engine.request();
		expect(server.caseOf("c_flow")).toBeUndefined();
		expect(book(tess, "c_flow")).toBeUndefined();
		dana.changed.length = 0;
		await dana.engine.request();
		expect(await dana.store.getCase("c_flow")).toBeUndefined();
		expect(keys(dana, "c_flow")).toEqual([]);
		expect(dana.changed).toEqual(["c_flow"]);
		expect(book(dana, "c_flow")).toBeUndefined();
	});

	test("a change to a case the team deleted meanwhile is said, and the case goes", async () => {
		await shared();
		tess.api.offline = true;
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Too late", now),
		);
		await tess.engine.request();
		await removeCase(dana, "c_flow");
		await dana.engine.request();
		tess.api.offline = false;
		await tess.engine.request();
		expect(await tess.store.getCase("c_flow")).toBeUndefined();
		// Nothing left to say once it is gone.
		await tess.engine.request();
		expect(status(tess)?.state).toBe("synced");
	});

	test("a case the user may not delete for the team comes back", async () => {
		await shared();
		dana.api.permissions = dana.api.permissions.filter(
			(p) => p !== "case:delete",
		);
		await dana.engine.retry();
		await removeCase(dana, "c_flow");
		await dana.engine.request();
		expect(server.caseOf("c_flow")).toBeDefined();
		expect(look(await dana.store.getCase("c_flow"))).toEqual(
			look(await tess.store.getCase("c_flow")),
		);
		expect(await images(dana, "c_flow")).toEqual(await images(tess, "c_flow"));
	});
});

describe("what the server does not take", () => {
	test("a refusal is said in plain words and not tried for ever; Sync now tries again", async () => {
		await shared();
		server.refuseWith = {
			type: "mark.patch",
			code: "limit",
			message: "A mark holds at most 20 findings.",
		};
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Refused", now),
		);
		await tess.engine.request();
		expect(status(tess)?.state).toBe("problem");
		expect(status(tess)?.problems).toEqual([
			{
				caseId: "c_flow",
				title: "Your cart",
				text: expect.stringContaining("A mark holds at most 20 findings"),
			},
		]);
		// The change stays here, and is not sent again as it is.
		expect(look(await tess.store.getCase("c_flow"))?.marks[0]?.comment).toBe(
			"Refused",
		);
		tess.api.calls.length = 0;
		await tess.engine.request();
		await tess.engine.request();
		expect(posts(tess)).toEqual([]);
		expect(status(tess)?.problems).toHaveLength(1);
		// Other changes of the case still go.
		await change(tess, "c_flow", (c, now) => withTitle(c, "Renamed", now));
		await tess.engine.request();
		expect(server.caseOf("c_flow")?.title).toBe("Renamed");
		// The server takes it now: "Sync now" sends it again.
		server.refuseWith = undefined;
		await tess.engine.retry();
		expect(server.marksOf("c_flow")[0]?.comment).toBe("Refused");
		expect(status(tess)?.state).toBe("synced");
		expect(status(tess)?.problems).toEqual([]);
	});

	test("what the user's role does not allow is not sent, and said", async () => {
		await shared();
		dana.api.permissions = dana.api.permissions.filter(
			(p) => p !== "mark:update",
		);
		await dana.engine.retry();
		dana.api.calls.length = 0;
		await change(dana, "c_flow", (c, now) =>
			withComment(c, "m1", "Not mine to edit", now),
		);
		await dana.engine.request();
		expect(posts(dana)).toEqual([]);
		expect(status(dana)?.state).toBe("problem");
		expect(status(dana)?.problems[0]?.text).toContain(
			"does not allow a change you made here",
		);
		expect(server.marksOf("c_flow")[0]?.comment).toBe("Total is cut off");
	});

	test("an image that did not reach the server is sent again with its operation", async () => {
		await signIn(tess);
		await startCase(tess, "c_blob");
		await addMark(tess, "c_blob", "One");
		// The server says it has the images, and has not.
		const has = tess.api.hasBlob.bind(tess.api);
		tess.api.hasBlob = async () => true;
		await tess.engine.request();
		tess.api.hasBlob = has;
		expect(server.marksOf("c_blob").map((m) => m.comment)).toEqual(["One"]);
		expect(server.blobs.size).toBe(2);
		expect(status(tess)?.state).toBe("synced");
	});
});

describe("an image from the server is taken only when it is the image named", () => {
	const TEXT =
		"A mark of the team is not shown here: an image the server sent is not the image named (missing, not a WebP image, too large, or other content). It is read again later.";

	for (const [what, answer] of [
		[
			"other content under the name asked for (a redirect's target, say)",
			async () => new Blob(["ROUTER ADMIN PAGE"], { type: "image/webp" }),
		],
		[
			"the right bytes, said to be something else than a WebP image",
			async (right: Blob) =>
				new Blob([await right.arrayBuffer()], { type: "text/html" }),
		],
		[
			"an image the server does not have",
			async () => {
				throw new ApiFailure("refused", "No such image.", 404, "not_found");
			},
		],
		[
			"an answer larger than an image may be",
			async () => {
				throw new ApiFailure("server", "Too large.", 200, TOO_LARGE);
			},
		],
	] as const)
		test(`${what}: not stored, said, and the rest of the run goes on`, async () => {
			await shared();
			await addMark(tess, "c_flow", "Its crop goes wrong on the way");
			await startCase(tess, "c_next");
			await addMark(tess, "c_next", "A case after it");
			await tess.engine.request();
			const bad = server
				.marksOf("c_flow")
				.find((m) => m.comment === "Its crop goes wrong on the way");
			const sha = bad?.crop.sha256 as string;
			const get = dana.api.getBlob.bind(dana.api);
			dana.api.getBlob = async (team, asked) =>
				asked === sha ? answer(await get(team, asked)) : get(team, asked);
			await dana.engine.request();
			// The mark with the bad image is not here; everything else is.
			const there = (await dana.store.getCase("c_flow")) as Case;
			expect(there.marks.map((a) => a.comment)).toEqual([
				"Total is cut off",
				"Pay button too pale",
			]);
			expect(Object.values(await images(dana, "c_flow"))).not.toContain(
				"MISSING",
			);
			expect(
				(await dana.store.getCase("c_next"))?.marks.map((a) => a.comment),
			).toEqual(["A case after it"]);
			expect(status(dana)?.state).toBe("problem");
			expect(status(dana)?.problems).toEqual([
				{ caseId: "c_flow", title: "Your cart", text: TEXT },
			]);
			// Nothing of it went back to the server, and nothing was deleted there.
			expect(server.marksOf("c_flow")).toHaveLength(3);
			// It stays said, run after run, and the image is not asked for at
			// every one of them: the case is read again a minute later.
			dana.api.calls.length = 0;
			await dana.engine.request();
			await dana.engine.request();
			expect(status(dana)?.problems).toEqual([
				{ caseId: "c_flow", title: "Your cart", text: TEXT },
			]);
			expect(dana.api.calls.filter((c) => c.startsWith("GET blob"))).toEqual(
				[],
			);
			// The image is right again, and the minute is over: the case is
			// read by itself, and the mark is here.
			dana.api.getBlob = get;
			dana.clock.now = new Date(dana.clock.now.getTime() + 61_000);
			dana.api.calls.length = 0;
			await dana.engine.request();
			expect(dana.api.calls).toContain("GET case c_flow");
			expect(look(await dana.store.getCase("c_flow"))).toEqual(
				look(await tess.store.getCase("c_flow")),
			);
			expect(status(dana)?.state).toBe("synced");
			expect(status(dana)?.problems).toEqual([]);
		});

	test("a bad screenshot leaves out the marks on it, and only those", async () => {
		await shared();
		await addMark(tess, "c_flow", "On a new screenshot", {
			url: "https://shop.example/done",
		});
		await tess.engine.request();
		const shot = server
			.shotsOf("c_flow")
			.find((s) => s.url === "https://shop.example/done");
		const get = dana.api.getBlob.bind(dana.api);
		dana.api.getBlob = async (team, asked) =>
			asked === shot?.image.sha256
				? new Blob(["<html>"], { type: "text/html" })
				: get(team, asked);
		await dana.engine.request();
		const there = (await dana.store.getCase("c_flow")) as Case;
		expect(there.marks).toHaveLength(2);
		expect(there.shots).toHaveLength(2);
		expect(status(dana)?.problems.map((p) => p.text)).toEqual([TEXT]);
	});
});

describe("an answer larger than an answer may be", () => {
	test("a page of changes too large to read is asked for again in small pages, and all of it arrives", async () => {
		await signIn(tess);
		await signIn(dana);
		await startCase(tess, "c_big");
		// One request each: the server never splits what one request changed.
		for (let i = 1; i <= 45; i++) {
			await addMark(tess, "c_big", `Mark ${i}`);
			await tess.engine.request();
		}
		// Dana's client refuses any answer of more than 30 things as too large.
		const changes = dana.api.changes.bind(dana.api);
		const asked: (number | undefined)[] = [];
		dana.api.changes = async (team, since, limit) => {
			asked.push(limit);
			const answer = await changes(team, since, limit);
			const things =
				(answer.cases?.length ?? 0) +
				(answer.shots?.length ?? 0) +
				(answer.marks?.length ?? 0);
			if (things > 30)
				throw new ApiFailure("server", "Too large.", 200, TOO_LARGE);
			return answer;
		};
		await dana.engine.request();
		expect(asked[0]).toBeUndefined();
		expect(asked.slice(1).every((limit) => limit === SMALL_PAGE)).toBe(true);
		expect(asked.length).toBeGreaterThan(3);
		expect((await dana.store.getCase("c_big"))?.marks).toHaveLength(45);
		expect(status(dana)?.state).toBe("synced");
	});

	test("a case too large to read by itself is that case's matter: it waits, longer each time, and the run and the other cases go on", async () => {
		await signIn(tess);
		await startCase(tess, "c_big");
		await addMark(tess, "c_big", "Theirs");
		await tess.engine.request();
		// Dana has a case of that id, kept back, and shares it after all: the
		// team's copy is to be read first, and it cannot be.
		await startCase(dana, "c_big");
		await addMark(dana, "c_big", "Mine", { url: PAY });
		await signIn(dana);
		await dana.engine.decide(false);
		const getCase = dana.api.getCase.bind(dana.api);
		let reads = 0;
		dana.api.getCase = async (team, id) => {
			if (id !== "c_big") return getCase(team, id);
			reads++;
			throw new ApiFailure(
				"server",
				"The server's answer is larger than an answer may be.",
				200,
				TOO_LARGE,
			);
		};
		await dana.engine.share("c_big");
		await startCase(dana, "c_new");
		await addMark(dana, "c_new", "Made after");
		for (let i = 0; i < 6; i++) {
			dana.clock.now = new Date(dana.clock.now.getTime() + 10 * 60_000);
			await dana.engine.request();
		}
		// The new case went; the run did not end at the large one.
		expect(server.cases.has("c_new")).toBe(true);
		expect(status(dana)?.text).toBeUndefined();
		expect(status(dana)?.problems).toEqual([
			{
				caseId: "c_big",
				title: "Your cart",
				text: expect.stringContaining("larger than can be read here"),
			},
		]);
		// Asked for now and then, not at every run: 1, 5, 30 minutes, 6 hours.
		expect(reads).toBeGreaterThan(1);
		expect(reads).toBeLessThan(5);
		// Nothing of the kept case was sent meanwhile.
		expect(server.marksOf("c_big").map((m) => m.comment)).toEqual(["Theirs"]);
	});

	test("a small page that is still too large is the server's trouble: said, nothing stored, tried again later", async () => {
		await signIn(dana);
		dana.api.changes = async () => {
			throw new ApiFailure(
				"server",
				"The server's answer is larger than an answer may be.",
				200,
				TOO_LARGE,
			);
		};
		await dana.engine.request();
		expect(status(dana)?.state).toBe("problem");
		expect(status(dana)?.text).toContain("larger than an answer may be");
	});
});

describe("the team's storage", () => {
	test("full: the image is not taken, its mark not shared, said in plain words, and not uploaded again at every run", async () => {
		await signIn(tess);
		await startCase(tess, "c_full");
		await addMark(tess, "c_full", "Fits");
		await tess.engine.request();
		const put = tess.api.putBlob.bind(tess.api);
		tess.api.putBlob = async () => {
			tess.api.calls.push("PUT blob (refused)");
			throw new ApiFailure(
				"refused",
				"The team's storage is full.",
				507,
				"quota",
			);
		};
		await addMark(tess, "c_full", "Does not fit");
		await tess.engine.request();
		expect(status(tess)?.state).toBe("problem");
		expect(status(tess)?.problems).toEqual([
			{
				caseId: "c_full",
				title: "Your cart",
				text: expect.stringContaining("storage is full. 1 more of its changes"),
			},
		]);
		expect(server.marksOf("c_full").map((m) => m.comment)).toEqual(["Fits"]);
		// Not a server that is down: nothing is tried again by itself.
		tess.api.calls.length = 0;
		await tess.engine.request();
		await tess.engine.request();
		expect(tess.api.calls.filter((c) => c.startsWith("PUT"))).toEqual([]);
		// Room again, and "Sync now".
		tess.api.putBlob = put;
		await tess.engine.retry();
		expect(server.marksOf("c_full").map((m) => m.comment)).toEqual([
			"Fits",
			"Does not fit",
		]);
		expect(status(tess)?.state).toBe("synced");
	});
});

describe("a contract that has grown", () => {
	test("fields and kinds of removed things this build does not know are passed by", async () => {
		await shared();
		server.future = true;
		await change(dana, "c_flow", (c, now) =>
			withComment(c, "m1", "From the future", now),
		);
		await sync(dana, tess);
		expect(status(tess)?.state).toBe("synced");
		expect(look(await tess.store.getCase("c_flow"))?.marks[0]?.comment).toBe(
			"From the future",
		);
		// Nothing of it was stored in the case.
		expect(JSON.stringify(await tess.store.getCase("c_flow"))).not.toContain(
			"somethingNew",
		);
	});

	test("many changes come in pages, and all of them arrive", async () => {
		await signIn(tess);
		await startCase(tess, "c_many");
		// Each in a revision of its own: a page never splits one.
		for (let i = 1; i <= 7; i++) {
			await addMark(tess, "c_many", `Mark ${i}`);
			await tess.engine.request();
		}
		server.pageSize = 3;
		await signIn(dana);
		expect(
			dana.api.calls.filter((c) => c.startsWith("GET changes")).length,
		).toBeGreaterThan(2);
		expect(
			look(await dana.store.getCase("c_many"))?.marks.map((m) => m.comment),
		).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => `Mark ${i}`));
		// Not a whole state now: changes since a revision, in pages, with a
		// delete in them, and a change made between two of the pages.
		for (let i = 8; i <= 12; i++) {
			await addMark(tess, "c_many", `Mark ${i}`);
			await tess.engine.request();
		}
		await change(tess, "c_many", (c, now) => withoutMark(c, "m9", now));
		await tess.engine.request();
		const changes = dana.api.changes.bind(dana.api);
		let asked = 0;
		dana.api.changes = async (team, since, limit) => {
			if (++asked === 2) {
				await change(tess, "c_many", (c, now) =>
					withComment(c, "m2", "Changed between two pages", now),
				);
				await tess.engine.request();
			}
			return changes(team, since, limit);
		};
		await dana.engine.request();
		dana.api.changes = changes;
		expect(asked).toBeGreaterThan(2);
		expect(look(await dana.store.getCase("c_many"))).toEqual(
			look(await tess.store.getCase("c_many")),
		);
		expect(
			(await dana.store.getCase("c_many"))?.marks.map((a) => a.number),
		).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]);
		expect((await dana.store.getCase("c_many"))?.marks[1]?.comment).toBe(
			"Changed between two pages",
		);
		expect(Object.values(await images(dana, "c_many"))).not.toContain(
			"MISSING",
		);
	});

	test("a server with another history (reset): its state is taken whole, and a case it lost is sent again", async () => {
		await shared();
		await startCase(tess, "c_second");
		await addMark(tess, "c_second", "Only Tess had this");
		await addMark(tess, "c_flow", "A third mark, after the copy");
		await tess.engine.request();
		await dana.engine.request();
		// The server is restored from a copy made before that case and that mark.
		server.cases.delete("c_second");
		for (const [id, m] of server.marks)
			if (m.value.caseId === "c_second" || m.value.number === 3)
				server.marks.delete(id);
		for (const [id, s] of server.shots)
			if (
				s.value.caseId === "c_second" ||
				!server.marksOf("c_flow").some((m) => m.shotId === id)
			)
				server.shots.delete(id);
		server.restore();
		const cursor = tess.kv.data.get(KEYS.cursor) as number;
		expect(cursor).toBeGreaterThan(server.seq);
		await tess.engine.request();
		await tess.engine.request();
		expect(tess.kv.data.get(KEYS.cursor)).toBe(server.seq);
		// The mark the server lost is not deleted here on its word: it is
		// still here, and the server has it again, under the id it had.
		expect(look(await tess.store.getCase("c_flow"))?.marks).toHaveLength(3);
		expect(server.marksOf("c_flow").map((m) => m.comment)).toEqual([
			"Total is cut off",
			"Pay button too pale",
			"A third mark, after the copy",
		]);
		expect(server.marksOf("c_flow")[2]?.id).toBe(
			book(tess, "c_flow")?.marks["m3"] as string,
		);
		// The one the server lost is still here, and is the team's again.
		expect(server.caseOf("c_second")?.title).toBe("Your cart");
		expect(server.marksOf("c_second").map((m) => m.comment)).toEqual([
			"Only Tess had this",
		]);
		expect(status(tess)?.state).toBe("synced");
	});
});

describe("signing out and in", () => {
	test("signing out stops the sync and keeps the cases, on this device only", async () => {
		await shared();
		await tess.engine.signOut();
		expect(await tess.engine.account()).toBeUndefined();
		expect(status(tess)?.state).toBe("off");
		expect(look(await tess.store.getCase("c_flow"))?.marks).toHaveLength(2);
		expect(tess.kv.data.get(KEYS.modes)).toEqual({ c_flow: "local" });
		tess.api.calls.length = 0;
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "Signed out", now),
		);
		await tess.engine.request();
		expect(tess.api.calls).toEqual([]);
		expect(server.marksOf("c_flow")[0]?.comment).toBe("Total is cut off");
	});

	test("signing in again goes on where it was: nothing twice, and what changed meanwhile both ways", async () => {
		await shared();
		await tess.engine.signOut();
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "While signed out", now),
		);
		await change(dana, "c_flow", (c, now) =>
			withChoice(c, "m2", "fixed", "", now),
		);
		await dana.engine.request();
		await signIn(tess);
		await sync(tess, dana);
		expect(status(tess)?.undecided).toBe(0);
		expect(server.marksOf("c_flow")).toHaveLength(2);
		expect(server.shotsOf("c_flow")).toHaveLength(2);
		for (const d of [tess, dana])
			expect(look(await d.store.getCase("c_flow"))?.marks).toMatchObject([
				{ comment: "While signed out", status: "open" },
				{ status: "fixed" },
			]);
	});

	test("a sign-in that ran out: said, nothing lost, and it goes on after signing in again", async () => {
		await shared();
		tess.api.unauthorized = true;
		await change(tess, "c_flow", (c, now) =>
			withComment(c, "m1", "While the token was out", now),
		);
		await tess.engine.request();
		expect(status(tess)?.state).toBe("signed-out");
		expect(((await tess.engine.account()) as Account).expired).toBe(true);
		// Not tried again until the user signs in.
		tess.api.calls.length = 0;
		await tess.engine.request();
		expect(tess.api.calls).toEqual([]);
		tess.api.unauthorized = false;
		await signIn(tess);
		expect(status(tess)?.state).toBe("synced");
		expect(status(tess)?.undecided).toBe(0);
		expect(server.marksOf("c_flow")[0]?.comment).toBe(
			"While the token was out",
		);
	});

	test("someone else signs in on the device: what the first synced stays, on this device only", async () => {
		await shared();
		const other = server.api({ id: "u_pat", name: "Pat Product" });
		// The same engine, another person's connection.
		const pat = device("pat", other);
		for (const [key, value] of tess.kv.data) pat.kv.data.set(key, value);
		for (const [key, value] of tess.store.cases)
			pat.store.cases.set(key, value);
		await pat.engine.signedIn("https://sitegloss.test", await other.me());
		// The team's case is here already and the team has it: it goes on syncing.
		expect(status(pat)?.state).toBe("synced");
		expect(server.marksOf("c_flow")).toHaveLength(2);
	});

	test("no longer a member of the team: the sync stops, the cases stay", async () => {
		await shared();
		const me = tess.api.me.bind(tess.api);
		tess.api.me = async () => ({ ...(await me()), teams: [] });
		await tess.engine.retry();
		expect(status(tess)?.state).toBe("off");
		expect(status(tess)?.text).toContain("no longer a member");
		expect(look(await tess.store.getCase("c_flow"))?.marks).toHaveLength(2);
		expect(tess.kv.data.get(KEYS.modes)).toEqual({ c_flow: "local" });
	});
});

describe("the worker stopped in the middle", () => {
	test("operations written down and never sent go at the next run, as they were", async () => {
		await signIn(tess);
		await startCase(tess, "c_stop");
		await addMark(tess, "c_stop", "One");
		await tess.engine.request();
		await addMark(tess, "c_stop", "Two", { url: PAY });
		const before = new Set(server.applied.keys());
		// The run stops after writing the operations down: no request is made.
		const ops = tess.api.ops.bind(tess.api);
		tess.api.ops = async () => {
			throw new Error("the worker stopped");
		};
		await tess.engine.request();
		expect(status(tess)?.state).toBe("problem");
		const queue = tess.kv.data.get(KEYS.queue) as Queue;
		expect(queue.ops.map((op: Op) => op.type)).toEqual([
			"case.patch",
			"shot.create",
			"mark.create",
		]);
		tess.api.ops = ops;
		await tess.engine.request();
		expect(
			[...server.applied.keys()].filter((id) => !before.has(id)).sort(),
		).toEqual(queue.ops.map((op: Op) => op.opId).sort());
		expect(server.marksOf("c_stop")).toHaveLength(2);
		expect(tess.kv.data.get(KEYS.queue)).toBeUndefined();
	});

	const stops: {
		what: string;
		id: string;
		marks: number;
		shots?: number;
		announced?: string[];
		make: () => Promise<void>;
		written: (b: CaseBook | undefined) => boolean;
	}[] = [
		{
			what: "a case stored and its book not: the marks are the server's still, none is made twice",
			id: "c_flow",
			marks: 3,
			announced: ["m3"],
			make: async () => {
				await addMark(tess, "c_flow", "Third");
				await tess.engine.request();
			},
			// The book that would say the server has the new mark.
			written: (b) =>
				b?.shadow !== undefined && Object.keys(b.shadow.marks).length === 3,
		},
		{
			what: "a new case stored and its book not: nothing of it is made twice at the server",
			id: "c_other",
			marks: 2,
			shots: 2,
			make: async () => {
				await startCase(tess, "c_other");
				await addMark(tess, "c_other", "One");
				await addMark(tess, "c_other", "Two");
				await tess.engine.request();
			},
			written: (b) => b?.shadow !== undefined,
		},
	];
	for (const stop of stops)
		test(stop.what, async () => {
			await shared();
			await stop.make();
			// Dana's device stores the case and stops before it writes its book:
			// from there on nothing is written at all, and a new worker takes
			// up what the stopped one left.
			const put = dana.kv.set.bind(dana.kv);
			let stopped = false;
			dana.kv.set = async (entries) => {
				const b = entries[`case:${stop.id}`] as CaseBook | undefined;
				if (stop.written(b)) stopped = true;
				if (stopped) return new Promise<void>(() => undefined);
				return put(entries);
			};
			void dana.engine.request();
			await until(() => stopped);
			expect((await dana.store.getCase(stop.id))?.marks).toHaveLength(
				stop.marks,
			);
			// The ids were written down first, each with its mark's drawing.
			if (stop.announced)
				expect(
					Object.keys(book(dana, stop.id)?.announced?.marks ?? {}),
				).toEqual(stop.announced);
			dana.kv.set = put;
			dana = restarted(dana);
			await sync(dana, tess);
			expect(book(dana, stop.id)?.announced).toBeUndefined();
			expect(server.marksOf(stop.id)).toHaveLength(stop.marks);
			if (stop.shots) expect(server.shotsOf(stop.id)).toHaveLength(stop.shots);
			expect(look(await dana.store.getCase(stop.id))).toEqual(
				look(await tess.store.getCase(stop.id)),
			);
			expect(status(dana)?.state).toBe("synced");
		});
});

describe("who is asked what", () => {
	test("a case without a mark is nothing to ask about; one never answered about is asked about again", async () => {
		await startCase(tess, "c_empty");
		await startCase(tess, "c_old");
		await addMark(tess, "c_old", "Was here before");
		await signIn(tess);
		expect(status(tess)?.undecided).toBe(1);
		// Signed out without an answer, and in again: the same question.
		await tess.engine.signOut();
		expect(tess.kv.data.get(KEYS.modes)).toEqual({});
		await signIn(tess);
		expect(status(tess)?.undecided).toBe(1);
		expect(server.cases.size).toBe(0);
		// The empty case gets its first mark now: made since, it is the team's.
		await addMark(tess, "c_empty", "First mark");
		await tess.engine.request();
		expect([...server.cases.keys()]).toEqual(["c_empty"]);
	});

	test("a case made while the sign-in had run out is the team's when it is back, without a question", async () => {
		await signIn(tess);
		tess.api.unauthorized = true;
		await tess.engine.retry();
		expect(status(tess)?.state).toBe("signed-out");
		await startCase(tess, "c_meanwhile");
		await addMark(tess, "c_meanwhile", "Made meanwhile");
		tess.api.unauthorized = false;
		await signIn(tess);
		expect(status(tess)?.undecided).toBe(0);
		expect(server.caseOf("c_meanwhile")).toBeDefined();
	});

	test("a team joined later: found at the next look, and chosen when it is the only one", async () => {
		const me = tess.api.me.bind(tess.api);
		tess.api.me = async () => ({ ...(await me()), teams: [] });
		await signIn(tess);
		expect(((await tess.engine.account()) as Account).teamId).toBeUndefined();
		expect(status(tess)?.state).toBe("off");
		tess.api.me = me;
		// "Sync now" asks again.
		await tess.engine.retry();
		expect(((await tess.engine.account()) as Account).teamId).toBe(TEAM);
		expect(status(tess)?.state).toBe("synced");
	});
});

describe("images added to a mark (DEC-058)", () => {
	/** The panel's Add: the case and the pictures in one change. */
	const addImages = (d: Device, markId: string, tags: string[]) => {
		const ids = tags.map((t) => `i_${d.name}_${t}`);
		return d.store.updateCase("c_flow", (current) => ({
			value: withImages(
				current as Case,
				markId,
				ids,
				d.clock.now.toISOString(),
			),
			images: new Map(
				ids.map((id, i) => [
					addedImage(id),
					{ blob: webp(`image ${tags[i]}`, 640, 400), width: 640, height: 400 },
				]),
			),
		}));
	};
	const shown = async (
		d: Device,
		which: "images" | "heldImages" = "images",
	) => {
		const c = (await d.store.getCase("c_flow")) as Case;
		const a = c.marks.find((x) => x.number === 2) as Mark;
		return Promise.all(
			(a[which] ?? []).map(async (x) => {
				const file = await d.store.getImage("c_flow", x.image);
				return `${x.id} by ${x.added.user?.name ?? "nobody"}: ${file ? await tagOf(file.blob) : "MISSING"}`;
			}),
		);
	};

	test("one device's image reaches the other with its picture and who added it; a remove there takes it here", async () => {
		await shared();
		await addImages(tess, "m2", ["menu"]);
		await sync(tess, dana);
		expect(
			server
				.marksOf("c_flow")
				.find((m) => m.number === 2)
				?.images?.map((x) => x.id),
		).toEqual(["i_tess_menu"]);
		expect(await shown(dana)).toEqual([
			"i_tess_menu by Tess Tester: image menu",
		]);
		const gone = await dana.store.updateCase("c_flow", (current) => {
			const { value, images } = withoutImage(
				current as Case,
				"m2",
				"i_tess_menu",
				dana.clock.now.toISOString(),
			);
			return { value, deleteImages: images };
		});
		expect(gone.marks[1]?.images).toBeUndefined();
		await sync(dana, tess);
		expect(await shown(tess)).toEqual([]);
		expect(keys(tess, "c_flow").some((k) => k.includes("images/"))).toBe(false);
		expect(status(tess)?.problems).toEqual([]);
	});

	const filled = async (d: Device, tags: string[]) => {
		await addImages(d, "m2", tags);
		await sync(tess, dana);
	};
	const notSent = (d: Device) => status(d)?.notSent?.["c_flow"] ?? {};
	const atServer = () =>
		server.marksOf("c_flow").find((m) => m.number === 2) as WireMark;
	const team = [
		"i_tess_a by Tess Tester: image a",
		"i_tess_b by Tess Tester: image b",
		"i_tess_c by Tess Tester: image c",
		"i_tess_d by Tess Tester: image d",
		"i_dana_e by Dana Developer: image e",
		"i_tess_f by Tess Tester: image f",
	];
	/** Each device adds one more to five before hearing of the other's: Dana's is the seventh. */
	const pastSix = async () => {
		await shared();
		await addImages(tess, "m2", ["a", "b", "c", "d"]);
		await filled(dana, ["e"]);
		await addImages(tess, "m2", ["f"]);
		await addImages(dana, "m2", ["g"]);
		await sync(tess, dana);
	};

	test("two devices adding at once past six: the later's image is held back on its device, its file kept, never sent past six", async () => {
		await pastSix();
		expect(await shown(tess)).toEqual(team);
		expect(await shown(dana)).toEqual(team);
		expect(await shown(dana, "heldImages")).toEqual([
			"i_dana_g by nobody: image g",
		]);
		expect(atServer().images?.map((x) => x.id)).toHaveLength(6);
		// Nothing waits that the server would refuse: no problem is left.
		await sync(dana);
		expect(status(dana)?.problems).toEqual([]);
	});

	test("a held image does not hold back the mark's other changes", async () => {
		await pastSix();
		const posted: Op[] = [];
		const ops = dana.api.ops.bind(dana.api);
		dana.api.ops = async (teamId, list) => {
			posted.push(...list);
			return ops(teamId, list);
		};
		await change(dana, "c_flow", (c, now) =>
			withComment(c, "m2", "Seen on Firefox too", now),
		);
		await change(dana, "c_flow", (c, now) =>
			withChoice(c, "m2", "fixed", "", now),
		);
		await sync(dana, tess);
		expect(atServer().comment).toBe("Seen on Firefox too");
		expect(atServer().resolution?.kind).toBe("fixed");
		expect(
			posted.some(
				(op) => op.type === "mark.patch" && op.images?.add !== undefined,
			),
		).toBe(false);
		expect(status(dana)?.problems).toEqual([]);
		expect(await shown(dana, "heldImages")).toEqual([
			"i_dana_g by nobody: image g",
		]);
	});

	test("a place frees up at the server: the held image goes as an ordinary add", async () => {
		await pastSix();
		await tess.store.updateCase("c_flow", (current) => {
			const { value, images } = withoutImage(
				current as Case,
				"m2",
				"i_tess_a",
				tess.clock.now.toISOString(),
			);
			return { value, deleteImages: images };
		});
		await sync(tess, dana, tess);
		const now = [...team.slice(1), "i_dana_g by Dana Developer: image g"];
		expect(await shown(tess)).toEqual(now);
		expect(await shown(dana)).toEqual(now);
		expect(await shown(dana, "heldImages")).toEqual([]);
	});

	test("an image the team's storage refuses stays here, said on it; once the team's mark is full it is held back", async () => {
		await shared();
		tess.api.putBlob = async () => {
			throw new ApiFailure(
				"refused",
				"The team's storage is full.",
				507,
				"quota",
			);
		};
		await addImages(tess, "m2", ["big"]);
		await sync(tess);
		expect(await shown(tess)).toEqual(["i_tess_big by nobody: image big"]);
		expect(notSent(tess)).toEqual({ i_tess_big: "The team's storage is full" });
		expect(
			status(tess)
				?.problems.map((p) => p.text)
				.join(" "),
		).toContain(
			"An image added to mark 2 was not taken, so the team does not see it: The team's storage is full.",
		);
		await filled(dana, ["a", "b", "c", "d", "e", "f"]);
		expect(await shown(tess, "heldImages")).toEqual([
			"i_tess_big by nobody: image big",
		]);
	});

	test("a role that may not change marks keeps the image here, said on it; once the team's mark is full it is held back", async () => {
		await shared();
		tess.api.permissions = tess.api.permissions.filter(
			(p) => p !== "mark:update",
		);
		await signIn(tess);
		await addImages(tess, "m2", ["mine"]);
		await sync(tess);
		expect(notSent(tess)).toEqual({
			i_tess_mine: "your role in the team does not allow it",
		});
		await filled(dana, ["a", "b", "c", "d", "e", "f"]);
		expect(await shown(tess, "heldImages")).toEqual([
			"i_tess_mine by nobody: image mine",
		]);
		expect(atServer().images).toHaveLength(6);
	});
});
