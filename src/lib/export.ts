/**
 * A case as a zip (`case.json`, `case.md`, `shots/`, `crops/`, `images/`) and back; and
 * all cases as one zip, a folder per case in that layout (DEC-020).
 */

import {
	type Case,
	CaseError,
	caseImages,
	importedResolution,
	MAX_MARK_IMAGES,
	MAX_MARKS,
	MAX_SHOTS,
	MAX_TITLE,
	newId,
	plainUrl,
	shapeOut,
	validateCase,
	withPagesAgreed,
} from "./case.ts";
import { webpSize } from "./image-size.ts";
import { caseMarkdown } from "./markdown.ts";
import { queryOf } from "./query.ts";
import type { CaseStore, StoredImage } from "./store.ts";
import { readZip, writeZip, type ZipEntry } from "./zip.ts";

export { webpSize };

export const EXPORT_SUFFIX = ".sitegloss.zip";

/** `login-button-contrast`: a case's title as a file or folder name. */
function slugOf(c: Case): string {
	const slug = c.title
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/, "");
	return slug || "case";
}

/** `login-button-contrast.sitegloss.zip` */
export function exportFileName(c: Case): string {
	return `${slugOf(c)}${EXPORT_SUFFIX}`;
}

/** `sitegloss-cases-2026-11-12.sitegloss.zip`, by the local date. */
export function exportAllFileName(now = new Date()): string {
	const two = (n: number) => String(n).padStart(2, "0");
	return `sitegloss-cases-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}${EXPORT_SUFFIX}`;
}

/** The largest export of one case the side panel reads. */
export const MAX_IMPORT_BYTES = 150 * 1024 * 1024;
/**
 * The largest file of all cases the side panel reads (and writes), and the
 * most all its cases may unpack to together.
 */
export const MAX_IMPORT_ALL_BYTES = 256 * 1024 * 1024;

/** The limits of a file of all cases (smaller in tests). */
export interface FileLimits {
	/** The most one case in it may unpack to. */
	maxCaseBytes: number;
	/** The largest file, and the most all its cases may unpack to together. */
	maxAllBytes: number;
}

const LIMITS: FileLimits = {
	maxCaseBytes: MAX_IMPORT_BYTES,
	maxAllBytes: MAX_IMPORT_ALL_BYTES,
};

const mb = (bytes: number) => `${bytes / 1024 / 1024} MB`;

/** A file of a case, its data as a Blob: an image as stored, not read yet. */
interface CaseFile {
	name: string;
	data: Blob;
}

/**
 * `c` without this browser's notes for its sync (DEC-046): which AI app made
 * the case, its last change, a mark's last change, a comment's delete. A
 * file carries none of them, in or out: sent, they would claim an app did
 * what the person does.
 */
function withoutSyncNotes(c: Case): Case {
	// An assignment that waits to be sent too (DEC-071): from a file it
	// would be sent as the person's doing, to a team it may not be of.
	const {
		via: _v,
		createdVia: _c,
		deletedVia: _d,
		assign: _a,
		assignRefused: _r,
		...rest
	} = c;
	return {
		...rest,
		// Images held back are this browser's too (DEC-058): not in a file.
		marks: rest.marks.map(({ via: _a, heldImages: _h, ...a }) => a),
	};
}

/** The hand-over's records of `c` (DEC-071), as they are. */
const handOverOf = (c: Case): Partial<Case> => ({
	...(c.createdBy === undefined ? {} : { createdBy: c.createdBy }),
	...(c.assignee === undefined ? {} : { assignee: c.assignee }),
	...(c.assignedBy === undefined ? {} : { assignedBy: c.assignedBy }),
});

