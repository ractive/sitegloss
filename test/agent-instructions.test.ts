import { expect, test } from "bun:test";
import * as instructions from "../src/lib/agent-instructions.ts";
import vector from "./agent-instructions.json" with { type: "json" };

// test/agent-instructions.json is sitegloss.dev's packages/api/vectors/agent-instructions.json:
// the web app's text, word for word, which the panel's copy has to be.

test("the text for a case is the web app's, word for word", () => {
	// The help page's address is built in here; the vector's is the same.
	expect(vector.case.ref.helpUrl).toBe("https://sitegloss.dev/help/#mcp");
	const { id, url } = vector.case.ref;
	expect(instructions.caseInstructions({ id, url })).toBe(vector.case.text);
});

test("the case's id and address are the ref's, not the vector's", () => {
	const text = instructions.caseInstructions({
		id: "c_dev",
		url: "https://app.dev.example/t/acme/cases/c_dev",
	});
	expect(text).toStartWith(
		"Fix the open marks of Sitegloss case c_dev in this repository.\n",
	);
	expect(text).toEndWith(
		"\nThe case for people: https://app.dev.example/t/acme/cases/c_dev",
	);
	expect(text).not.toContain("c_shop");
});

// The panel has no text for one mark yet; once it has `markInstructions`, it is held to the vector too.
const markInstructions = (instructions as Record<string, unknown>)[
	"markInstructions"
] as
	| ((
			ref: { id: string; url: string },
			mark: { number: number; reopened?: boolean },
	  ) => string)
	| undefined;

const forOneMark =
	"the text for one mark, and for one open again after a reopen, is the web app's, word for word";
if (markInstructions === undefined) test.todo(forOneMark);
else
	test(forOneMark, () => {
		for (const { ref, mark, text } of [vector.mark, vector.markReopened])
			expect(markInstructions({ id: ref.id, url: ref.url }, mark)).toBe(text);
	});
