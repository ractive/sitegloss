/**
 * The side panel's part of the sync (DEC-021, DEC-025): choosing the target
 * (Chrome's prompt for downloads and its folder picker each need the click),
 * Change…, Stop syncing, giving Chrome's permission again ("Allow access",
 * "Allow downloads"), which also needs a click in a window, and Show in
 * folder. The service worker writes the files; the panel reads its status
 * from the sync's database and asks it to run.
 */

import { BROWSER, FIREFOX, PANEL } from "../lib/browser.ts";
import { newId } from "../lib/case.ts";
import { debugLog } from "../lib/debug.ts";
import { type Kv, kvWhenOpen, openKv } from "../lib/kv.ts";
import type { Broadcast } from "../lib/messages.ts";
import {
	type ChosenFolder,
	choiceOf,
	chooseDownloads,
	chooseFolder,
	FOLDER_KEY,
	isSyncDownload,
	LAST_DOWNLOAD_KEY,
	type PickedFolder,
	STATUS_KEY,
	SYNC_DATABASE,
	type SyncStatus,
	stopSyncing,
	TARGET_KEY,
	targetIdOf,
} from "../lib/sync.ts";
import { askForDownloads, DOWNLOADS } from "./download.ts";
import type { PanelState } from "./state.ts";
import type { SyncActions } from "./sync-view.ts";

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** A folder handle as a window has it: it may ask for permission. */
interface WindowFolder extends PickedFolder {
	requestPermission(descriptor: {
		mode: "readwrite";
	}): Promise<"granted" | "denied" | "prompt">;
}

type Picker = (options: {
	id?: string;
	mode: "readwrite";
	startIn?: string;
}) => Promise<WindowFolder>;

type Update = (change: (s: PanelState) => void) => void;

/** Set when the downloads permission was given for the sync, not for Export. */
const ASKED_KEY = "downloads:for-sync";

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** The panel's view of the sync, and its actions. */
export interface PanelSync extends SyncActions {
	/** Read the choice and the worker's status again. */
	refresh(): Promise<void>;
}

/**
 * Ask the worker to bring the target up to date; `force` after the user's
 * Try again or a new choice, also when a failure was waiting for them.
 */
function run(force = false): void {
	const news: Broadcast = { type: "sync:run", ...(force ? { force } : {}) };
	chrome.runtime
		.sendMessage(news)
		.catch((error: unknown) => debugLog("sync run message", error));
}

/** The actions, for `Actions`, before the panel's sync is started. */
export function syncActions(sync: () => SyncActions): SyncActions {
	return {
		syncDownloads: () => sync().syncDownloads(),
		syncChoose: () => sync().syncChoose(),
		syncChange: () => sync().syncChange(),
		syncCancelChange: () => sync().syncCancelChange(),
		syncStop: () => sync().syncStop(),
		syncAllow: () => sync().syncAllow(),
		syncAllowDownloads: () => sync().syncAllowDownloads(),
		syncRetry: () => sync().syncRetry(),
		syncShow: () => sync().syncShow(),
	};
}

