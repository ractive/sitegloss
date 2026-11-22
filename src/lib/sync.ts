/**
 * One-way sync of the cases to files (DEC-021, DEC-025): each case is written
 * as its own file, exactly as Export writes it, and again whenever it
 * changes. The files are a mirror: nothing is read back, and a deleted case
 * keeps its file, so a mistaken delete can be undone with Import a case….
 *
 * Two targets: `Sitegloss/` in Chrome's downloads folder (the default, through
 * `chrome.downloads`, which works with the side panel closed), or a folder the
 * user chose with the picker (the File System Access API; Chrome takes that
 * permission back when the last extension page closes, so a change made
 * meanwhile is written once the user allows access again).
 *
 * The service worker is the one writer (`Sync`); the side panel only chooses
 * the target, stops syncing and gives Chrome's permission again. Every run
 * writes each case whose version differs from what was written.
 */

import { BROWSER, FIREFOX } from "./browser.ts";
import type { Case } from "./case.ts";
import { EXPORT_SUFFIX, exportCase, exportFileName } from "./export.ts";
import type { Kv } from "./kv.ts";
import type { CaseStore } from "./store.ts";

/** The part of a `FileSystemWritableFileStream` the sync uses. */
export interface SyncWritable {
	write(data: Blob): Promise<void>;
	close(): Promise<void>;
	abort(): Promise<void>;
}

/** The part of a `FileSystemFileHandle` the sync uses. */
export interface SyncFileHandle {
	createWritable(): Promise<SyncWritable>;
}

/**
 * The part of a `FileSystemDirectoryHandle` the sync uses; in Chrome a real
 * one, from `showDirectoryPicker` (or the origin's private file system in
 * the end-to-end tests).
 */
export interface SyncFolder {
	readonly name: string;
	getFileHandle(
		name: string,
		options?: { create?: boolean },
	): Promise<SyncFileHandle>;
	removeEntry(name: string): Promise<void>;
	queryPermission(descriptor: {
		mode: "readwrite";
	}): Promise<"granted" | "denied" | "prompt">;
}

/**
 * A folder as the side panel's picker hands it over: it can tell whether it
 * is a folder chosen before.
 */
export interface PickedFolder extends SyncFolder {
	isSameEntry(other: unknown): Promise<boolean>;
}

/** The folder chosen, as the side panel keeps it. */
export interface ChosenFolder {
	handle: SyncFolder;
	/** Its name, for the panel. */
	name: string;
	/**
	 * Which folder this is: a new one gets a new id, so nothing written to
	 * another folder counts for it. Choosing a folder synced before, at any
	 * time, gives it its id back, and with it what was written there.
	 */
	id: string;
}

/**
 * Where the cases go: `Sitegloss/` in the downloads (`downloadsTarget`) or a
 * folder (`folderTarget`). A write that fails for the target as a whole
 * throws `SyncPaused` or `TargetFailed`; any other error is the case's own
 * (it could not be exported), and the other cases are still written.
 */
export interface SyncTarget {
	/** `downloads`, or the folder's id: what was written is kept per target. */
	readonly id: string;
	readonly kind: SyncTargetKind;
	/** Whether it may be written to now; `false` pauses the sync. */
	permission(): Promise<boolean>;
	/** A file of that name there, which Sitegloss may not have written. */
	exists(name: string): Promise<boolean>;
	write(name: string, c: Case): Promise<void>;
	/** Remove a renamed case's old file; a target without it keeps the file. */
	remove?(name: string): Promise<void>;
	/** The run is over. */
	end?(): Promise<void>;
	/**
	 * A write a stopped worker left under way, settled at the next run: the
	 * file it wrote, when it was written.
	 */
	settle?(): Promise<
		{ caseId: string; version: string; file: string } | undefined
	>;
}

export type SyncTargetKind = "downloads" | "folder";

/** The fixed id of the Downloads target (`files:downloads`). */
export const DOWNLOADS_ID = "downloads";

/** The folder in the downloads, as the panel names it. */
export const DOWNLOADS_FOLDER = "Sitegloss";

