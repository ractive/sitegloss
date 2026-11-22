/**
 * The AI connection's pieces in the service worker (DEC-015): who may send
 * what, the questions of tools that change something, the address secret's
 * storage, the settings in IndexedDB, and
 * bundles: one a service worker can run, a side panel that keeps no setting.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfirmRequest, RelayClient } from "@ractive-ch/tab-mcp-client";
import { build } from "../scripts/build.ts";
import { isWorkerRequest } from "../src/lib/messages.ts";
import {
	countdownText,
	problemOf,
	statusText,
	timeLeftShare,
} from "../src/sidepanel/ai.ts";
import { stopFirst, stopProblem } from "../src/worker/connection.ts";
import { DATABASE, memoryKv } from "../src/worker/kv.ts";
import {
	type AiState,
	isPanelSender,
	type PanelCommand,
	parseCommand,
} from "../src/worker/protocol.ts";
import {
	appName,
	NOTIFICATION_BUTTONS,
	NOTIFICATION_GUARD_MS,
	type NotificationText,
	notificationText,
	QUESTION_TIMEOUT_MS,
	Questions,
	type QuestionsHost,
	visible,
	WEBMCP_CALLER,
} from "../src/worker/questions.ts";
import { CachedSecretStorage } from "../src/worker/secret.ts";
import { kvContract } from "./kv-contract.ts";

const ID = "ldmcfigcnobhnbaigehcaodheklibeon";
const PANEL = `chrome-extension://${ID}/sidepanel/index.html`;
const contentScript = { id: ID, url: "https://site.test/page", tab: { id: 1 } };

/** Every command there is, valid. */
const COMMANDS: PanelCommand[] = [
	{ type: "hello", windowId: 1 },
	{ type: "connect" },
	{ type: "stop" },
	{ type: "keep-on", on: true },
	{ type: "blur-forms", on: false },
	{ type: "pair", on: true },
	{ type: "revoke", grantId: "g" },
	{ type: "allow-all", grantId: "g", on: true },
	{ type: "ask-again", grantId: "g", tool: "delete_case" },
	{ type: "new-address" },
	{ type: "set-relay", relay: "https://relay.example" },
	{ type: "answer", id: "q", answer: "allow" },
	{ type: "answer", id: "q", answer: "always" },
];

