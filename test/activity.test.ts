import { describe, expect, test } from "bun:test";
import { BUSY, PageActivity } from "../src/content/activity.ts";

describe("PageActivity", () => {
	test("a mark's screenshot holds the page; the toolbar need not wait for it", () => {
		const a = new PageActivity();
		expect(a.busy).toBeUndefined();
		expect(a.begin("shot")).toEqual({ ok: true });
		expect(a.saving).toBe(false);
		expect(a.busy).toBe(BUSY.shot);
		expect(a.begin("ai-mark")).toEqual({ ok: false, error: BUSY.shot });
		expect(a.defer({ kind: "hide" })).toBe(false);
		expect(a.end("shot")).toBeUndefined();
		expect(a.busy).toBeUndefined();
	});

	test("one activity at a time; the others are refused with a reason", () => {
		const a = new PageActivity();
		expect(a.begin("saving")).toEqual({ ok: true });
		expect(a.saving).toBe(true);
		expect(a.begin("ai-mark")).toEqual({ ok: false, error: BUSY.saving });
		expect(a.begin("ai-capture")).toEqual({ ok: false, error: BUSY.saving });
		expect(a.end("saving")).toEqual({ kind: "stay" });
		expect(a.begin("ai-capture")).toEqual({ ok: true });
		expect(a.begin("saving")).toEqual({ ok: false, error: BUSY["ai-capture"] });
		// Ending another activity than the current one changes nothing.
		expect(a.end("ai-mark")).toBeUndefined();
		expect(a.now.kind).toBe("ai-capture");
		a.end("ai-capture");
		expect(a.now.kind).toBe("idle");
	});

	test("what arrives during a save is done afterwards; the last request wins", () => {
		const a = new PageActivity();
		expect(a.defer({ kind: "hide" })).toBe(false); // nothing to wait for
		a.begin("saving");
		expect(a.defer({ kind: "hide" })).toBe(true);
		const target = { caseId: "c_1", title: "One", nextMark: 1 };
		expect(
			a.defer({ kind: "show", options: { target, blurForms: true } }),
		).toBe(true);
		expect(a.end("saving")).toEqual({
			kind: "show",
			options: { target, blurForms: true },
		});
	});

	test("an abandoned AI screenshot ends by itself", async () => {
		const a = new PageActivity();
		let cleaned = 0;
		a.begin("ai-mark", () => cleaned++, 10);
		expect(a.begin("saving").ok).toBe(false);
		await Bun.sleep(30);
		expect(cleaned).toBe(1);
		expect(a.now.kind).toBe("idle");
		expect(a.begin("saving").ok).toBe(true);
	});

	test("an AI screenshot that ends in time is not cleaned up twice", async () => {
		const a = new PageActivity();
		let cleaned = 0;
		a.begin("ai-capture", () => cleaned++, 10);
		a.end("ai-capture");
		await Bun.sleep(30);
		expect(cleaned).toBe(0);
	});
});