/** No permission (any more): the user allows it again in the panel. */
export class SyncPaused extends Error {}

/**
 * The target cannot be written to at all: the run stops, saying why.
 * `needsUser`: only the user can end it (a dialog of Chrome's to answer, a
 * setting to change), so it is not tried again until the user asks.
 */
export class TargetFailed extends Error {
	constructor(
		message: string,
		readonly needsUser = false,
	) {
		super(message);
	}
}

/** What the user chose, as stored: Downloads, or a folder. */
export type SyncChoice =
	| { target: "downloads" }
	| { target: "folder"; folder: ChosenFolder };

/** What was written for a case: its version then, and the file's name. */
export interface SyncedFile {
	version: string;
	file: string;
}

/** What is in a target, as far as Sitegloss wrote it. */
export interface SyncedFiles {
	/** The target's id (a folder's, or `downloads`); named so before DEC-025. */
	folderId: string;
	/** By case id; deleted cases stay, as their files do. */
	byCase: Record<string, SyncedFile>;
}

export type SyncState = "syncing" | "synced" | "paused" | "failed";

/** Why the sync is paused: the folder needs access, or the downloads permission is gone. */
export type PausedReason = "access" | "downloads";

export interface SyncStatus {
	/** The target this is about (a folder's id, or `downloads`): a status of another is no news. */
	folderId: string;
	state: SyncState;
	/** Paused: why. */
	reason?: PausedReason;
	/** When the folder last held every case as it is (ISO). */
	lastSyncedAt?: string;
	/** Failed: what went wrong and what to do. */
	problem?: string;
	/** Syncing: how many cases are still to write. */
	left?: number;
	/** Failed in a way only the user can end: kept until Try again or a new choice. */
	needsUser?: true;
}

/** Where the sync keeps the user's choice, what it wrote and its status. */
export interface SyncStore {
	choice(): Promise<SyncChoice | undefined>;
	/** What was written to that target, kept for each target ever synced. */
	files(targetId: string): Promise<SyncedFiles | undefined>;
	status(): Promise<SyncStatus | undefined>;
	/** Both at once. */
	save(files: SyncedFiles, status: SyncStatus): Promise<void>;
	/** `undefined`: not syncing, nothing to say. */
	saveStatus(status: SyncStatus | undefined): Promise<void>;
}

/**
 * The database of the sync, in the extension's origin: the side panel writes
 * `target`, `folder` and `folders` (every folder chosen so far), the worker
 * `files:<target id>` (one record for each target), `status` and
 * `downloads:last`. Apart from the settings' database, which only the worker
 * uses (DEC-016).
 */
export const SYNC_DATABASE = "sitegloss-sync";
export const TARGET_KEY = "target";
export const FOLDER_KEY = "folder";
export const FOLDERS_KEY = "folders";
export const STATUS_KEY = "status";
/** The newest entry the sync left in Chrome's download list, for "Show in folder". */
export const LAST_DOWNLOAD_KEY = "downloads:last";
/** The download under way, while the worker waits for it (`PendingDownload`). */
export const PENDING_DOWNLOAD_KEY = "downloads:pending";
export const filesKey = (targetId: string) => `files:${targetId}`;

/**
 * The choice from the stored `target` and `folder`. No `target` and a folder
 * is the folder: someone syncing to a folder before DEC-025 keeps doing so.
 */
export function choiceOf(
	target: unknown,
	folder: ChosenFolder | undefined,
): SyncChoice | undefined {
	if (target === "downloads") return { target: "downloads" };
	if ((target === "folder" || target === undefined) && folder !== undefined)
		return { target: "folder", folder };
	return undefined;
}

/** The id of the target a choice writes to. */
export const targetIdOf = (choice: SyncChoice | undefined) =>
	choice === undefined
		? undefined
		: choice.target === "downloads"
			? DOWNLOADS_ID
			: choice.folder.id;

