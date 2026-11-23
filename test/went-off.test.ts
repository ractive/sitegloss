import { describe, expect, test } from "bun:test";
import { statusText } from "../src/sidepanel/ai.ts";
import { cardView } from "../src/sidepanel/card.ts";
import { sessionOnAfter } from "../src/worker/connection.ts";
import type { AiState } from "../src/worker/protocol.ts";
import {
	wentOffAfter,
	wentOffAtStart,
	wentOffOf,
} from "../src/worker/went-off.ts";

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

describe("why AI access went off by itself (DEC-072)", () => {
	test("an idle or expired session is a reason without Keep AI access on, and only then", () => {
		for (const reason of ["idle", "expired"] as const) {
			const end = { state: "disconnected", reason } as const;
			expect(wentOffAfter(end, false)).toBe(reason);
			expect(wentOffAfter(end, true)).toBeUndefined();
			// The same ends that switch the session's flag off.
			expect(sessionOnAfter(end, false)).toBe(false);
		}
	});

	test("the person's stop, a takeover, another reason and a live state give none", () => {
		for (const reason of [
			"user",
			"replaced",
			"disconnect_all",
			"network",
		] as const)
			expect(
				wentOffAfter({ state: "disconnected", reason }, false),
			).toBeUndefined();
		expect(wentOffAfter({ state: "connected" }, false)).toBeUndefined();
		expect(wentOffAfter({ state: "reconnecting" }, false)).toBeUndefined();
	});

	test("a start after it was on, with the session's flag gone, is a restart", () => {
		const s = {
			wasOn: true,
			sessionOn: false,
			stopped: false,
			keepOn: false,
			replaced: false,
		};
		expect(wentOffAtStart(s)).toBe(true);
		// A worker that was only stopped still has the flag.
		expect(wentOffAtStart({ ...s, sessionOn: true })).toBe(false);
		expect(wentOffAtStart({ ...s, wasOn: false })).toBe(false);
		expect(wentOffAtStart({ ...s, stopped: true })).toBe(false);
		// Keep AI access on connects again; a takeover has its own words.
		expect(wentOffAtStart({ ...s, keepOn: true })).toBe(false);
		expect(wentOffAtStart({ ...s, replaced: true })).toBe(false);
	});

	test("a record older than a week is not read back", () => {
		const week = 7 * 24 * 3600 * 1000;
		expect(wentOffOf({ reason: "idle", at: 0 }, week)).toEqual({
			reason: "idle",
			at: 0,
		});
		expect(wentOffOf({ reason: "idle", at: 0 }, week + 1)).toBeUndefined();
	});

	test("the stored record is read back only when whole", () => {
		expect(wentOffOf({ reason: "idle", at: 5 }, 6)).toEqual({
			reason: "idle",
			at: 5,
		});
		expect(wentOffOf({ reason: "user", at: 5 }, 6)).toBeUndefined();
		expect(wentOffOf({ reason: "idle" })).toBeUndefined();
		expect(wentOffOf(undefined)).toBeUndefined();
	});

	const wayBack =
		"Paired apps stay paired. Turn it on again, or tick \u201cKeep AI access on\u201d.";
	const sentences = {
		idle: `AI access went off because no AI app used it for a while. ${wayBack}`,
		expired: `AI access went off because a connection ends after a long time. ${wayBack}`,
		restart: `AI access was on before the browser or Sitegloss restarted, so it is off now. ${wayBack}`,
	};

	test.each(Object.entries(sentences))(
		"%s: the card and the status say why and what to do; it is no problem",
		(reason, text) => {
			const a = { ...base, wentOff: reason as keyof typeof sentences };
			expect(cardView(a, false).stateText).toBe(text);
			expect(cardView(a, false).turnOn).toBe(true);
			expect(statusText(a)).toBe(`Not connected: ${text}`);
		},
	);

	test("nothing of it once connecting, connected, retrying, taken over or failed", () => {
		const off = "idle" as const;
		expect(statusText({ ...base, wentOff: off, state: "connecting" })).toBe(
			"Connecting…",
		);
		expect(
			cardView({ ...base, wentOff: off, state: "connected" }, false).stateText,
		).toBe("On · no AI app paired yet");
		expect(
			cardView({ ...base, wentOff: off, retrying: true }, false).stateText,
		).toBe("Connection lost · retrying");
		expect(
			statusText({ ...base, wentOff: off, replaced: { sibling: false } }),
		).toBe("Not connected: Sitegloss's connection is in use elsewhere.");
		expect(statusText({ ...base, wentOff: off, problem: "x" })).toBe(
			"Not connected: x",
		);
	});

	test("without a reason, the words are as before", () => {
		expect(statusText(base)).toBe("Not connected");
		expect(cardView(base, false).stateText).toBe(
			"AI access is off · paired apps stay paired",
		);
	});
});
