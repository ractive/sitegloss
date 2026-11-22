import { expect, test } from "bun:test";
import {
	CODE_USED_WAIT_MS,
	type CodeShown,
	CodeWatch,
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

test("a used code's wait ends on time with no panel open, so a panel opened later shows the next code", () => {
	let now = 0;
	const timers = new Map<number, { at: number; run: () => void }>();
	let ids = 0;
	let changed = 0;
	const watch = new CodeWatch(
		{
			now: () => now,
			setTimer: (run, ms) => {
				timers.set(++ids, { at: now + ms, run });
				return ids as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimer: (t) => void timers.delete(t as unknown as number),
		},
		() => changed++,
	);
	const at = "2026-11-22T10:00:00Z";
	const used = (code: string) => ({
		code,
		expiresAt: at,
		reason: "used" as const,
	});
	watch.update({ code: "AAAA-AAAA", expiresAt: at, reason: "start" }, []);
	// Typed in (by the fill, say) while no panel reads the state.
	now = 1000;
	watch.update(used("BBBB-BBBB"), []);
	expect(watch.shown.code).toBe("AAAA-AAAA");
	// Another used code in the wait keeps the one timer.
	watch.update(used("CCCC-CCCC"), []);
	expect(timers.size).toBe(1);
	// No app came: the timer ends the wait and says so.
	now = 1000 + CODE_USED_WAIT_MS + 1;
	for (const [id, t] of [...timers]) {
		expect(t.at).toBeLessThanOrEqual(now);
		timers.delete(id);
		t.run();
	}
	expect(changed).toBe(1);
	expect(timers.size).toBe(0);
	// The panel opens now: the next code, not "used".
	expect(watch.shown).toEqual({ code: "CCCC-CCCC" });

	// An app that connects in the wait ends it, timer and all.
	watch.update(used("DDDD-DDDD"), []);
	expect(watch.shown.used).toBeDefined();
	watch.update(used("DDDD-DDDD"), ["g1"]);
	expect(watch.shown).toEqual({ code: "DDDD-DDDD" });
	expect(timers.size).toBe(0);
	// Another connection: nothing kept.
	watch.update(used("EEEE-EEEE"), ["g1"]);
	watch.stop();
	expect(watch.shown).toEqual({});
	expect(timers.size).toBe(0);
});