/** A case's files, each name after `folder` (`""`: at the top), case.json first. */
async function caseFiles(
	store: CaseStore,
	c: Case,
	folder: string,
): Promise<CaseFile[]> {
	// Which app made the last change is this browser's note for its sync
	// (DEC-046), not part of the case: a file never carries it. A shape of a
	// kind this version does not know goes out as it came (DEC-066).
	const kept = withoutSyncNotes(c);
	const written = {
		...kept,
		marks: kept.marks.map((a) =>
			a.shape.kind === "unknown" ? { ...a, shape: shapeOut(a.shape) } : a,
		),
	};
	const files: CaseFile[] = [
		{
			name: `${folder}case.json`,
			data: new Blob([`${JSON.stringify(written, null, "\t")}\n`]),
		},
		{ name: `${folder}case.md`, data: new Blob([caseMarkdown(c)]) },
	];
	for (const path of caseImages(c)) {
		const image = await store.getImage(c.id, path);
		if (image === undefined)
			throw new CaseError(`the image ${path} of “${c.title}” is missing`);
		files.push({ name: `${folder}${path}`, data: image.blob });
	}
	return files;
}

async function entriesOf(files: readonly CaseFile[]): Promise<ZipEntry[]> {
	const entries: ZipEntry[] = [];
	for (const f of files)
		entries.push({
			name: f.name,
			data: new Uint8Array(await f.data.arrayBuffer()),
		});
	return entries;
}

export async function exportCase(
	store: CaseStore,
	c: Case,
): Promise<Uint8Array> {
	return writeZip(await entriesOf(await caseFiles(store, c, "")));
}

/**
 * The folder of each case in a file of all cases, in their order: its title
 * as a file name, with `-2`, `-3` for a title that comes again.
 */
export function caseFolders(cases: readonly Case[]): string[] {
	const used = new Set<string>();
	return cases.map((c) => {
		const slug = slugOf(c);
		let name = slug;
		for (let n = 2; used.has(name); n++) name = `${slug}-${n}`;
		used.add(name);
		return name;
	});
}

/** “A”, “A” and “B”, “A”, “B” and “C” */
function titles(cases: readonly Case[]): string {
	const quoted = cases.map((c) => `“${c.title}”`);
	const last = quoted.pop();
	return quoted.length === 0 ? `${last}` : `${quoted.join(", ")} and ${last}`;
}

/**
 * Every case in one zip: a folder per case, each as `exportCase` lays it out.
 * A file the panel would refuse to import again is no use, so the sizes are
 * checked first, from what is stored, against what `readExports` reads: each
 * case, all of them, and the file itself with its headers.
 */
export async function exportAllCases(
	store: CaseStore,
	cases: readonly Case[],
	limits: FileLimits = LIMITS,
): Promise<Uint8Array> {
	if (cases.length === 0) throw new CaseError("There are no cases to export.");
	const folders = caseFolders(cases);
	const files: CaseFile[] = [];
	const tooLarge: Case[] = [];
	let bytes = 0;
	for (const [i, c] of cases.entries()) {
		const own = await caseFiles(store, c, `${folders[i]}/`);
		const size = own.reduce((n, f) => n + f.data.size, 0);
		if (
			size > limits.maxCaseBytes ||
			(own[0]?.data.size ?? 0) > MAX_CASE_JSON_BYTES
		)
			tooLarge.push(c);
		bytes += size;
		files.push(...own);
	}
	if (tooLarge.length > 0)
		throw new CaseError(
			`${titles(tooLarge)} ${tooLarge.length === 1 ? "is" : "are"} too large to be imported again (more than ${mb(limits.maxCaseBytes)}${tooLarge.length === 1 ? "" : " each"}). Export the other cases one at a time.`,
		);
	const tooMuch = new CaseError(
		`All cases together are larger than ${mb(limits.maxAllBytes)}. Export them one at a time.`,
	);
	if (bytes > limits.maxAllBytes) throw tooMuch;
	let entries: ZipEntry[] | undefined = await entriesOf(files);
	const zip = await writeZip(entries);
	// Not kept beside the file while it is checked and saved.
	entries = undefined;
	// With the zip's headers: the panel checks the file's own size.
	if (zip.length > limits.maxAllBytes) throw tooMuch;
	return zip;
}

/**
 * The most entries one case's file may have: what the format allows, its
 * screenshots, each mark's crop and the images it holds (DEC-058), case.json
 * and case.md.
 */
export const MAX_CASE_ENTRIES =
	MAX_SHOTS + MAX_MARKS * (1 + MAX_MARK_IMAGES) + 2;

