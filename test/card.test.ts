import { describe, expect, test } from "bun:test";
import {
	ALLOW_DELAY_MS,
	armed,
	asksKeepOn,
	type CardStatus,
	CONFIRM_DELAY_MS,
	cardStatus,
	cardView,
	confirms,
	hasNewGrant,
	KEEP_ON_ASK_WAIT_MS,
	keepOnAskStarts,
	keepOnChosen,
	NOT_ASKING,
	nextKeepOnAsk,
	pairedSince,
	stillPaired,
	switchShown,
} from "../src/sidepanel/card.ts";
import type { AiState } from "../src/worker/protocol.ts";

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
const ADDRESS = "https://relay.example/s/sitegloss/mcp";
const claude = {
	grantId: "g1",
	name: "Claude",
	host: "claude.ai",
	allowAll: false,
	always: [],
};

describe("the AI app card", () => {
	test.each([
		[{}, "off"],
		[{ problem: "Could not connect" }, "off"],
		[{ state: "connecting" }, "connecting"],
		[{ state: "reconnecting" }, "retrying"],
		[{ retrying: true, problem: "Could not connect" }, "retrying"],
		[{ state: "connected" }, "waiting"],
		[{ state: "connected", grants: [claude] }, "on"],
	] as [Partial<AiState>, CardStatus][])("%o is %s", (change, status) => {
		expect(cardStatus({ ...base, ...change })).toBe(status);
	});

	test("off: the switch is off, Turn on AI access is the step, no address", () => {
		expect(cardView({ ...base, address: ADDRESS }, false)).toEqual({
			status: "off",
			stateText: "AI access is off · paired apps stay paired",
			switchOn: false,
			turnOn: true,
			pairing: false,
			addApp: false,
			done: false,
			address: "",
		});
	});

	test("connecting or retrying: the switch is on (to stop it), nothing to pair yet", () => {
		for (const change of [{ state: "connecting" }, { retrying: true }] as const)
			expect(cardView({ ...base, ...change }, true)).toMatchObject({
				switchOn: true,
				turnOn: false,
				pairing: false,
				addApp: false,
			});
	});

	test("on with no app paired: the address and the code at once, no Done", () => {
		const view = cardView(
			{ ...base, state: "connected", address: ADDRESS },
			false,
		);
		expect(view).toEqual({
			status: "waiting",
			stateText: "On · no AI app paired yet",
			switchOn: true,
			turnOn: false,
			pairing: true,
			addApp: false,
			done: false,
			address: ADDRESS,
		});
	});

	test("apps paired: their names, + Add another AI app, the address hidden until asked", () => {
		const state: AiState = {
			...base,
			state: "connected",
			address: ADDRESS,
			grants: [
				claude,
				{
					grantId: "g2",
					name: "",
					host: "chatgpt.com",
					allowAll: false,
					always: [],
				},
			],
		};
		expect(cardView(state, false)).toEqual({
			status: "on",
			stateText: "Connected · Claude, chatgpt.com",
			switchOn: true,
			turnOn: false,
			pairing: false,
			addApp: true,
			done: false,
			address: "",
		});
		expect(cardView(state, true)).toMatchObject({
			pairing: true,
			addApp: false,
			done: true,
			address: ADDRESS,
		});
	});
});

describe("the card's clicks", () => {
	test("the second click of a double click does not confirm Disconnect", () => {
		expect(confirms(1000, 1000 + 120)).toBe(false);
		expect(confirms(1000, 1000 + CONFIRM_DELAY_MS - 1)).toBe(false);
		expect(confirms(1000, 1000 + CONFIRM_DELAY_MS)).toBe(true);
	});

	test("the switch keeps the user's flip until the state follows, or the wait ends", () => {
		const intent = { on: true, until: 5000 };
		// A state from before the connect: the switch stays on.
		expect(switchShown(false, intent, 1000)).toEqual({ checked: true, intent });
		// The state follows: the intent is done.
		expect(switchShown(true, intent, 1200)).toEqual({
			checked: true,
			intent: undefined,
		});
		// It never followed: the state wins after the wait.
		expect(switchShown(false, intent, 5000)).toEqual({
			checked: false,
			intent: undefined,
		});
		expect(switchShown(true, undefined, 0)).toEqual({
			checked: true,
			intent: undefined,
		});
	});
});

describe("hasNewGrant", () => {
	const connected: AiState = { ...base, state: "connected", grants: [claude] };

	test("no new app: the pairing box stays for the one being added", () => {
		expect(hasNewGrant(new Set(["g1"]), connected)).toBe(false);
	});

	test("the app being added connected: adding ends", () => {
		const code = { ...claude, grantId: "g2", name: "Claude Code" };
		const both = { ...connected, grants: [claude, code] };
		expect(hasNewGrant(new Set(["g1"]), both)).toBe(true);
		// The view then shows the card without the box.
		expect(cardView(both, false).pairing).toBe(false);
	});

	test("an app disconnected meanwhile is no new one", () => {
		expect(hasNewGrant(new Set(["g1", "g2"]), connected)).toBe(false);
	});
});

