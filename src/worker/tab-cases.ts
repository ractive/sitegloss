/**
 * What each tab's page may touch (service worker). The cases it was handed:
 * the side panel's toolbar for a case (`overlay:show`), a case's marks drawn
 * on the page (`case:load`, from the panel or an AI app's tool); a page
 * adds marks only to such a case (`case:save`, `case:number`,
 * `case:undo-add`). And the ids its screenshots wait under until a save
 * (`capture`, `images:discard`, a save's `imagesFrom`): the first tab to
 * capture under one has it, no other tab. So a compromised renderer cannot
 * write into a case it was never given, even knowing its id, nor take or
 * delete another page's screenshots. Kept in `chrome.storage.session` as
 * the undo ledger is (undo.ts): it outlives a stopped service worker, not
 * the browser, and content scripts cannot reach it.
 */

import type { SessionArea } from "../lib/undo.ts";

const KEY = "tabCases";

/**
 * The most cases remembered for one tab besides its toolbar's, the most
 * ids of its screenshots, and the most tabs; the oldest go first.
 */
export const MAX_CASES_A_TAB = 50;
export const MAX_PENDING_A_TAB = 20;
export const MAX_TABS = 200;

/**
 * One tab's: the case its toolbar was last shown for, which stays while the
 * tab lives (a toolbar can stay up through any number of loads), the cases
 * drawn on it, and the ids its screenshots wait under, the latest last.
 */
interface TabRecord {
	adding?: string;
	cases: string[];
	pending: string[];
}

/** By `t<tabId>`: a key that is no number keeps the order it was set in. */
type Handed = Record<string, TabRecord>;

const keyOf = (tabId: number) => `t${tabId}`;

const strings = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** A record as stored, or none: anything else (an older shape) counts as none. */
function recordOf(v: unknown): TabRecord | undefined {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
	const o = v as { adding?: unknown; cases?: unknown; pending?: unknown };
	return {
		...(typeof o.adding === "string" ? { adding: o.adding } : {}),
		cases: strings(o.cases),
		pending: strings(o.pending),
	};
}

/** `ids` with `id` the latest, at most `most`. */
const latest = (ids: string[], id: string, most: number) =>
	[...ids.filter((x) => x !== id), id].slice(-most);

/** The records with the tab's changed by `change`, the tab's last. */
function withTab(
	handed: Handed,
	tabId: number,
	change: (was: TabRecord) => TabRecord,
): Handed {
	const key = keyOf(tabId);
	const was = recordOf(handed[key]) ?? { cases: [], pending: [] };
	const { [key]: _, ...others } = handed;
	// The tab handed one last comes last: the oldest tabs go first.
	const kept = Object.entries(others).slice(-(MAX_TABS - 1));
	return { ...Object.fromEntries(kept), [key]: change(was) };
}

export class TabCases {
	readonly #area: SessionArea;
	/** Reads and writes one after the other: no change is lost between them. */
	#queue: Promise<unknown> = Promise.resolve();

	constructor(area: SessionArea) {
		this.#area = area;
	}

	#run<T>(work: (handed: Handed) => { handed?: Handed; result: T }) {
		const next = this.#queue.then(async () => {
			const stored = (await this.#area.get(KEY))[KEY];
			const handed =
				typeof stored === "object" && stored !== null && !Array.isArray(stored)
					? (stored as Handed)
					: {};
			const done = work(handed);
			if (done.handed !== undefined)
				await this.#area.set({ [KEY]: done.handed });
			return done.result;
		});
		// The caller of `next` gets the failure; the queue only waits for it.
		this.#queue = next.catch(() => undefined);
		return next;
	}

	/** The tab was handed the case; `adding`: for its toolbar. */
	record(tabId: number, caseId: string, adding = false): Promise<void> {
		return this.#run((handed) => ({
			handed: withTab(handed, tabId, (was) =>
				adding
					? { ...was, adding: caseId }
					: { ...was, cases: latest(was.cases, caseId, MAX_CASES_A_TAB) },
			),
			result: undefined,
		}));
	}

	/** Whether the tab was handed the case. */
	has(tabId: number, caseId: string): Promise<boolean> {
		return this.#run((handed) => {
			const record = recordOf(handed[keyOf(tabId)]);
			return {
				result:
					record !== undefined &&
					(record.adding === caseId || record.cases.includes(caseId)),
			};
		});
	}

	/**
	 * The tab's screenshots wait under `id`: answers whether they may, which
	 * they may unless another tab's do.
	 */
	claimPending(tabId: number, id: string): Promise<boolean> {
		return this.#run((handed) => {
			const mine = keyOf(tabId);
			const taken = Object.entries(handed).some(
				([key, v]) => key !== mine && recordOf(v)?.pending.includes(id),
			);
			if (taken) return { result: false };
			// Each capture of a save asks again: no write for the one it has.
			if (recordOf(handed[mine])?.pending.at(-1) === id)
				return { result: true };
			return {
				handed: withTab(handed, tabId, (was) => ({
					...was,
					pending: latest(was.pending, id, MAX_PENDING_A_TAB),
				})),
				result: true,
			};
		});
	}

	/** Whether the tab's screenshots wait under `id`. */
	ownsPending(tabId: number, id: string): Promise<boolean> {
		return this.#run((handed) => ({
			result: recordOf(handed[keyOf(tabId)])?.pending.includes(id) === true,
		}));
	}

	/** The tab closed. */
	forget(tabId: number): Promise<void> {
		return this.#run((handed) => {
			const key = keyOf(tabId);
			if (handed[key] === undefined) return { result: undefined };
			const { [key]: _, ...others } = handed;
			return { handed: others, result: undefined };
		});
	}
}
