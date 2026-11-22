/**
 * The waits an end-to-end test may shorten for itself (DEC-053): the
 * timeouts after which Sitegloss calls something failed, and the panel's
 * searches again. A test sets `globalThis.siteglossTestWaits` in the context
 * it drives (the panel's page, the worker), for example
 * `{ endMs: 300 }`; every other test, and every other build, keeps the real
 * wait. The guards against a click that comes too soon are short in the
 * whole test build instead, where they are defined.
 */

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

export type TestWait =
	/** The panel's wait for the toolbars to end (`endToolbars`). */
	| "endMs"
	/** The panel's wait for the page to answer a button's ask. */
	| "pageAnswerMs"
	/** The worker's wait for Chrome's `captureVisibleTab`. */
	| "captureMs"
	/** The step of the panel's searches again after a load: at 0, 1 and 3 steps. */
	| "searchAgainMs"
	/** The panel's look once more after a route change. */
	| "routeSettleMs";

/** `ms`, or in a test build what the test set for `name` in this context. */
export function testWait(name: TestWait, ms: number): number {
	// The define itself: other builds drop this.
	if (typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD) {
		const set = (
			globalThis as { siteglossTestWaits?: Partial<Record<TestWait, unknown>> }
		).siteglossTestWaits?.[name];
		if (typeof set === "number" && set >= 0) return set;
	}
	return ms;
}
