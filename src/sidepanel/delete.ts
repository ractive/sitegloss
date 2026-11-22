/**
 * A Delete in the panel asks twice (a case, a mark, a finding): the first
 * click arms it ("Really delete?"), a second click deletes. A double click's
 * second is no second thought, and a click long after the first only asks
 * again.
 */

declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/**
 * After a first click: the second click of a double click is no decision.
 * Short in the test build (DEC-053), whose clicks come fast.
 */
export const DELETE_CLICK_GAP_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 100
		: 500;
/** After a first click: a click this much later is no decision either. */
export const DELETE_ARMED_MS = 4000;

/** What a click on a Delete armed at `armedAt` (`undefined`: not armed) does at `now`. */
export function deleteClick(
	armedAt: number | undefined,
	now: number,
): "arm" | "nothing" | "delete" {
	if (armedAt === undefined || now - armedAt >= DELETE_ARMED_MS) return "arm";
	if (now - armedAt < DELETE_CLICK_GAP_MS) return "nothing";
	return "delete";
}