/** case.json is text about marks; a real one is far smaller than this. */
export const MAX_CASE_JSON_BYTES = 20 * 1024 * 1024;
/** Limits per imported image: larger ones are no Sitegloss screenshot. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16_384;
export const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

/** An export read and checked, not stored yet. */
export interface ParsedExport {
	case: Case;
	images: Map<string, StoredImage>;
}

/**
 * A case of a file of all cases, read and checked; its images stay packed in
 * the file until it is stored, and are unpacked and checked again then.
 */
export interface CheckedExport {
	case: Case;
	images(): Promise<Map<string, StoredImage>>;
}

/** Entries in any one file of all cases: the zip format's own limit. */
const MAX_ALL_ENTRIES = 0xffff;

/** The case in `folder` (`""`: at the top), and how many bytes its case.json unpacked to. */
async function readCaseJson(
	zip: Uint8Array,
	folder: string,
	maxEntries: number,
): Promise<{ c: Case; bytes: number }> {
	const json = (
		await readZip(zip, {
			maxEntries,
			maxTotalBytes: MAX_CASE_JSON_BYTES,
			include: (n) => n === `${folder}case.json`,
		})
	).get(`${folder}case.json`);
	if (json === undefined)
		throw new CaseError(
			"This is not a Sitegloss export: case.json is missing.",
		);
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(json));
	} catch {
		throw new CaseError("case.json is not valid JSON.");
	}
	return { c: validateCase(parsed), bytes: json.length };
}

/**
 * Unpack and check the images of `c` in `folder`, at most `maxBytes` of them;
 * as Blobs only when `keep` (else they are checked and let go), and how many
 * bytes they unpacked to.
 */
async function readImages(
	zip: Uint8Array,
	folder: string,
	c: Case,
	limits: { maxEntries: number; maxBytes: number; keep: boolean },
): Promise<{ images: Map<string, StoredImage>; bytes: number }> {
	const wanted = caseImages(c);
	const files = await readZip(zip, {
		maxEntries: limits.maxEntries,
		maxTotalBytes: limits.maxBytes,
		include: (n) => n.startsWith(folder) && wanted.has(n.slice(folder.length)),
	});
	const images = new Map<string, StoredImage>();
	let bytes = 0;
	for (const path of wanted) {
		const data = files.get(`${folder}${path}`);
		if (data === undefined) throw new CaseError(`The export lacks ${path}.`);
		bytes += data.length;
		const size = webpSize(data);
		if (size === undefined) throw new CaseError(`${path} is not a WebP image.`);
		if (
			data.length > MAX_IMAGE_BYTES ||
			size.width < 1 ||
			size.height < 1 ||
			size.width > MAX_IMAGE_SIDE ||
			size.height > MAX_IMAGE_SIDE ||
			size.width * size.height > MAX_IMAGE_PIXELS
		)
			throw new CaseError(
				`${path} is too large for ${path.startsWith("images/") ? "an image" : "a screenshot"}.`,
			);
		if (limits.keep)
			images.set(path, {
				blob: new Blob([data as Uint8Array<ArrayBuffer>], {
					type: "image/webp",
				}),
				...size,
			});
	}
	return { images, bytes };
}

/** Read and check an exported case without touching the store. */
export async function readExport(
	zip: Uint8Array,
	maxBytes = MAX_IMPORT_BYTES,
): Promise<ParsedExport> {
	if (zip.length > maxBytes)
		throw new CaseError(`The file is larger than ${mb(maxBytes)}.`);
	const { c } = await readCaseJson(zip, "", MAX_CASE_ENTRIES);
	const { images } = await readImages(zip, "", c, {
		maxEntries: MAX_CASE_ENTRIES,
		maxBytes,
		keep: true,
	});
	return { case: c, images };
}

/** `login/case.json` → `login/`; `undefined` for a name at the top. */
const folderOf = (name: string) => /^[^/]+\//.exec(name)?.[0];

/**
 * Read and check a file with one case (`exportCase`) or all of them
 * (`exportAllCases`): one case for a `case.json` at the top, else one for
 * each `<folder>/case.json`. One bad case refuses the whole file, so every
 * case is checked first, and the images are let go again: each case's are
 * unpacked once more when it is stored, one case at a time. What the file
 * unpacks to is counted for the whole file, never more than the limit for all
 * cases: by the sizes its entries declare before anything is unpacked, and by
 * what each case did unpack to.
 */
