/**
 * Whether the picture viewer's window of case `caseId` stays (DEC-064): only
 * while that case is the one open in the panel, and not closed. Asked at
 * every render, and once more when the window has opened, for a case left
 * while it opened.
 */
export function viewerStays(
	caseId: string,
	current: { id: string; closed?: unknown } | undefined,
): boolean {
	return current?.id === caseId && current.closed === undefined;
}
