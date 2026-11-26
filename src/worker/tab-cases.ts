/**
 * Which cases each tab was handed (service worker): the side panel's
 * toolbar for a case (`overlay:show`), a case's marks drawn on the page
 * (`case:load`, from the panel or an AI app's tool). A page adds marks only
 * to a case it was handed, and `case:save` from a tab is refused for any
 * other: a compromised renderer cannot write into a case it was never
 * given, even knowing its id. Kept in `chrome.storage.session` as the undo
 * ledger is (undo.ts): it outlives a stopped service worker, not the
 * browser, and content scripts cannot reach it.
 */

import type { SessionArea } from "../lib/undo.ts";

const KEY = "tabCases";

/** The most cases remembered for one tab, and the most tabs; the oldest go first. */
export const MAX_CASES_A_TAB = 20;
export const MAX_TABS = 200;

/** By `t<tabId>`: a key that is no number keeps the order it was set in. */
type Handed = Record<string, string[]>;

const keyOf = (tabId: number) => `t${tabId}`;

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
		this.#queue = next.catch(() => undefined);
		return next;
	}

	/** The tab was handed the case. */
	record(tabId: number, caseId: string): Promise<void> {
		return this.#run((handed) => {
			const key = keyOf(tabId);
			const cases = (handed[key] ?? []).filter((id) => id !== caseId);
			const { [key]: _, ...others } = handed;
			// The tab handed one last comes last: the oldest tabs go first.
			const kept = Object.entries(others).slice(-(MAX_TABS - 1));
			return {
				handed: {
					...Object.fromEntries(kept),
					[key]: [...cases, caseId].slice(-MAX_CASES_A_TAB),
				},
				result: undefined,
			};
		});
	}

	/** Whether the tab was handed the case. */
	has(tabId: number, caseId: string): Promise<boolean> {
		return this.#run((handed) => ({
			result: handed[keyOf(tabId)]?.includes(caseId) === true,
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