export async function readExports(
	zip: Uint8Array,
	limits: FileLimits = LIMITS,
): Promise<CheckedExport[]> {
	if (zip.length > limits.maxAllBytes)
		throw new CaseError(`The file is larger than ${mb(limits.maxAllBytes)}.`);
	// Only the names and the sizes they declare: nothing is unpacked.
	const listed: { name: string; size: number }[] = [];
	await readZip(zip, {
		maxEntries: MAX_ALL_ENTRIES,
		include: (name, size) => {
			listed.push({ name, size });
			return false;
		},
	});
	if (listed.some((e) => e.name === "case.json")) {
		const one = await readExport(zip, limits.maxCaseBytes);
		return [{ case: one.case, images: async () => one.images }];
	}
	const folders = listed.flatMap(
		(e) => /^([^/]+\/)case\.json$/.exec(e.name)?.[1] ?? [],
	);
	if (folders.length === 0)
		throw new CaseError(
			"This is not a Sitegloss export: case.json is missing.",
		);
	const tooMuch = new CaseError(
		`The cases in the file unpack to more than ${mb(limits.maxAllBytes)}.`,
	);
	// An entry never unpacks to more than it declares (readZip stops it there).
	const inCases = new Set(folders);
	let declared = 0;
	for (const e of listed) {
		const folder = folderOf(e.name);
		if (folder !== undefined && inCases.has(folder)) declared += e.size;
	}
	if (declared > limits.maxAllBytes) throw tooMuch;
	const cases: CheckedExport[] = [];
	const ids = new Set<string>();
	let unpacked = 0;
	const inFolder = async <T>(folder: string, read: () => Promise<T>) => {
		try {
			return await read();
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			throw new CaseError(`In ${folder}: ${why}`);
		}
	};
	for (const folder of folders) {
		const imagesOf = (c: Case, keep: boolean) =>
			readImages(zip, folder, c, {
				maxEntries: MAX_ALL_ENTRIES,
				maxBytes: limits.maxCaseBytes,
				keep,
			});
		const c = await inFolder(folder, async () => {
			const json = await readCaseJson(zip, folder, MAX_ALL_ENTRIES);
			unpacked += json.bytes + (await imagesOf(json.c, false)).bytes;
			return json.c;
		});
		if (unpacked > limits.maxAllBytes) throw tooMuch;
		if (ids.has(c.id))
			throw new CaseError(
				`The file holds the case ${c.id} twice (in ${folder}).`,
			);
		ids.add(c.id);
		cases.push({
			case: c,
			images: () =>
				inFolder(folder, async () => (await imagesOf(c, true)).images),
		});
	}
	return cases;
}

/**
 * Store a read export: replacing a case with the same id, or as a copy with
 * a new id. Either everything is stored or nothing changes. It is marked as
 * imported, whatever the file says, and keeps no more of the page's address
 * than a saved case does. Its findings are no AI app's own: the app a finding
 * names is whatever the file says (DEC-019), as are who set a mark's status
 * and when (DEC-023).
 */