describe("who may send what", () => {
	test("a port is the panel's only from the side panel's page of this extension", () => {
		expect(isPanelSender({ id: ID, url: PANEL }, ID)).toBe(true);
		// A content script: its page's address, and a tab.
		expect(isPanelSender(contentScript, ID)).toBe(false);
		expect(isPanelSender({ ...contentScript, url: PANEL }, ID)).toBe(false);
		// The panel's page opened in a tab by its address is no side panel.
		expect(isPanelSender({ id: ID, url: PANEL, tab: { id: 2 } }, ID)).toBe(
			false,
		);
		// Another extension, another page of this one, no address at all.
		expect(
			isPanelSender(
				{ id: "x".repeat(32), url: PANEL.replace(ID, "x".repeat(32)) },
				ID,
			),
		).toBe(false);
		expect(
			isPanelSender({ id: ID, url: PANEL.replace(ID, "x".repeat(32)) }, ID),
		).toBe(false);
		expect(
			isPanelSender(
				{ id: ID, url: `chrome-extension://${ID}/sidepanel/other.html` },
				ID,
			),
		).toBe(false);
		expect(isPanelSender({ id: ID }, ID)).toBe(false);
		expect(isPanelSender({ id: ID, url: "not a url" }, ID)).toBe(false);
	});

	test("Firefox: the panel's origin is the installation's UUID, not the add-on id", () => {
		const FIREFOX_ID = "sitegloss@ractive.ch";
		const UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
		const origin = `moz-extension://${UUID}/`;
		const panel = `${origin}sidepanel/index.html`;
		const options = { origin };
		expect(
			isPanelSender({ id: FIREFOX_ID, url: panel }, FIREFOX_ID, options),
		).toBe(true);
		// Not by the default origin, which is Chrome's.
		expect(isPanelSender({ id: FIREFOX_ID, url: panel }, FIREFOX_ID)).toBe(
			false,
		);
		// Another installation, another scheme, another page, a content script.
		for (const url of [
			panel.replace(UUID, "1".repeat(8)),
			panel.replace("moz-extension:", "chrome-extension:"),
			`${origin}sidepanel/other.html`,
			"moz-extension:///sidepanel/index.html",
		])
			expect(isPanelSender({ id: FIREFOX_ID, url }, FIREFOX_ID, options)).toBe(
				false,
			);
		expect(
			isPanelSender(
				{ id: "other@example.com", url: panel },
				FIREFOX_ID,
				options,
			),
		).toBe(false);
		// The panel's page in a tab: only where the test build lets it.
		const inTab = { id: FIREFOX_ID, url: panel, tab: { id: 3 } };
		expect(isPanelSender(inTab, FIREFOX_ID, options)).toBe(false);
		expect(isPanelSender(inTab, FIREFOX_ID, { ...options, inTab: true })).toBe(
			true,
		);
		expect(
			isPanelSender({ ...contentScript, id: FIREFOX_ID }, FIREFOX_ID, {
				...options,
				inTab: true,
			}),
		).toBe(false);
	});

	test("no command is a one-off message the worker answers: content scripts cannot command", () => {
		for (const command of COMMANDS)
			expect(isWorkerRequest(command)).toBe(false);
		// What content scripts do send still passes.
		expect(
			isWorkerRequest({ type: "capture", caseId: "c_1", shotId: "s1" }),
		).toBe(true);
		for (const odd of [null, "capture", 1, {}, { type: "toString" }])
			expect(isWorkerRequest(odd)).toBe(false);
	});

	test("commands are checked: only well-formed ones pass, as they are", () => {
		for (const command of COMMANDS)
			expect(parseCommand(command)).toEqual(command);
		for (const bad of [
			null,
			"connect",
			{},
			{ type: "unknown" },
			{ type: "hello", windowId: "1" },
			{ type: "hello", windowId: 1.5 },
			{ type: "keep-on", on: "yes" },
			{ type: "blur-forms" },
			{ type: "blur-forms", on: 1 },
			{ type: "pair" },
			{ type: "revoke", grantId: 1 },
			{ type: "set-relay" },
			{ type: "answer", id: "q", answer: "never" },
			{ type: "allow-all", grantId: "g" },
			{ type: "allow-all", grantId: 1, on: true },
			{ type: "ask-again", grantId: "g" },
			{ type: "ask-again", tool: "delete_case" },
			{ type: "answer", id: 1, answer: "allow" },
		])
			expect(parseCommand(bad)).toBeUndefined();
		// Extra fields are dropped.
		expect(parseCommand({ type: "stop", extra: 1 })).toEqual({ type: "stop" });
	});
});

/** A host whose notifications and panels the test controls. */
function fakeHost(options: { panel?: boolean } = {}) {
	const shown = new Map<string, NotificationText>();
	const cleared: string[] = [];
	let now = 1_000_000;
	const host: QuestionsHost & {
		shown: typeof shown;
		cleared: string[];
		advance(ms: number): void;
		changes: number;
	} = {
		shown,
		cleared,
		changes: 0,
		advance(ms) {
			now += ms;
		},
		windowOf: async (tabId) => (tabId === 7 ? 3 : undefined),
		panelInFocus: async (windowId) => options.panel === true && windowId === 3,
		notify: async (id, text) => {
			shown.set(id, text);
		},
		clear: (id) => {
			shown.delete(id);
			cleared.push(id);
		},
		changed: () => {
			host.changes++;
		},
		now: () => now,
	};
	return host;
}

