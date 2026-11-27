import { expect, test } from "bun:test";
import { join } from "node:path";
import { RECORD, sha256Of } from "../scripts/sync-vectors.ts";

const ROOT = join(import.meta.dir, "..");
const record = (await Bun.file(join(ROOT, RECORD)).json()) as {
	files: { [path: string]: string };
};

test("every copy of the server's vectors and OpenAPI document has the bytes it was synced with", async () => {
	// A difference: a copy was edited here. Change the server's file and run bun scripts/sync-vectors.ts.
	const differ: string[] = [];
	for (const [path, sha] of Object.entries(record.files))
		if ((await sha256Of(join(ROOT, path))) !== sha) differ.push(path);
	expect(differ).toEqual([]);
});
