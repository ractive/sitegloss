/**
 * Which marks the toolbar of which page added (service worker). Undo in the
 * toolbar takes a mark out of its case; the worker allows that only for a mark
 * recorded here, from the same tab and document, and only once (DEC-014). So a
 * content script cannot use Undo to delete marks it did not just add. Kept in
 * `chrome.storage.session`: it outlives a stopped service worker, not the
 * browser, and content scripts cannot reach it.
 */

/** A mark one add stored, and the page that added it. */
export interface AddedMark {
	caseId: string;
	markId: string;
	/** Its screenshot's id in the case, and its comment, as the add stored them. */
	shot: string;
	comment: string;
	tabId: number;
	documentId: string;
}

/** The part of `chrome.storage.session` used here. */
export interface SessionArea {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
}

const KEY = "addedMarks";

/** The most marks remembered; the oldest go first. */
export const MAX_REMEMBERED = 500;

export class AddLedger {
	readonly #area: SessionArea;
	/** Reads and writes one after the other: no change is lost between them. */
	#queue: Promise<unknown> = Promise.resolve();

	constructor(area: SessionArea) {
		this.#area = area;
	}

	#run<T>(work: (marks: AddedMark[]) => { marks?: AddedMark[]; result: T }) {
		const next = this.#queue.then(async () => {
			const stored = (await this.#area.get(KEY))[KEY];
			const marks = Array.isArray(stored) ? (stored as AddedMark[]) : [];
			const done = work(marks);
			if (done.marks !== undefined) await this.#area.set({ [KEY]: done.marks });
			return done.result;
		});
		this.#queue = next.catch(() => undefined);
		return next;
	}

	record(mark: AddedMark): Promise<void> {
		return this.#run((marks) => ({
			marks: [...marks.filter((m) => !same(m, mark)), mark].slice(
				-MAX_REMEMBERED,
			),
			result: undefined,
		}));
	}

	/** The mark if this tab and document added it. */
	find(
		caseId: string,
		markId: string,
		tabId: number | undefined,
		documentId: string | undefined,
	): Promise<AddedMark | undefined> {
		return this.#run((marks) => ({
			result: marks.find(
				(m) =>
					m.caseId === caseId &&
					m.markId === markId &&
					tabId !== undefined &&
					documentId !== undefined &&
					m.tabId === tabId &&
					m.documentId === documentId,
			),
		}));
	}

	/** Forget it: an undo is used once. */
	remove(mark: AddedMark): Promise<void> {
		return this.#run((marks) => ({
			marks: marks.filter((m) => !same(m, mark)),
			result: undefined,
		}));
	}
}

const same = (a: AddedMark, b: AddedMark) =>
	a.caseId === b.caseId && a.markId === b.markId;
