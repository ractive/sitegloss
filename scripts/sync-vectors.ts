/**
 * Copies the server's shared test vectors and its OpenAPI document from a
 * checkout of sitegloss.dev into this repository, byte for byte, and records
 * their hashes and the commit they come from in `test/vectors.json`:
 *
 *   bun scripts/sync-vectors.ts [<sitegloss.dev checkout>]   (default ../sitegloss.dev)
 *
 * The server lists every file another codebase copies, with its SHA-256, in
 * `packages/api/vectors/manifest.json`. Each file must have the hash the
 * manifest gives, or nothing is copied (a vector changed there without
 * `bun run --filter @sitegloss/api manifest`). A vector goes to `test/<name>`,
 * `openapi/v1.json` to `src/lib/cloud/openapi-v1.json`, whose types
 * (`api.gen.ts`) are then written again (`scripts/api-types.ts`).
 * `test/vectors.test.ts` fails on a copy whose bytes are not the recorded
 * ones: a copy is never edited by hand, only synced.
 */

import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SPEC, TYPES, typesOf } from "./api-types.ts";

const ROOT = join(import.meta.dir, "..");

/** Where this repository keeps the records of the copies. */
export const RECORD = "test/vectors.json";

/** Where this repository keeps the copy of a file of the server's packages/api. */
export function placeOf(path: string): string {
	if (path === "openapi/v1.json") return "src/lib/cloud/openapi-v1.json";
	const vector = /^vectors\/([a-z0-9-]+\.json)$/.exec(path);
	if (vector) return `test/${vector[1]}`;
	throw new Error(
		`the server's manifest names a file this script does not place: ${path}`,
	);
}

export async function sha256Of(file: string): Promise<string> {
	const bytes = await Bun.file(file).bytes();
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export interface VectorRecord {
	about: string;
	/** The commit of sitegloss.dev the files were copied from (`git rev-parse HEAD` there). */
	commit: string;
	/** Each copy's path in this repository, with the SHA-256 of its bytes (the server's manifest's). */
	files: { [path: string]: string };
}

if (import.meta.main) {
	const service = resolve(ROOT, process.argv[2] ?? "../sitegloss.dev");
	const api = join(service, "packages/api");
	const manifest = (await Bun.file(
		join(api, "vectors/manifest.json"),
	).json()) as {
		files: { [path: string]: string };
	};
	const git = (...args: string[]) =>
		Bun.spawnSync(["git", "-C", service, ...args], { stderr: "ignore" })
			.stdout.toString()
			.trim();
	const commit = git("rev-parse", "HEAD");
	if (commit === "") {
		console.error(`${service} is not a git checkout of sitegloss.dev.`);
		process.exit(1);
	}
	// Copied from changes not committed there, the record names a commit that does not have them.
	if (
		git(
			"status",
			"--porcelain",
			"--",
			"packages/api/vectors",
			"packages/api/openapi",
		) !== ""
	)
		console.warn(
			`Warning: ${service} has uncommitted changes in packages/api/vectors or openapi; commit them there, then sync again.`,
		);
	const files: { [path: string]: string } = {};
	const stale: string[] = [];
	for (const [path, sha] of Object.entries(manifest.files)) {
		if ((await sha256Of(join(api, path))) !== sha) stale.push(path);
		files[placeOf(path)] = sha;
	}
	if (stale.length > 0) {
		console.error(
			`${service}: the manifest is not what these files are: ${stale.join(", ")}. Run bun run --filter @sitegloss/api manifest there first.`,
		);
		process.exit(1);
	}
	for (const path of Object.keys(manifest.files))
		await Bun.write(join(ROOT, placeOf(path)), Bun.file(join(api, path)));
	// A copy of a file the server no longer lists goes (its vectors only grow, so rarely).
	const before = Bun.file(join(ROOT, RECORD));
	if (await before.exists())
		for (const path of Object.keys(
			((await before.json()) as VectorRecord).files,
		))
			if (!(path in files)) await rm(join(ROOT, path), { force: true });
	const record: VectorRecord = {
		about:
			"The SHA-256 of each copy of a file of sitegloss.dev's packages/api (its vectors/manifest.json): the shared test vectors and the OpenAPI document. Written by bun scripts/sync-vectors.ts; test/vectors.test.ts fails on a copy whose bytes are not these.",
		commit,
		files,
	};
	await Bun.write(
		join(ROOT, RECORD),
		`${JSON.stringify(record, null, "\t")}\n`,
	);
	await Bun.write(TYPES, await typesOf(SPEC));
	console.log(
		`Copied ${Object.keys(files).length} files from ${service}, wrote ${RECORD} and src/lib/cloud/api.gen.ts`,
	);
}