describe("pairedSince (DEC-045)", () => {
	const connected: AiState = { ...base, state: "connected", grants: [claude] };

	test("an app paired while the pairing box showed is named: what to do next is said", () => {
		expect(pairedSince(new Set(), connected)).toEqual({
			grantId: "g1",
			name: "Claude",
		});
		const code = { ...claude, grantId: "g2", name: "", host: "localhost:3000" };
		expect(
			pairedSince(new Set(["g1"]), { ...connected, grants: [claude, code] }),
		).toEqual({ grantId: "g2", name: "localhost:3000" });
	});

	test("nothing new, or no pairing box: nothing is said", () => {
		expect(pairedSince(new Set(["g1"]), connected)).toBeUndefined();
		// Apps that were paired before the panel opened are no news.
		expect(pairedSince(undefined, connected)).toBeUndefined();
	});
});

describe("stillPaired (DEC-045)", () => {
	const connected: AiState = { ...base, state: "connected", grants: [claude] };

	test("said while that app is paired and AI access is connected", () => {
		expect(stillPaired("g1", connected)).toBe(true);
	});

	test("disconnected, or the app removed, or AI access off: no longer said", () => {
		expect(stillPaired("g1", { ...connected, grants: [] })).toBe(false);
		expect(stillPaired("g1", { ...connected, state: "disconnected" })).toBe(
			false,
		);
		expect(stillPaired("g2", connected)).toBe(false);
	});
});

describe("when a yes to a question counts (Allow, Fill in the code)", () => {
	test("after the panel has been focused and the question shown, both for the delay", () => {
		expect(ALLOW_DELAY_MS).toBe(750);
		// Shown long ago, the panel focused just now: not yet (review of DEC-044).
		expect(armed(0, 10_000, 10_100)).toBe(false);
		expect(armed(0, 10_000, 10_750)).toBe(true);
		// Focused long ago, the question just shown: not yet.
		expect(armed(10_000, 0, 10_700)).toBe(false);
		expect(armed(10_000, 0, 10_750)).toBe(true);
		// Not focused: never.
		expect(armed(0, undefined, 1_000_000)).toBe(false);
	});
});

test("the question whether to keep AI access on: once, when the person turned it on, not kept on, not taken over (DEC-059)", () => {
	const ways = ["switch", "button", "pill", "by-itself"] as const;
	const rows: [string, boolean, boolean, boolean][] = [];
	for (const way of ways)
		for (const keepOn of [false, true])
			for (const answered of [false, true])
				rows.push([
					way,
					keepOn,
					answered,
					asksKeepOn(way, { keepOn }, answered),
				]);
	// Only the person's own turning on, with keep-on off and no answer yet.
	expect(rows.filter(([, , , asks]) => asks)).toEqual([
		["switch", false, false, true],
		["button", false, false, true],
		["pill", false, false, true],
	]);
	// Taken over by another browser or program: not asked.
	expect(
		asksKeepOn("switch", { keepOn: false, replaced: { sibling: true } }, false),
	).toBe(false);
});

test("the question shows only once AI access is really on after the person's turning on, and goes whenever it is not (DEC-059)", () => {
	const off = {
		state: "disconnected" as const,
		retrying: false,
		keepOn: false,
	};
	const connecting = { ...off, state: "connecting" as const };
	const connected = { ...off, state: "connected" as const };
	const started = keepOnAskStarts("switch", off, false, 0);
	expect(started.asking).toBe(false);
	// Still off: the worker has not taken the command up yet; then connecting.
	expect(nextKeepOnAsk(started, off, false, 10)).toBe(started);
	const seen = nextKeepOnAsk(started, connecting, false, 20);
	expect(seen.pending?.seenActive).toBe(true);
	// Connected: asked.
	const asking = nextKeepOnAsk(seen, connected, false, 30);
	expect(asking.asking).toBe(true);
	// Gone when it goes off, the session ends, or another panel answered.
	expect(nextKeepOnAsk(asking, off, false, 40)).toEqual(NOT_ASKING);
	expect(
		nextKeepOnAsk(asking, { ...connected, state: "reconnecting" }, false, 40),
	).toEqual(NOT_ASKING);
	expect(nextKeepOnAsk(asking, connected, true, 40)).toEqual(NOT_ASKING);
	expect(
		nextKeepOnAsk(asking, { ...connected, keepOn: true }, false, 40),
	).toEqual(NOT_ASKING);
	// The attempt failed (an unreachable relay): never asked.
	expect(nextKeepOnAsk(seen, off, false, 40)).toEqual(NOT_ASKING);
	// It took too long: not asked any more.
	expect(
		nextKeepOnAsk(started, connected, false, KEEP_ON_ASK_WAIT_MS + 1),
	).toEqual({ asking: true });
	expect(nextKeepOnAsk(started, off, false, KEEP_ON_ASK_WAIT_MS + 1)).toEqual(
		NOT_ASKING,
	);
	// Coming on by itself never starts it.
	expect(nextKeepOnAsk(NOT_ASKING, connected, false, 50)).toEqual(NOT_ASKING);
	expect(keepOnAskStarts("by-itself", off, false, 0)).toEqual(NOT_ASKING);

	// The answer "keep" (or a tick by hand) is kept once keep-on is really on:
	// a refused consent or a worker that does not take it leaves it unanswered.
	expect(keepOnChosen(false, { keepOn: false })).toBe(false);
	expect(keepOnChosen(false, { keepOn: true })).toBe(true);
	expect(keepOnChosen(true, { keepOn: true })).toBe(false);
});