/** The sync's store in its database. */
export function kvSyncStore(kv: Kv): SyncStore {
	return {
		choice: async () =>
			choiceOf(
				await kv.get(TARGET_KEY),
				(await kv.get(FOLDER_KEY)) as ChosenFolder | undefined,
			),
		files: async (targetId) =>
			(await kv.get(filesKey(targetId))) as SyncedFiles | undefined,
		status: async () => (await kv.get(STATUS_KEY)) as SyncStatus | undefined,
		save: (files, status) =>
			kv.set({ [filesKey(files.folderId)]: files, [STATUS_KEY]: status }),
		saveStatus: (status) => kv.set({ [STATUS_KEY]: status }),
	};
}

/**
 * Sync to Downloads from now on (the panel, once Chrome allowed downloads).
 * Every case is written again, into the file it had: nothing is read from
 * the downloads, so this is the way to bring back files deleted there.
 */
export async function chooseDownloads(kv: Kv): Promise<void> {
	const record = (await kv.get(filesKey(DOWNLOADS_ID))) as
		| SyncedFiles
		| undefined;
	const byCase: Record<string, SyncedFile> = {};
	for (const [id, f] of Object.entries(record?.byCase ?? {}))
		byCase[id] = { version: "", file: f.file };
	await kv.set({
		[TARGET_KEY]: "downloads",
		[FOLDER_KEY]: undefined,
		...(record === undefined
			? {}
			: { [filesKey(DOWNLOADS_ID)]: { folderId: DOWNLOADS_ID, byCase } }),
	});
}

/**
 * Sync to `handle` from now on (the side panel, after the picker). A folder
 * synced before, the current one or any earlier one, gets its id back, so
 * the files Sitegloss wrote there are its own again and are updated in place.
 * Every folder chosen stays in `folders` for that.
 */
export async function chooseFolder(
	kv: Kv,
	handle: PickedFolder,
	newId: () => string,
): Promise<ChosenFolder> {
	const all = await kv.all();
	const current = all[FOLDER_KEY] as ChosenFolder | undefined;
	const known = (all[FOLDERS_KEY] as ChosenFolder[] | undefined) ?? [];
	// The current one too, should it be missing from the list.
	const before = current === undefined ? known : [current, ...known];
	let id: string | undefined;
	for (const f of before)
		if (await handle.isSameEntry(f.handle).catch(() => false)) {
			id = f.id;
			break;
		}
	const chosen: ChosenFolder = { handle, name: handle.name, id: id ?? newId() };
	// Each folder once, under its latest handle and name.
	const seen = new Set([chosen.id]);
	const folders = [chosen];
	for (const f of before)
		if (!seen.has(f.id)) {
			seen.add(f.id);
			folders.push(f);
		}
	await kv.set({
		[TARGET_KEY]: "folder",
		[FOLDER_KEY]: chosen,
		[FOLDERS_KEY]: folders,
	});
	return chosen;
}

/**
 * Stop syncing: a folder stays in `folders`, to be recognised again. The
 * newest download's id goes: Chrome may give it to another download later.
 */
export const stopSyncing = (kv: Kv): Promise<void> =>
	kv.set({
		[TARGET_KEY]: undefined,
		[FOLDER_KEY]: undefined,
		[LAST_DOWNLOAD_KEY]: undefined,
	});

/** A case's version: an import may keep `updatedAt` and still change it. */
export const versionOf = (c: Case) => `${c.updatedAt}|${c.importedAt ?? ""}`;

const errorName = (error: unknown) =>
	error instanceof Error || error instanceof DOMException ? error.name : "";

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** What a folder's error means, in plain words with what to do. */
function folderProblem(error: unknown, folder: string, file: string): Error {
	switch (errorName(error)) {
		case "NotAllowedError":
		case "SecurityError":
			return new SyncPaused();
		case "NotFoundError":
			return new TargetFailed(
				`The folder “${folder}” is no longer there: it was moved, renamed or deleted. Click Change… to choose it again, or another one.`,
			);
		case "QuotaExceededError":
			return new TargetFailed(
				`There is no space left for “${file}” in “${folder}”. Free some space, then click Try again.`,
			);
		case "NoModificationAllowedError":
			return new TargetFailed(
				`“${file}” in “${folder}” is locked or open in another program. Close it, then click Try again.`,
			);
		default:
			return new TargetFailed(
				`Could not write “${file}” to “${folder}”: ${message(error)} Sitegloss tries again at the next change, or click Try again.`,
			);
	}
}

