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

// The panel has no text for one mark yet; once it has `markInstructions`, it is held to the vector too.
const markInstructions = (instructions as Record<string, unknown>)[
	"markInstructions"
] as
	| ((ref: { id: string; url: string }, mark: { number: number }) => string)
	| undefined;

test.skipIf(markInstructions === undefined)(
	"the text for one mark is the web app's, word for word",
	() => {
		const { id, url } = vector.mark.ref;
		expect(markInstructions?.({ id, url }, vector.mark.mark)).toBe(
			vector.mark.text,
		);
	},
);
