import { describe, expect, test } from "bun:test";
import {
	jsonText,
	markLine,
	markOverview,
	type OverviewCase,
	type OverviewQuery,
	overviewCase,
	quote,
	quoteStart,
} from "../src/lib/overview.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";
import vectors from "./mark-overview.json" with { type: "json" };

// test/mark-overview.json is sitegloss.dev's packages/api/vectors/mark-overview.json.
describe("the overview of a case's marks: the server's lines, held to its own vectors", () => {
	test("quote, quoteStart and jsonText give every string in the vectors", () => {
		for (const v of vectors.quote) expect(quote(v.text)).toBe(v.quoted);
		for (const v of vectors.quoteStart)
			expect(quoteStart(v.text, v.limit)).toBe(v.quoted);
		for (const v of vectors.jsonText) {
			expect(jsonText(v.value)).toBe(v.json);
			expect(JSON.parse(jsonText(v.value))).toEqual(v.value);
		}
	});

	test("markLine gives each mark's line", () => {
		const found = vectors.case as OverviewCase;
		for (const v of vectors.lines) {
			const mark = found.marks.find((m) => m.number === v.mark);
			expect(mark && markLine(found, mark)).toBe(v.line);
		}
	});

	test("markOverview gives every page of lines, and a mark longer than the budget alone", () => {
		const found = vectors.case as OverviewCase;
		for (const v of vectors.overviews) {
			const page = markOverview(found, v.query as OverviewQuery);
			expect([v.query, page.lines]).toEqual([v.query, v.lines]);
			expect(page.next).toBe(v.next);
		}
		expect(markOverview(vectors.long.case as OverviewCase, {}).lines).toEqual(
			vectors.long.overview,
		);
	});

	test("a case of this browser reads as the server's: its pages, statuses, kinds and the comments on each mark", () => {
		const c = withOneMark(sampleCase("c_view"));
		const lines = markOverview(
			overviewCase({
				...c,
				comments: [
					{ id: "k_1", text: "On it", at: "2026-11-25T10:00:00Z", mark: "m1" },
				],
			}),
			{ status: "all" },
		).lines;
		expect(lines[2]).toBe(
			'#1 open p1 note · no element · 1 comment · "Too pale"',
		);
	});
});