/** A case's file, as Export writes it. */
export type ExportCase = (store: CaseStore, c: Case) => Promise<Uint8Array>;

/** The folder the user chose (DEC-021), through the File System Access API. */
export function folderTarget(
	chosen: ChosenFolder,
	cases: CaseStore,
	exportOne: ExportCase = exportCase,
): SyncTarget {
	const folder = chosen.handle;
	const wrap = (name: string) => (error: unknown) => {
		throw folderProblem(error, chosen.name, name);
	};
	return {
		id: chosen.id,
		kind: "folder",
		async permission() {
			try {
				return (
					(await folder.queryPermission({ mode: "readwrite" })) === "granted"
				);
			} catch {
				return false;
			}
		},
		exists: (name) => exists(folder, name).catch(wrap(name)),
		async write(name, c) {
			const zip = await exportOne(cases, c);
			await write(folder, name, zip).catch(wrap(name));
		},
		remove: (name) => folder.removeEntry(name),
	};
}

/** How a download ended; `timeout`: Chrome said nothing for too long. */
export type DownloadEnd =
	| { state: "complete"; filename: string }
	| { state: "interrupted"; error: string }
	| { state: "timeout" };

/** A download the worker waits for: settled at the next run if it stops meanwhile. */
export interface PendingDownload {
	id: number;
	caseId: string;
	version: string;
	file: string;
}

/** What the Downloads target needs of Chrome (`src/worker/downloads.ts`; fakes in the tests). */
export interface DownloadsApi {
	/** Whether Sitegloss has the `downloads` permission now. */
	granted(): Promise<boolean>;
	/**
	 * Allowed, but `chrome.downloads` is not there in this worker: whether a
	 * worker running when the user said yes gets the API was not seen (DEC-025).
	 */
	apiMissing?(): boolean;
	/** A URL of the case's export, made where blob URLs can be (the offscreen document). */
	url(c: Case): Promise<string>;
	revoke(url: string): Promise<void>;
	/** Start the download; answers its id. */
	download(options: {
		url: string;
		filename: string;
		conflictAction: "overwrite";
		saveAs: false;
	}): Promise<number>;
	/** Wait for the download to end, at most `timeoutMs`. */
	finished(id: number, timeoutMs: number): Promise<DownloadEnd>;
	cancel(id: number): Promise<void>;
	/** Take an entry out of Chrome's download list; the file stays. */
	erase(id: number): Promise<void>;
	/** The newest entry the sync left in the list. */
	last(): Promise<number | undefined>;
	setLast(id: number): Promise<void>;
	/** The download under way, kept where a new worker finds it. */
	pending(): Promise<PendingDownload | undefined>;
	setPending(p: PendingDownload | undefined): Promise<void>;
	/** The run is over: the offscreen document can go. */
	end?(): Promise<void>;
}

/** How long a download of one case may take. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * An entry of Chrome's download list that the sync wrote: by this
 * extension, into `Sitegloss/`. An id stored earlier may be another
 * download's by now (Chrome numbers anew after its history is cleared).
 */
export const isSyncDownload = (
	item: { byExtensionId?: string | undefined; filename?: string } | undefined,
	extensionId: string,
) =>
	item?.byExtensionId === extensionId &&
	(item.filename ?? "").replaceAll("\\", "/").includes(`/${DOWNLOADS_FOLDER}/`);

/** A file that was saved, at `path`, `Sitegloss/<name>` in the downloads? */
const savedAs = (path: string, name: string) =>
	path.replaceAll("\\", "/").endsWith(`/${DOWNLOADS_FOLDER}/${name}`);

