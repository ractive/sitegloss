import { describe, expect, test } from "bun:test";
import { validateCase } from "../src/lib/case.ts";
import { MemoryStore, upgradeStoredCase } from "../src/lib/store.ts";
import { validateCase as validateCase030 } from "./case-0-3-0.ts";
import { sampleCase } from "./fixtures.ts";
import { storeContract } from "./store-contract.ts";

describe("MemoryStore", () => {
	for (const [name, run] of Object.entries(storeContract))
		test(name, () => run(new MemoryStore()));
});

/** A case as Sitegloss 0.3.0 stored it: its own validateCase's result. */
function storedBy030(): Record<string, unknown> {
	const {
		format: _format,
		marks,
		...rest
	} = JSON.parse(JSON.stringify(sampleCase()));
	return validateCase030({
		format: "sitegloss/1",
		...rest,
		annotations: marks,
	}) as unknown as Record<string, unknown>;
}

describe("upgradeStoredCase (the store's version 2, DEC-051)", () => {
	test("brings a case 0.3.0 stored to sitegloss/2: the marks under marks, where the old key was, the rest as it is", () => {
		const old = storedBy030();
		expect(old["format"]).toBe("sitegloss/1");
		const marks = old["annotations"];
		expect(marks).toHaveLength(sampleCase().marks.length);
		const upgraded = upgradeStoredCase(old) as Record<string, unknown>;
		expect(upgraded["format"]).toBe("sitegloss/2");
		expect(upgraded["marks"]).toBe(marks);
		expect("annotations" in upgraded).toBe(false);
		expect(Object.keys(upgraded)).toEqual(
			Object.keys(old).map((k) => (k === "annotations" ? "marks" : k)),
		);
		for (const key of Object.keys(old))
			if (key !== "annotations" && key !== "format")
				expect(upgraded[key]).toBe(old[key]);
		// A case of this build's format, whole.
		expect(validateCase(upgraded).marks).toHaveLength(
			sampleCase().marks.length,
		);
	});

	test("leaves alone what is no case of the old format", () => {
		const now = sampleCase();
		expect(upgradeStoredCase(now)).toBe(now);
		for (const odd of [
			undefined,
			null,
			42,
			"sitegloss/1",
			["sitegloss/1"],
			{ format: "other/9", annotations: [] },
			{ format: "sitegloss/1", annotations: [], marks: [] },
		])
			expect(upgradeStoredCase(odd)).toBe(odd);
	});
});