function request(
	args: Record<string, unknown> = { caseId: "c_1" },
	signal = new AbortController().signal,
	tool = "delete_case",
	grantId = "g1",
): ConfirmRequest {
	return {
		tool: { name: tool, title: "Delete case", description: "" },
		arguments: args,
		client: claude(grantId),
		signal,
	};
}

function claude(grantId = "g1", name = "Claude"): RelayClient {
	return {
		kind: "relay",
		grantId,
		id: "https://claude.ai/oauth",
		name,
		host: "claude.ai",
	};
}

const CASE = ["Case: “Button contrast” (www.example.com/kk, 2 marks)."];
const settle = () => Bun.sleep(5);

describe("questions", () => {
	test("without a panel in front, a notification asks and names the case; Allow after the guard counts", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		const answer = questions.ask(request(), CASE, 7);
		await settle();
		expect(questions.list).toEqual([
			{
				id: expect.any(String),
				app: "Claude (claude.ai)",
				tool: "delete_case",
				title: "Delete case",
				lines: CASE,
				args: '{\n  "caseId": "c_1"\n}',
				expiresAt: expect.any(Number),
			},
		]);
		// When it ends unanswered, by the host's clock: the panel counts down to it.
		expect(questions.list[0]?.expiresAt).toBe(host.now() + QUESTION_TIMEOUT_MS);
		expect(host.changes).toBeGreaterThan(0);
		const [[id, text]] = [...host.shown] as [[string, NotificationText]];
		expect(text).toEqual({
			title: "Allow Delete case?",
			message: `Claude (claude.ai) wants to run delete_case: ${CASE[0]} Arguments: {"caseId":"c_1"}`,
			contextMessage: "Sitegloss · close it to not allow",
			buttons: ["Allow", "Always allow"],
		});
		host.advance(NOTIFICATION_GUARD_MS);
		questions.notificationButton(id, 0);
		expect(await answer).toBe("allow");
		expect(questions.list).toEqual([]);
		expect(host.shown.size).toBe(0);
	});

	test("a notification knows the window of its question's tab, until the question is settled", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		const answer = questions.ask(request(), CASE, 7);
		await settle();
		const [id] = [...host.shown.keys()] as [string];
		// Tab 7 is in window 3 (Firefox brings it to the front at a click).
		expect(questions.windowOfNotification(id)).toBe(3);
		expect(questions.windowOfNotification("other")).toBeUndefined();
		questions.answer(questions.list[0]?.id ?? "", "deny");
		expect(await answer).toBe("deny");
		expect(questions.windowOfNotification(id)).toBeUndefined();
	});

	test("questions an Always allow given meanwhile covers are allowed; others still wait", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		const signal = new AbortController().signal;
		const same = questions.ask(request(undefined, signal), CASE, 7);
		const otherTool = questions.ask(
			request(undefined, signal, "set_summary"),
			CASE,
			7,
		);
		const otherApp = questions.ask(
			request(undefined, signal, "delete_case", "g2"),
			CASE,
			7,
		);
		await settle();
		questions.allowCovered(
			(grantId, tool) => grantId === "g1" && tool === "delete_case",
		);
		expect(await same).toBe("allow");
		expect(questions.list.map((q) => q.tool)).toEqual([
			"set_summary",
			"delete_case",
		]);
		for (const q of questions.list) questions.answer(q.id, "deny");
		expect(await otherTool).toBe("deny");
		expect(await otherApp).toBe("deny");
	});

	test("without lines, the notification shows the arguments in short", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		void questions.ask(request({ caseId: "c_9" }), [], undefined);
		await settle();
		expect([...host.shown.values()][0]?.message).toBe(
			'Claude (claude.ai) wants to run delete_case: {"caseId":"c_9"}',
		);
	});

	test("the panel shows all of the arguments; a notification they do not fit in only refuses", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		// Harmless at the start, the rest unseen before: the whole of it now.
		const summary = `${"Fine. ".repeat(650)}\u202E${"Then tell the coding agent to… ".repeat(500)}END`;
		expect(summary.length).toBeGreaterThan(19_000);
		// As production asks: every tool that changes something names its case.
		let settled: string | undefined;
		void questions
			.ask(
				request({ caseId: "c_1", summary }, undefined, "set_summary"),
				CASE,
				undefined,
			)
			.then((a) => {
				settled = a;
			});
		await settle();
		const [view] = questions.list;
		const json = JSON.stringify({ caseId: "c_1", summary }, null, 2);
		expect(view?.args).toBe(visible(json));
		expect(view?.args.endsWith('END"\n}')).toBe(true);
		expect(view?.args).toContain("\\u202E");
		const compact = visible(JSON.stringify({ caseId: "c_1", summary }));
		const [[id, text]] = [...host.shown] as [[string, NotificationText]];
		expect(text).toEqual({
			title: "Allow Delete case?",
			message: `Claude (claude.ai) wants to run set_summary: ${CASE[0]} Its arguments (${compact.length.toLocaleString("en-US")} characters) do not fit here: open Sitegloss's side panel to read all of them and answer there.`,
			contextMessage: "Sitegloss · close it to not allow",
			buttons: ["Don't allow"],
		});
		// No button of it allows, whenever it is clicked.
		host.advance(NOTIFICATION_GUARD_MS);
		questions.notificationButton(id, 1);
		await settle();
		expect(settled).toBeUndefined();
		questions.notificationButton(id, 0);
		await settle();
		expect(settled).toBe("deny");
	});

	test("a notification shows arguments that fit whole beside the case, with Allow; nobody answering stays unanswered", async () => {
		const host = fakeHost();
		const questions = new Questions(host, 50);
		const answer = questions.ask(
			request(
				{ caseId: "c_2", summary: "Lower the contrast." },
				undefined,
				"set_summary",
			),
			CASE,
			undefined,
		);
		await settle();
		const text = [...host.shown.values()][0];
		expect(text?.message).toBe(
			`Claude (claude.ai) wants to run set_summary: ${CASE[0]} Arguments: {"caseId":"c_2","summary":"Lower the contrast."}`,
		);
		expect(text?.buttons).toEqual(["Allow", "Always allow"]);
		expect(await answer).toBe("timeout");
		// Too long to fit: the same, without Allow.
		const long = questions.ask(
			request(
				{ caseId: "c_2", summary: "x".repeat(200) },
				undefined,
				"set_summary",
			),
			CASE,
			undefined,
		);
		await settle();
		expect([...host.shown.values()].at(-1)?.buttons).toEqual(["Don't allow"]);
		expect(await long).toBe("timeout");
		// Without lines (no case), the arguments alone, as before.
		void questions.ask(request({ caseId: "c_3" }), [], undefined);
		await settle();
		expect([...host.shown.values()].at(-1)?.message).toBe(
			'Claude (claude.ai) wants to run delete_case: {"caseId":"c_3"}',
		);
	});

	test("long case lines are cut so the arguments fit whole; a long app name makes them not fit", async () => {
		const view = {
			id: "q",
			app: "Claude (claude.ai)",
			tool: "set_mark_status",
			lines: [`Case: “${"T".repeat(250)}” (shop.example/kk, 3 marks).`],
			args: "",
			expiresAt: 0,
		};
		const args = '{"caseId":"c_1","mark":2,"status":"fixed"}';
		const fits = notificationText(view, args);
		expect(fits.message.length).toBeLessThanOrEqual(300);
		expect(fits.message.endsWith(`… Arguments: ${args}`)).toBe(true);
		expect(fits.buttons).toEqual(["Allow", "Always allow"]);
		const named = notificationText({ ...view, app: "C".repeat(280) }, args);
		expect(named.buttons).toEqual(["Don't allow"]);
		expect(named.message).toContain("open Sitegloss's side panel");
	});

	test("the buttons are Allow and Always allow; closing it or a click on the body is Don't allow", async () => {
		expect([...NOTIFICATION_BUTTONS]).toEqual(["Allow", "Always allow"]);
		const host = fakeHost();
		const questions = new Questions(host);
		const always = questions.ask(request(), CASE, 7);
		await settle();
		host.advance(NOTIFICATION_GUARD_MS);
		questions.notificationButton([...host.shown.keys()].at(-1) as string, 1);
		expect(await always).toBe("always");
		const answer = questions.ask(request(), CASE, 7);
		await settle();
		host.advance(NOTIFICATION_GUARD_MS);
		// A button there is not answers nothing.
		const id = [...host.shown.keys()].at(-1) as string;
		questions.notificationButton(id, 2);
		await settle();
		expect(questions.list).toHaveLength(1);
		questions.notificationDismissed(id);
		expect(await answer).toBe("deny");
	});

	test("an Allow or Always allow within the guard does not count: the notification shows again", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		let settled = false;
		const answer = questions.ask(request(), CASE, 7);
		void answer.then(() => {
			settled = true;
		});
		await settle();
		let shown = [...host.shown.keys()][0] as string;
		const first = shown;
		host.advance(NOTIFICATION_GUARD_MS - 1);
		for (const index of [1, 0]) {
			questions.notificationButton(shown, index);
			await settle();
			expect(settled).toBe(false);
			const again = [...host.shown.keys()][0] as string;
			expect(again).not.toBe(shown);
			expect(host.cleared).toContain(shown);
			shown = again;
		}
		// The old one closing (as it was cleared) answers nothing.
		questions.notificationDismissed(first);
		await settle();
		expect(settled).toBe(false);
		host.advance(NOTIFICATION_GUARD_MS);
		questions.notificationButton(shown, 1);
		expect(await answer).toBe("always");
	});

	test("a click answers only its own call; one on a settled call is dropped", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		const a = questions.ask(request({ caseId: "c_a" }), [], 7);
		const b = questions.ask(request({ caseId: "c_b" }), [], 7);
		await settle();
		const [idA, idB] = [...host.shown.keys()] as [string, string];
		host.advance(NOTIFICATION_GUARD_MS);
		questions.notificationDismissed(idB);
		expect(await b).toBe("deny");
		// A late Allow on b's notification does not go to a.
		questions.notificationButton(idB, 0);
		await settle();
		expect(questions.list.map((q) => q.args)).toEqual([
			'{\n  "caseId": "c_a"\n}',
		]);
		questions.notificationButton(idA, 0);
		expect(await a).toBe("allow");
	});

	test("with the panel of the tab's focused window open, no notification; it goes out once the panel closes", async () => {
		const host = fakeHost({ panel: true });
		const questions = new Questions(host);
		const answer = questions.ask(request(), CASE, 7);
		await settle();
		expect(host.shown.size).toBe(0);
		expect(questions.list).toHaveLength(1);
		// Another window's panel closing changes nothing.
		questions.panelClosed(4);
		expect(host.shown.size).toBe(0);
		questions.panelClosed(3);
		expect(host.shown.size).toBe(1);
		questions.answer(questions.list[0]?.id as string, "allow");
		expect(await answer).toBe("allow");
		// Cleared once Chrome has made it.
		await settle();
		expect(host.shown.size).toBe(0);
	});

	test("a notification Chrome makes only after its call settled is cleared once it is there", async () => {
		const host = fakeHost();
		let made: () => void = () => {};
		host.notify = (id, text) =>
			new Promise<void>((resolve) => {
				made = () => {
					host.shown.set(id, text);
					resolve();
				};
			});
		const questions = new Questions(host);
		const controller = new AbortController();
		const answer = questions.ask(request({}, controller.signal), CASE, 7);
		await settle();
		// The AI app cancels before Chrome has made the notification.
		controller.abort();
		expect(await answer).toBe("deny");
		await settle();
		expect(host.cleared).toEqual([]);
		made();
		await settle();
		expect(host.shown.size).toBe(0);
		expect(host.cleared).toHaveLength(1);
	});

	test("no tab in front, or one in another window: a notification", async () => {
		const host = fakeHost({ panel: true });
		const questions = new Questions(host);
		void questions.ask(request(), CASE, undefined);
		void questions.ask(request(), CASE, 8);
		await settle();
		expect(host.shown.size).toBe(2);
	});

	test("an answer from a panel counts, also while a notification shows", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		const answer = questions.ask(request(), CASE, 7);
		await settle();
		expect(host.shown.size).toBe(1);
		questions.answer("not-a-question", "allow");
		questions.answer(questions.list[0]?.id as string, "deny");
		expect(await answer).toBe("deny");
		expect(host.shown.size).toBe(0);
	});

	test("nobody answering is a timeout; the AI app cancelling is Don't allow", async () => {
		const host = fakeHost();
		const questions = new Questions(host, 20);
		expect(await questions.ask(request(), CASE, 7)).toBe("timeout");
		expect(host.shown.size).toBe(0);
		expect(questions.list).toEqual([]);
		const controller = new AbortController();
		const cancelled = questions.ask(request({}, controller.signal), [], 7);
		await settle();
		controller.abort();
		expect(await cancelled).toBe("deny");
		expect(questions.list).toEqual([]);
		const gone = new AbortController();
		gone.abort();
		expect(await questions.ask(request({}, gone.signal), [], 7)).toBe("deny");
	});

	test("a call through WebMCP is not asked about: Don't allow at once, nothing shows", async () => {
		const host = fakeHost();
		const questions = new Questions(host);
		const r: ConfirmRequest = { ...request(), client: { kind: "webmcp" } };
		expect(await questions.ask(r, CASE, 7)).toBe("deny");
		await settle();
		expect(questions.list).toEqual([]);
		expect(host.shown.size).toBe(0);
		expect(host.changes).toBe(0);
		expect(appName({ kind: "webmcp" })).toBe(WEBMCP_CALLER);
		expect(appName(claude())).toBe("Claude (claude.ai)");
		// The declared name escaped, so it cannot hide the verified host;
		// "Last AI call" uses the same rule.
		expect(appName(claude("g1", "Cla\u202Eude"))).toBe(
			"Cla\\u202Eude (claude.ai)",
		);
	});

	test("arguments, lines and names show invisible and direction characters as \\u escapes", async () => {
		expect(visible("pay‮evil​")).toBe("pay\\u202Eevil\\u200B");
		expect(visible("a b")).toBe("a\\u00A0b");
		expect(visible('{\n\t"a": 1\r}')).toBe('{\n\t"a": 1\\u000D}');
		// Also variation selectors, private use, lone surrogates, tags (as JSON writes them).
		expect(visible("ok\ufe0f")).toBe("ok\\uFE0F");
		expect(visible("a\ue000b")).toBe("a\\uE000b");
		expect(visible("a\ud800b")).toBe("a\\uD800b");
		expect(visible("a\u{e0041}b")).toBe("a\\uDB40\\uDC41b");
		expect(visible("a\u2800b\u3000c")).toBe("a\\u2800b\\u3000c");
		const questions = new Questions(fakeHost());
		const r = request({ caseId: "c‮1" });
		r.client = claude("g1", "Cl​aude");
		void questions.ask(r, ["Case: “x‮”"], 7);
		await settle();
		const [view] = questions.list;
		expect(view?.app).toBe("Cl\\u200Baude (claude.ai)");
		expect(view?.lines).toEqual(["Case: “x\\u202E”"]);
		expect(view?.args).toContain("c\\u202E1");
	});
});

