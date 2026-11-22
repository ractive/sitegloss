import { expect, test } from "bun:test";
import { MAX_LINK } from "../src/lib/case.ts";
import { linkFromField } from "../src/sidepanel/case-link.ts";

test("the link field: a link is stored cleaned, an empty one removes it, other text says why (DEC-028)", () => {
	expect(linkFromField(" https://tickets.example.com/browse/ABC-123 ")).toEqual(
		{ link: "https://tickets.example.com/browse/ABC-123" },
	);
	expect(linkFromField("   ")).toEqual({ link: undefined });
	expect(linkFromField("javascript:alert(1)")).toEqual({
		error: "A link starts with https:// or http://",
	});
	expect(linkFromField(`https://example.com/${"a".repeat(MAX_LINK)}`)).toEqual({
		error: `A link has at most ${MAX_LINK} characters.`,
	});
});