/** Why Chrome stopped a download, in plain words with what to do. */
function downloadProblem(error: string, file: string): string {
	switch (error) {
		case "USER_CANCELED":
			// Firefox never asks where for an extension's download that says
			// `saveAs: false`.
			return FIREFOX
				? `Firefox did not save “${file}” (it was cancelled). Sitegloss tries again at the next change, or click Try again.`
				: `Chrome asked where to save “${file}”, and it was not saved. Chrome asks for every download while “Ask where to save each file before downloading” is on in its settings (Downloads): turn it off, or choose a folder instead, then click Try again.`;
		case "FILE_NO_SPACE":
			return `There is no space left in your downloads for “${file}”. Free some space, then click Try again.`;
		case "FILE_ACCESS_DENIED":
			return `${BROWSER} may not write “${file}” to your downloads (${error}). Check that the downloads folder can be written to, then click Try again.`;
		default:
			return `${BROWSER} stopped saving “${file}” to your downloads (${error}). Sitegloss tries again at the next change, or click Try again.`;
	}
}

/**
 * `Sitegloss/` in Chrome's downloads folder (DEC-025): each file through
 * `chrome.downloads`, overwriting the one before, with no dialog and with
 * the side panel closed. Nothing can be removed there, so a renamed case
 * leaves its old file. Each write is an entry in Chrome's download list:
 * the one before is erased (its file stays), the newest kept for "Show in
 * folder".
 */
export function downloadsTarget(api: DownloadsApi): SyncTarget {
	/** The newest entry stays in Chrome's list, for Show in folder; the one before goes. */
	const keepNewest = async (id: number) => {
		const before = await api.last().catch(() => undefined);
		// The one before goes first: a worker stopped in between still has it
		// recorded, and the next run erases it again.
		if (before !== undefined && before !== id)
			await api.erase(before).catch(() => undefined);
		await api.setLast(id);
	};
	return {
		id: DOWNLOADS_ID,
		kind: "downloads",
		permission: () => api.granted().catch(() => false),
		// Nothing there can be looked at: a file of the name is overwritten. The
		// folder is shared by every profile and browser syncing to Downloads
		// (the README says so).
		exists: async () => false,
		async write(name, c) {
			if (api.apiMissing?.()) {
				// Taken back meanwhile: paused, as at the run's start.
				if (!(await api.granted().catch(() => false))) throw new SyncPaused();
				throw new TargetFailed(
					`${BROWSER} allowed Sitegloss to save to your downloads, but Sitegloss's background part does not see it yet. It starts writing once ${BROWSER} restarts that part, by itself after a while without use; now, turn Sitegloss off and on in ${FIREFOX ? "Add-ons and themes (in Firefox's menu)" : "chrome://extensions"}.`,
				);
			}
			// Its export failing is the case's own problem.
			const url = await api.url(c);
			let end: DownloadEnd;
			let id: number;
			try {
				try {
					id = await api.download({
						url,
						filename: `${DOWNLOADS_FOLDER}/${name}`,
						conflictAction: "overwrite",
						saveAs: false,
					});
				} catch (error) {
					if (!(await api.granted().catch(() => false))) throw new SyncPaused();
					// Refused for this case (its name, say): the others go on.
					throw new Error(
						`${BROWSER} would not save it to your downloads: ${message(error)}`,
					);
				}
				// Should the worker stop before its entry is kept, the next run
				// settles it: kept until then, or the entry before stays in the
				// list beside this one.
				await api.setPending({
					id,
					caseId: c.id,
					version: versionOf(c),
					file: name,
				});
				end = await api.finished(id, DOWNLOAD_TIMEOUT_MS);
				if (end.state === "timeout") {
					await api.cancel(id).catch(() => undefined);
					await api.erase(id).catch(() => undefined);
					throw new TargetFailed(
						`${BROWSER} did not finish saving “${name}” to your downloads within a minute. Sitegloss tries again at the next change, or click Try again.`,
					);
				}
				if (end.state === "interrupted") {
					// A failed write leaves no entry in Chrome's list.
					await api.erase(id).catch(() => undefined);
					throw new TargetFailed(
						downloadProblem(end.error, name),
						end.error === "USER_CANCELED",
					);
				}
				// Saved somewhere else: the user chose another place in Chrome's
				// Save dialog, or another extension or a setting moved it.
				if (!savedAs(end.filename, name)) {
					await api.erase(id).catch(() => undefined);
					throw new TargetFailed(
						FIREFOX
							? `Firefox saved “${name}” as “${end.filename}”, not in Downloads/${DOWNLOADS_FOLDER}: another extension may have moved it. Click Try again.`
							: `Chrome saved “${name}” as “${end.filename}”, not in Downloads/${DOWNLOADS_FOLDER}: the place was chosen in its Save dialog (“Ask where to save each file before downloading” in its settings), or another extension moved it. Turn that off, or choose a folder instead, then click Try again.`,
						true,
					);
				}
				await keepNewest(id);
			} finally {
				await api.revoke(url).catch(() => undefined);
				await api.setPending(undefined).catch(() => undefined);
			}
		},
		async settle() {
			const p = await api.pending().catch(() => undefined);
			if (p === undefined) return undefined;
			let end: DownloadEnd | undefined;
			try {
				end = await api.finished(p.id, DOWNLOAD_TIMEOUT_MS);
				if (end.state === "timeout")
					await api.cancel(p.id).catch(() => undefined);
			} catch {
				end = undefined;
			}
			// Settled once its entry is kept or erased, not before: a worker
			// stopped meanwhile settles it again.
			try {
				if (end?.state === "complete" && savedAs(end.filename, p.file)) {
					await keepNewest(p.id);
					return { caseId: p.caseId, version: p.version, file: p.file };
				}
				// Not written: the run writes the case again.
				await api.erase(p.id).catch(() => undefined);
				return undefined;
			} finally {
				await api.setPending(undefined).catch(() => undefined);
			}
		},
		end: async () => api.end?.(),
	};
}