export async function storeImport(
	store: CaseStore,
	parsed: ParsedExport | CheckedExport,
	options: {
		copy?: boolean;
		now?: Date;
		/**
		 * Re-encodes an image added to a mark (DEC-058), as the dialog does:
		 * a file's own may carry metadata or an animation. Where there is no
		 * canvas (tests), the file's bytes are kept.
		 */
		reencode?: (image: Blob) => Promise<StoredImage>;
	} = {},
): Promise<Case> {
	const unpacked =
		parsed.images instanceof Map ? parsed.images : await parsed.images();
	const images = new Map(unpacked);
	if (options.reencode !== undefined)
		for (const [path, image] of unpacked) {
			if (!path.startsWith("images/")) continue;
			try {
				images.set(path, await options.reencode(image.blob));
			} catch {
				throw new CaseError(`${path} is not an image Sitegloss can read.`);
			}
		}
	// `page`, the list and the screenshots are made to agree (DEC-038):
	// nothing in a file says they do.
	const {
		comments: _fileThread,
		// The hand-over's records (DEC-071) are the server's word on one case:
		// a copy is another case, which nobody started or was given yet; a
		// case put in place of one here keeps that one's.
		createdBy: _by,
		assignee: _to,
		assignedBy: _from,
		...fromFile
	} = withoutSyncNotes(parsed.case);
	// A file put in place of a case here replaces its marks and screenshots,
	// not its thread (DEC-046): the thread is the conversation the case has
	// here (and with the team), and a file is a copy of an earlier moment.
	// Taken from the file, it would delete what was written since, or put
	// an old text back in place of a teammate's newer one.
	const existing = options.copy
		? undefined
		: await store.getCase(parsed.case.id);
	const c: Case = withPagesAgreed({
		...fromFile,
		...(options.copy
			? {
					id: newId("c"),
					title: `${parsed.case.title.slice(0, MAX_TITLE - COPY.length)}${COPY}`,
				}
			: {}),
		// Who wrote a comment is what the file says (DEC-046). A comment's id
		// is the server's too, taken there by the original's: a copy's
		// comments are new ones.
		...(options.copy
			? {}
			: handOverOf(existing ?? withoutSyncNotes(parsed.case))),
		...(existing !== undefined
			? {
					...(existing.comments === undefined
						? {}
						: { comments: existing.comments }),
					...(existing.assign === undefined ? {} : { assign: existing.assign }),
					...(existing.deletedVia === undefined
						? {}
						: { deletedVia: existing.deletedVia }),
				}
			: parsed.case.comments === undefined
				? {}
				: {
						comments: (options.copy
							? parsed.case.comments.map((k) => ({ ...k, id: newId("k") }))
							: parsed.case.comments
						).map((k) => ({ ...k, imported: true as const })),
					}),
		page: { ...parsed.case.page, url: plainUrl(parsed.case.page.url) },
		// The other pages' addresses too (DEC-038): its list's and its screenshots'.
		...(parsed.case.pages === undefined
			? {}
			: {
					pages: parsed.case.pages.map((p) => ({
						...p,
						url: plainUrl(p.url),
					})),
				}),
		// A screenshot's query is kept as `keptQuery` leaves it (DEC-050): the
		// file's `query`, filtered again by `validateCase`, else what may be
		// kept of the query on its address (a file from elsewhere).
		shots: parsed.case.shots.map((s) => {
			if (s.url === undefined) return s;
			const query = s.query ?? queryOf(s.url);
			return {
				...s,
				url: plainUrl(s.url),
				...(query === undefined ? {} : { query }),
			};
		}),
		// The app that made a mark is the server's record, which a file only
		// claims (DEC-046): it would be sent as the app's doing.
		marks: parsed.case.marks.map(({ createdVia: _cv, ...a }) => ({
			...a,
			...(a.findings === undefined
				? {}
				: { findings: a.findings.map((f) => ({ ...f, imported: true })) }),
			// An image keeps the file's time and names nobody (DEC-058): who
			// added it is only what the file claims.
			...(a.images === undefined
				? {}
				: {
						images: a.images.map((x) => ({
							...x,
							added: { at: x.added.at, imported: true as const },
						})),
					}),
			// Who set a status and when is what the file says (DEC-023).
			...(a.resolution === undefined
				? {}
				: { resolution: importedResolution(a.resolution) }),
			...(a.reopens === undefined
				? {}
				: {
						reopens: a.reopens.map((r) => ({
							...r,
							was: importedResolution(r.was),
							imported: true as const,
						})),
					}),
		})),
		importedAt: (options.now ?? new Date()).toISOString(),
	});
	// A comment kept from here about a mark the file does not have: about a
	// deleted mark.
	const live = new Set(c.marks.map((a) => a.id));
	const value: Case =
		c.comments === undefined
			? c
			: {
					...c,
					comments: c.comments.map(({ mark, ...k }) =>
						mark === undefined || live.has(mark)
							? { ...k, ...(mark === undefined ? {} : { mark }) }
							: { ...k, markGone: true as const },
					),
				};
	await store.replaceCase(value, images);
	return value;
}

const COPY = " (copy)";
