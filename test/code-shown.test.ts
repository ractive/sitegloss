import { expect, test } from "bun:test";
import {
	CODE_USED_WAIT_MS,
	type CodeShown,
	nextCodeShown,
} from "../src/worker/code-shown.ts";

test("a used code stays until its app connects or the wait is over; no new code shows in between", () => {
	const at = "2026-11-22T10:00:00Z";
	let shown: CodeShown = {};
	shown = nextCodeShown(
		shown,
		{ code: "AAAA-AAAA", expiresAt: at, reason: "start" },
		[],
		0,
	);
	expect(shown).toEqual({ code: "AAAA-AAAA" });
	// Typed in: the relay sends the next code before it lists the app.
	const next = { code: "BBBB-BBBB", expiresAt: at, reason: "used" } as const;
	shown = nextCodeShown(shown, next, [], 1000);
	expect(shown.code).toBe("AAAA-AAAA");
	expect(shown.used).toBeDefined();
	expect(nextCodeShown(shown, next, [], 5000)).toBe(shown);
	// The app connects: the card shows it paired, and the next code is the one kept.
	expect(nextCodeShown(shown, next, ["g1"], 2000)).toEqual({
		code: "BBBB-BBBB",
	});
	// No app came: the next code, to try again.
	expect(nextCodeShown(shown, next, [], 1000 + CODE_USED_WAIT_MS)).toEqual({
		code: "BBBB-BBBB",
	});
	// A code that ran out is replaced at once; so is one from an older relay.
	const fresh = { code: "AAAA-AAAA" };
	expect(
		nextCodeShown(
			fresh,
			{ code: "CCCC-CCCC", expiresAt: at, reason: "expired" },
			[],
			0,
		),
	).toEqual({ code: "CCCC-CCCC" });
	expect(
		nextCodeShown(fresh, { code: "CCCC-CCCC", expiresAt: at }, [], 0),
	).toEqual({
		code: "CCCC-CCCC",
	});
	// Off: no code.
	expect(nextCodeShown(shown, undefined, [], 0)).toEqual({});
});