describe("Stop AI access", () => {
	test("disconnects first; a write that fails still lets the others run, and comes back", async () => {
		const done: string[] = [];
		const write =
			(name: string, fails = false) =>
			async () => {
				await Bun.sleep(1);
				done.push(name);
				if (fails) throw new Error(`${name} failed`);
			};
		const stopped = stopFirst(() => done.push("disconnect"), {
			stopped: write("stopped"),
			keepOn: write("keep-on", true),
			session: write("session", true),
		});
		// Before any write has even started to finish.
		expect(done).toEqual(["disconnect"]);
		const failed = await stopped;
		expect(done).toEqual(["disconnect", "stopped", "keep-on", "session"]);
		expect(Object.keys(failed)).toEqual(["keepOn", "session"]);
		expect(
			await stopFirst(() => undefined, { stopped: async () => undefined }),
		).toEqual({});
	});

	test("says what holds: the session's stop over the rest until the browser closes", () => {
		const no = new Error("QuotaExceededError");
		expect(stopProblem({})).toBeUndefined();
		// The stop is kept for the session: only Keep AI access on comes back, at a restart.
		expect(stopProblem({ keepOn: no })).toBe(
			"AI access is off now, but a setting could not be saved (QuotaExceededError). Keep AI access on is still saved as on: AI access comes on again when Chrome restarts.",
		);
		expect(stopProblem({ session: no })).toBe(
			"AI access is off now, but a setting could not be saved (QuotaExceededError).",
		);
		// Neither kept: a new worker may connect again.
		for (const failed of [
			{ stopped: no, keepOn: no },
			{ stopped: no, session: no },
		])
			expect(stopProblem(failed)).toEndWith(
				"It may come on again the next time Chrome starts Sitegloss in the background.",
			);
		// With Keep AI access on off, nothing says it comes on again.
		expect(stopProblem({ stopped: no })).toBe(
			"AI access is off now, but a setting could not be saved (QuotaExceededError).",
		);
	});
});

