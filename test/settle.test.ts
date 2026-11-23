import { expect, test } from "bun:test";
import { settledLoaded } from "../src/sidepanel/settle.ts";

test("a draw that stopped is no longer settling: only that case's on that tab (DEC-064's second review)", () => {
	const loaded = {
		caseId: "c_1",
		tabId: 7,
		url: "https://shop.example/cart",
		matches: new Map(),
		settling: true,
	};
	expect(settledLoaded(loaded, "c_1", 7)?.settling).toBe(false);
	expect(settledLoaded(loaded, "c_2", 7)).toBeUndefined();
	expect(settledLoaded(loaded, "c_1", 8)).toBeUndefined();
	expect(
		settledLoaded({ ...loaded, settling: false }, "c_1", 7),
	).toBeUndefined();
	expect(settledLoaded(undefined, "c_1", 7)).toBeUndefined();
});