/** The panel's sync; `kv` is the sync's database (tests pass their own). */
export function startSync(
	update: Update,
	kv: Kv = kvWhenOpen(() => openKv(SYNC_DATABASE)),
): PanelSync {
	/** The folder as last read, for a click that must not wait for the database. */
	let current: (ChosenFolder & { handle: WindowFolder }) | undefined;
	/** Where it syncs, as last read. */
	let target: string | undefined;
	/** The problem `refresh` shows while the database cannot be read. */
	let unreadable: string | undefined;

	const problem = (text: string | undefined) =>
		update((s) => {
			s.sync.problem = text;
		});

	async function refresh(): Promise<void> {
		let all: Record<string, unknown>;
		try {
			all = await kv.all();
		} catch (error) {
			unreadable = `Could not read the sync's state: ${message(error)} Close and open the ${PANEL} to try again.`;
			problem(unreadable);
			return;
		}
		const choice = choiceOf(
			all[TARGET_KEY],
			all[FOLDER_KEY] as ChosenFolder | undefined,
		);
		const status = all[STATUS_KEY] as SyncStatus | undefined;
		current =
			choice?.target === "folder"
				? (choice.folder as typeof current)
				: undefined;
		const id = targetIdOf(choice);
		target = choice?.target;
		const was = unreadable;
		unreadable = undefined;
		update((s) => {
			// Another target now: "Change…" is over.
			if (s.sync.targetId !== id) s.sync.changing = false;
			s.sync.target = choice?.target;
			s.sync.targetId = id;
			s.sync.folder = current?.name;
			s.sync.status = status?.folderId === id ? status : undefined;
			// Allowed meanwhile (by the worker's run, say): no "did not allow".
			if (s.sync.status?.state !== "paused") s.sync.refused = false;
			// Readable again: that problem is over.
			if (was !== undefined && s.sync.problem === was)
				s.sync.problem = undefined;
		});
	}

	/** Use `handle` from now on: a folder synced before keeps what was written there. */
	async function use(handle: WindowFolder): Promise<void> {
		await chooseFolder(kv, handle, () => newId("f"));
		update((s) => {
			s.sync.problem = undefined;
			s.sync.changing = false;
		});
		await refresh();
		run(true);
	}

	function syncChoose(): void {
		const picker = (window as unknown as { showDirectoryPicker?: Picker })
			.showDirectoryPicker;
		if (picker === undefined) {
			problem("This browser cannot write to a folder of your choice.");
			return;
		}
		// Chrome shows its picker only during a click: nothing is awaited before.
		let picking: Promise<WindowFolder>;
		try {
			picking = picker({ id: "sitegloss-sync", mode: "readwrite" });
		} catch (error) {
			problem(`Could not open the folder picker: ${message(error)}`);
			return;
		}
		picking.then(
			(handle) =>
				use(handle).catch((error: unknown) =>
					problem(`Could not use that folder: ${message(error)}`),
				),
			(error: unknown) => {
				// Cancelled in the picker: nothing changes.
				if ((error as { name?: string }).name === "AbortError") return;
				problem(`Could not use that folder: ${message(error)}`);
			},
		);
	}

	/**
	 * "Sync to Downloads" and "Use Downloads instead": Chrome's prompt for
	 * downloads (only during a click; none where Sitegloss has it), then the
	 * worker writes to Downloads.
	 */
	function syncDownloads(): void {
		// Asked before the prompt: whether Export had the permission already.
		const had = Promise.resolve()
			.then(() => chrome.permissions.contains(DOWNLOADS))
			.catch((error: unknown) => {
				debugLog("downloads permission", error);
				return true;
			});
		const allowed = askForDownloads();
		update((s) => {
			s.sync.asking = true;
			s.sync.problem = undefined;
		});
		void allowed.then(async (yes) => {
			update((s) => (s.sync.asking = false));
			if (!yes) {
				problem(
					`${BROWSER} did not allow Sitegloss to save to your downloads. Click Copy to Downloads to ask again${FIREFOX ? "" : ", or choose a folder"}.`,
				);
				return;
			}
			try {
				await chooseDownloads(kv);
				// Given for the sync: Stop syncing gives it back.
				if (!(await had)) await kv.set({ [ASKED_KEY]: true });
			} catch (error) {
				problem(`Could not sync to Downloads: ${message(error)}`);
				return;
			}
			update((s) => {
				s.sync.changing = false;
				s.sync.refused = false;
			});
			await refresh();
			run(true);
		});
	}

	function syncStop(): void {
		const fromDownloads = target === "downloads";
		const ours = kv.get(ASKED_KEY).then(
			(v) => v === true,
			() => false,
		);
		// A folder stays known: choosing it again keeps what was written there.
		void stopSyncing(kv).then(
			() => {
				// The permission goes back with it when the sync asked for it (not
				// when Export had it already): Export or Sync to Downloads asks
				// again. (A build that has it at install cannot give it back.)
				if (fromDownloads)
					void ours
						.then(async (yes) => {
							if (!yes) return;
							await kv.set({ [ASKED_KEY]: undefined });
							await chrome.permissions.remove(DOWNLOADS);
						})
						.catch((error: unknown) =>
							debugLog("forget downloads permission", error),
						);
				update((s) => {
					s.sync.problem = undefined;
					s.sync.changing = false;
				});
				// The worker clears its status, and the icon's "!".
				return refresh().then(() => run());
			},
			(error: unknown) => problem(`Could not stop syncing: ${message(error)}`),
		);
	}

	function syncAllow(): void {
		const folder = current;
		if (folder === undefined) return;
		// Chrome asks only during a click: nothing is awaited before.
		let asking: Promise<string>;
		try {
			asking = folder.handle.requestPermission({ mode: "readwrite" });
		} catch (error) {
			problem(`Could not ask for access: ${message(error)}`);
			return;
		}
		asking.then(
			(answer) => {
				const yes = answer === "granted";
				update((s) => {
					s.sync.refused = !yes;
					if (yes) s.sync.problem = undefined;
				});
				if (yes) run(true);
			},
			(error: unknown) =>
				problem(
					`Could not ask for access to “${folder.name}”: ${message(error)} Click Change… to choose it again, or use Downloads instead.`,
				),
		);
	}

	function syncAllowDownloads(): void {
		const allowed = askForDownloads();
		void allowed.then((yes) => {
			update((s) => (s.sync.refused = !yes));
			if (yes) run(true);
		});
	}

	/** The newest file the sync saved, in the system's file manager. */
	function syncShow(): void {
		void (async () => {
			const id = await kv
				.get(LAST_DOWNLOAD_KEY)
				.catch((error: unknown) => debugLog("last download", error));
			if (typeof id === "number") {
				const [item] = await chrome.downloads.search({ id });
				if (item?.exists && isSyncDownload(item, chrome.runtime.id)) {
					chrome.downloads.show(id);
					return;
				}
			}
			chrome.downloads.showDefaultFolder();
		})().catch((error: unknown) =>
			problem(`Could not show the folder: ${message(error)}`),
		);
	}

	// The end-to-end tests cannot answer Chrome's picker: they hand the panel a
	// folder of the origin's private file system instead.
	if (typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD)
		Object.assign(window, { siteglossUseFolder: use });

	void refresh().then(() => run());
	return {
		refresh,
		syncDownloads,
		syncChoose,
		syncChange: () => update((s) => (s.sync.changing = true)),
		syncCancelChange: () => update((s) => (s.sync.changing = false)),
		syncStop,
		syncAllow,
		syncAllowDownloads,
		syncRetry: () => {
			problem(undefined);
			run(true);
		},
		syncShow,
	};
}