describe("the address secret in the worker", () => {
	const KEY = "tab-mcp:secret:https://relay:sitegloss";

	test("loaded once, read from memory, written through to the worker's database", async () => {
		const kv = memoryKv({ [KEY]: "s1", relay: "x" });
		const storage = await CachedSecretStorage.load(kv);
		expect(storage.getItem(KEY)).toBe("s1");
		// Only the library's keys.
		expect(storage.getItem("relay")).toBeNull();
		storage.setItem("tab-mcp:secret:https://other:sitegloss", "s2");
		expect(storage.getItem("tab-mcp:secret:https://other:sitegloss")).toBe(
			"s2",
		);
		await storage.written;
		expect(kv.data.get("tab-mcp:secret:https://other:sitegloss")).toBe("s2");
	});
});

describe("the settings in IndexedDB (memoryKv; e2e/store.test.ts runs openKv)", () => {
	for (const [name, run] of Object.entries(kvContract))
		test(name, () => run(memoryKv()));
});

describe("the panel's status line", () => {
	const base: AiState = {
		relay: "https://relay.example",
		keepOn: false,
		blurForms: false,
		state: "disconnected",
		retrying: false,
		grants: [],
		pairing: false,
		questions: [],
		fillCode: false,
		fillHere: false,
	};

	test.each([
		[{}, "Not connected"],
		[{ state: "connecting" }, "Connecting…"],
		[{ state: "connected" }, "Waiting for an AI app to pair"],
		[
			{
				state: "connected",
				grants: [
					{ grantId: "g", name: "Claude", host: "claude.ai" },
					{ grantId: "h", name: "", host: "chatgpt.com" },
				],
			},
			"Connected: Claude, chatgpt.com",
		],
		// Between attempts and during one: the library's state is the same.
		[{ state: "reconnecting" }, "Connection lost, retrying…"],
		[
			{ state: "reconnecting", problem: "Could not connect" },
			"Connection lost, retrying…",
		],
		[
			{ problem: "Could not connect", retrying: true },
			"Not connected: Could not connect Trying again…",
		],
		[
			{ replaced: { sibling: false }, problem: "x" },
			"Not connected: Sitegloss's connection is in use elsewhere.",
		],
		[
			{ relayNote: "The saved relay x cannot be used." },
			"The saved relay x cannot be used.",
		],
	] as [Partial<AiState>, string][])("%o", (change, text) => {
		expect(statusText({ ...base, ...change })).toBe(text);
	});

	test("a question's card counts down to its end, and its bar drains", () => {
		const end = 1_000_000;
		expect(countdownText(end, end - 60_000)).toBe(
			"60 s left to answer; no answer is Don't allow.",
		);
		// Whole seconds, rounded up: "0 s" only once it is over.
		expect(countdownText(end, end - 59_001)).toBe(
			"60 s left to answer; no answer is Don't allow.",
		);
		expect(countdownText(end, end - 1)).toBe(
			"1 s left to answer; no answer is Don't allow.",
		);
		expect(countdownText(end, end + 5_000)).toBe(
			"0 s left to answer; no answer is Don't allow.",
		);
		// A clock set back says no more than the whole time, as the bar.
		expect(countdownText(end, end - 2 * QUESTION_TIMEOUT_MS)).toBe(
			"60 s left to answer; no answer is Don't allow.",
		);
		expect(timeLeftShare(end, end - QUESTION_TIMEOUT_MS)).toBe(1);
		expect(timeLeftShare(end, end - QUESTION_TIMEOUT_MS / 4)).toBe(0.25);
		expect(timeLeftShare(end, end + 1)).toBe(0);
		// A clock that differs from the worker's never draws more than all.
		expect(timeLeftShare(end, end - 2 * QUESTION_TIMEOUT_MS)).toBe(1);
	});

	test("which of these tell of something wrong: the panel shows that sentence under its top bar", () => {
		const problem = (change: Partial<AiState>) =>
			problemOf({ ...base, ...change });
		// All is well, or nothing is on.
		expect(problem({})).toBeUndefined();
		expect(problem({ state: "connected" })).toBeUndefined();
		expect(problem({ state: "connecting" })).toBeUndefined();
		// A failed connect, with or without another try on its way.
		expect(problem({ problem: "Could not connect" })).toBe("connection");
		expect(problem({ problem: "Could not connect", retrying: true })).toBe(
			"connection",
		);
		// Lost and reconnecting; taken over; the saved relay refused.
		expect(problem({ state: "reconnecting" })).toBe("connection");
		expect(problem({ replaced: { sibling: false } })).toBe("connection");
		expect(problem({ relayNote: "The saved relay x cannot be used." })).toBe(
			"connection",
		);
		// Connected again: what went wrong before is over.
		expect(
			problem({ state: "connected", problem: "Could not connect" }),
		).toBeUndefined();
	});
});

describe("the service worker's bundle", () => {
	test("has no dynamic import(), which a service worker refuses", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sitegloss-build-"));
		try {
			const { outdir } = await build({ outdir: join(dir, "dist"), test: true });
			const code = await Bun.file(join(outdir, "background.js")).text();
			expect(code).not.toMatch(/\bimport\s*\(/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the side panel's bundle", () => {
	test("touches no storage of the settings: it changes them only over the port", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sitegloss-build-"));
		try {
			const { outdir } = await build({ outdir: join(dir, "dist"), test: true });
			const files = [
				...new Bun.Glob("sidepanel/**/*.js").scanSync({ cwd: outdir }),
			];
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) {
				const code = await Bun.file(join(outdir, file)).text();
				// Neither chrome.storage (any area) nor the worker's database.
				expect(code).not.toMatch(/\bstorage\s*\.\s*(local|session|sync)\b/);
				expect(code).not.toMatch(/\bstorage\s*\.\s*onChanged\b/);
				expect(code).not.toContain(DATABASE);
			}
			// The worker's does use both.
			const worker = await Bun.file(join(outdir, "background.js")).text();
			expect(worker).toContain(DATABASE);
			expect(worker).toMatch(/\bstorage\.local\b/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
