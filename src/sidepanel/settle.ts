import type { Loaded } from "./state.ts";

/**
 * A draw of case `caseId` on tab `tabId` that stopped (busy too long, the
 * tab or the case changed, the searches again over): no longer settling, so
 * the status line may say what it found (DEC-064's second review).
 * Undefined: nothing to change (another draw's, or settled already).
 */
export function settledLoaded(
	loaded: Loaded | undefined,
	caseId: string,
	tabId: number,
): Loaded | undefined {
	if (loaded?.caseId !== caseId || loaded.tabId !== tabId) return undefined;
	if (loaded.settling !== true) return undefined;
	return { ...loaded, settling: false };
}
