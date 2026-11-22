import { expect, test } from "bun:test";
import { type Case, MAX_COMMENT } from "../src/lib/case.ts";
import type { MarkRequest } from "../src/lib/messages.ts";
import { markChange } from "../src/sidepanel/mark-change.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";

type Command = Exclude<MarkRequest, { type: "mark:picked" | "mark:add-image" }>;
const ids = { caseId: "c_1", markId: "m1" };

/** The case after the popover's command, as the panel stores it. */
function after(c: Case, request: Command, now = "2026-11-20T10:00:00Z"): Case {
	const made = markChange(request, now);
	if ("error" in made) throw new Error(made.error);
	return made.change(c, "m1").value;
}

test("the popover's Resolve…, Verified and Reopen… change the mark as the panel's buttons do (DEC-027)", () => {
	const c = withOneMark(sampleCase("c_1"));
	const fixed = after(c, {
		type: "mark:resolve",
		...ids,
		kind: "fixed",
		note: "Darker text",
	});
	expect(fixed.marks[0]?.resolution).toMatchObject({
		kind: "fixed",
		note: "Darker text",
	});
	const verified = after(fixed, { type: "mark:verify", ...ids });
	expect(verified.marks[0]?.resolution?.verified).toBeDefined();
	const reopened = after(verified, {
		type: "mark:reopen",
		...ids,
		note: "Still pale on hover",
	});
	expect(reopened.marks[0]?.resolution).toBeUndefined();
	expect(reopened.marks[0]?.reopens?.at(-1)?.note).toBe("Still pale on hover");
	const commented = after(reopened, {
		type: "mark:comment",
		...ids,
		text: "Paler still",
	});
	expect(commented.marks[0]?.comment).toBe("Paler still");
	const made = markChange({ type: "mark:delete", ...ids }, "t");
	if ("error" in made) throw new Error(made.error);
	expect(made.change(commented, "m1").value.marks).toEqual([]);
});

test("a reopen without what is still wrong, or a comment too long, is refused before anything is stored", () => {
	expect(markChange({ type: "mark:reopen", ...ids, note: "  " }, "t")).toEqual({
		error: "Say what is still wrong.",
	});
	expect(
		markChange(
			{ type: "mark:comment", ...ids, text: "x".repeat(MAX_COMMENT + 1) },
			"t",
		),
	).toEqual({ error: "That comment is too long." });
});

test("Reopen… on a mark opened meanwhile stores nothing and says the note is not saved", () => {
	const open = withOneMark(sampleCase("c_1"));
	expect(() =>
		after(open, { type: "mark:reopen", ...ids, note: "Still pale" }),
	).toThrow("Your note is not saved");
});