export interface SyncDeps {
	cases: CaseStore;
	store: SyncStore;
	/** The status changed (`undefined`: not syncing): tell the side panel, set the icon. */
	notify?: (status: SyncStatus | undefined) => void;
	now?: () => Date;
	/** The Downloads target; without one, Downloads cannot be synced to. */
	downloads?: SyncTarget;
	/** A folder's target; `folderTarget` by default. */
	folder?: (chosen: ChosenFolder) => SyncTarget;
	/** A case's file for a folder (Export's own); tests may fail it. */
	exportCase?: ExportCase;
	/**
	 * Wait this long after the last request before a run to Downloads (not
	 * for Try again): a burst of changes is one download per case.
	 */
	quietMs?: number;
}

/**
 * The writer. `request()` after any change; runs never overlap, and changes
 * that come during a run start one more run after it.
 */
export class Sync {
	readonly #deps: SyncDeps;
	#dirty = false;
	#force = false;
	/** When the last request came. */
	#last = 0;
	#running: Promise<void> | undefined;

	constructor(deps: SyncDeps) {
		this.#deps = deps;
	}

	/**
	 * Bring the target up to date, now or after the run at work. `force`
	 * (Try again, a new choice): also after a failure only the user can end.
	 */
	request(force = false): Promise<void> {
		this.#dirty = true;
		this.#force ||= force;
		this.#last = Date.now();
		this.#running ??= this.#loop();
		return this.#running;
	}

	/** Resolves once no run is at work (tests). */
	idle(): Promise<void> {
		return this.#running ?? Promise.resolve();
	}

	async #loop(): Promise<void> {
		try {
			while (this.#dirty) {
				// Downloads only: each write there is a download Chrome shows; a
				// folder is written at once.
				const quiet =
					(await this.#deps.store.choice().catch(() => undefined))?.target ===
					"downloads"
						? (this.#deps.quietMs ?? 0)
						: 0;
				for (;;) {
					const wait = this.#last + quiet - Date.now();
					if (this.#force || wait <= 0) break;
					await new Promise((r) => setTimeout(r, wait));
				}
				this.#dirty = false;
				const force = this.#force;
				this.#force = false;
				try {
					await this.run(force);
				} catch (error) {
					console.warn("Sitegloss: sync", error);
				}
			}
		} finally {
			this.#running = undefined;
		}
	}

	#now(): string {
		return (this.#deps.now?.() ?? new Date()).toISOString();
	}

	async #report(status: SyncStatus, files?: SyncedFiles): Promise<void> {
		const { store, notify } = this.#deps;
		if (files === undefined) await store.saveStatus(status);
		else await store.save(files, status);
		notify?.(status);
	}

	#target(choice: SyncChoice): SyncTarget | undefined {
		if (choice.target === "downloads") return this.#deps.downloads;
		return (
			this.#deps.folder?.(choice.folder) ??
			folderTarget(choice.folder, this.#deps.cases, this.#deps.exportCase)
		);
	}

	/** One run; use `request`, which never runs two at once. */
	async run(force = false): Promise<void> {
		const { store, notify } = this.#deps;
		const choice = await store.choice();
		// Not to Downloads (any more): a document a stopped worker left open goes.
		if (choice?.target !== "downloads")
			await this.#deps.downloads?.end?.().catch(() => undefined);
		if (choice === undefined) {
			// Not syncing: no status, no "!" on the icon.
			if ((await store.status()) !== undefined)
				await store.saveStatus(undefined);
			notify?.(undefined);
			return;
		}
		const target = this.#target(choice);
		if (target === undefined)
			return this.#report({
				folderId: DOWNLOADS_ID,
				state: "failed",
				problem: "This browser cannot save to your downloads.",
			});
		try {
			await this.#run(target, force);
		} finally {
			await target.end?.().catch(() => undefined);
		}
	}

	async #run(target: SyncTarget, force: boolean): Promise<void> {
		const { cases, store, notify } = this.#deps;
		const before = await store.status();
		const last =
			before?.folderId === target.id ? before.lastSyncedAt : undefined;
		const base = {
			folderId: target.id,
			...(last === undefined ? {} : { lastSyncedAt: last }),
		};
		const reason: PausedReason =
			target.kind === "folder" ? "access" : "downloads";
		const paused = (): SyncStatus => ({ ...base, state: "paused", reason });
		if (!(await target.permission())) return this.#report(paused());
		// Waiting for the user (a Save dialog cancelled): no new download by itself.
		if (
			!force &&
			before?.folderId === target.id &&
			before.state === "failed" &&
			before.needsUser
		) {
			notify?.(before);
			return;
		}

		const record = await store.files(target.id);
		const byCase: Record<string, SyncedFile> =
			record?.folderId === target.id ? { ...record.byCase } : {};
		const files = (): SyncedFiles => ({ folderId: target.id, byCase });
		// A write a stopped worker left under way.
		const settled = await target.settle?.().catch(() => undefined);
		if (settled !== undefined)
			byCase[settled.caseId] = {
				version: settled.version,
				file: settled.file,
			};
		const all = await cases.listCases();
		// A case without marks gets no file until its first mark (DEC-026): a
		// file in Downloads cannot be taken back, and an empty case that is
		// left goes again. One written before is kept up to date.
		const todo = all.filter(
			(c) =>
				byCase[c.id]?.version !== versionOf(c) &&
				(c.marks.length > 0 || byCase[c.id] !== undefined),
		);
		if (todo.length === 0)
			return this.#report(
				{ folderId: target.id, state: "synced", lastSyncedAt: this.#now() },
				files(),
			);

		// Which case each file name is Sitegloss's for, in this target.
		const owner = new Map<string, string>();
		for (const [id, f] of Object.entries(byCase)) owner.set(f.file, id);
		const problems: string[] = [];
		let left = todo.length;
		await this.#report({ ...base, state: "syncing", left });
		for (const c of todo) {
			// Stop syncing, or another target, meanwhile: this run is over.
			if (targetIdOf(await store.choice()) !== target.id) return;
			const old = byCase[c.id]?.file;
			try {
				const name = await this.#fileName(target, c, old, owner);
				await target.write(name, c);
				// The same case under its new title: its old file goes, where it can.
				if (old !== undefined && old !== name) {
					if (target.remove !== undefined)
						await target.remove(old).catch(() => undefined);
					owner.delete(old);
				}
				owner.set(name, c.id);
				byCase[c.id] = { version: versionOf(c), file: name };
			} catch (error) {
				if (error instanceof SyncPaused) return this.#report(paused(), files());
				if (error instanceof TargetFailed)
					return this.#report(
						{
							...base,
							state: "failed",
							problem: error.message,
							...(error.needsUser ? { needsUser: true as const } : {}),
						},
						files(),
					);
				// This case alone (an image missing, say): the others go on.
				problems.push(`“${c.title}” could not be written: ${message(error)}`);
				left--;
				continue;
			}
			left--;
			// After each file, so that a worker stopped meanwhile starts from here.
			await this.#report({ ...base, state: "syncing", left }, files());
		}
		if (problems.length > 0)
			return this.#report(
				{
					...base,
					state: "failed",
					problem: `${problems.slice(0, 3).join(" ")}${problems.length > 3 ? ` And ${problems.length - 3} more cases could not be written.` : ""} Sitegloss tries again at the next change, or click Try again.`,
				},
				files(),
			);
		return this.#report(
			{ folderId: target.id, state: "synced", lastSyncedAt: this.#now() },
			files(),
		);
	}

	/**
	 * The file for `c`: Export's name for it (`login-button.sitegloss.zip`),
	 * with `-2`, `-3` when another case has that name already, a deleted one
	 * too, or when the target has a file of that name Sitegloss did not write
	 * for this case: such a file is never overwritten. A case keeps its file
	 * while its title gives the same name; in Downloads, whatever its title.
	 */
	async #fileName(
		target: SyncTarget,
		c: Case,
		current: string | undefined,
		owner: ReadonlyMap<string, string>,
	): Promise<string> {
		// In Downloads nothing can be removed, so a case keeps the name it was
		// first written under: a rename changes the file, not its name, and
		// leaves no stale file behind (review of PR 57: under DEC-026 every
		// case starts with the page's title and is renamed afterwards).
		if (current !== undefined && target.kind === "downloads") return current;
		const stem = safeStem(exportFileName(c).slice(0, -EXPORT_SUFFIX.length));
		const wanted = `${stem}${EXPORT_SUFFIX}`;
		if (
			current !== undefined &&
			(current === wanted || isNumbered(current, stem))
		)
			return current;
		for (let n = 1; ; n++) {
			const name = n === 1 ? wanted : `${stem}-${n}${EXPORT_SUFFIX}`;
			const ownedBy = owner.get(name);
			if (ownedBy === c.id) return name;
			if (ownedBy !== undefined) continue;
			if (!(await target.exists(name))) return name;
		}
	}
}

/**
 * A name Windows reserves (`con`, `nul`, `com1`…) gets `_` before it: Chrome's
 * downloads refuse it on every platform, and a folder on Windows would too.
 */
const safeStem = (stem: string) =>
	/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem) ? `_${stem}` : stem;

/** `stem-<n>.sitegloss.zip`, as `#fileName` numbers a name taken. */
function isNumbered(name: string, stem: string): boolean {
	if (!name.startsWith(`${stem}-`) || !name.endsWith(EXPORT_SUFFIX))
		return false;
	return /^(?:[2-9]|[1-9]\d+)$/.test(
		name.slice(stem.length + 1, -EXPORT_SUFFIX.length),
	);
}

/** Whether the folder has an entry of that name; only its name is looked at. */
async function exists(folder: SyncFolder, name: string): Promise<boolean> {
	try {
		await folder.getFileHandle(name);
		return true;
	} catch (error) {
		const why = errorName(error);
		if (why === "NotFoundError") return false;
		// A folder of that name.
		if (why === "TypeMismatchError") return true;
		throw error;
	}
}

/**
 * Write the file whole: Chrome writes to a temporary file and puts it in
 * place on `close`, so the folder never holds half a case.
 */
async function write(
	folder: SyncFolder,
	name: string,
	data: Uint8Array,
): Promise<void> {
	const file = await folder.getFileHandle(name, { create: true });
	const stream = await file.createWritable();
	try {
		await stream.write(
			new Blob([data as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
		);
		await stream.close();
	} catch (error) {
		await stream.abort().catch(() => undefined);
		throw error;
	}
}
