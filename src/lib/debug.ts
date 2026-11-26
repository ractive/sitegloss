/**
 * A failure that is handled, or does not matter, said in a development build
 * (and the test build) and nowhere in a build that goes to people (`--store`,
 * `--zip`): there the build's define makes it nothing, and the bundler drops
 * the call's body. The unit tests, without the define, stay quiet.
 *
 * Only the place and the error's name and message, with anything like an
 * e-mail address or a token taken out: no log line carries either.
 */

declare const SITEGLOSS_DEBUG: boolean | undefined;

const ON = typeof SITEGLOSS_DEBUG !== "undefined" && SITEGLOSS_DEBUG;

/** What of an error is said: its name and message, e-mail addresses and tokens taken out. */
export function debugText(error: unknown): string {
	const text =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return text
		.replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, "<e-mail>")
		.replace(/[A-Za-z0-9_\-+/=.]{32,}/g, "<…>")
		.slice(0, 300);
}

/** Say in a development build that `where` failed, and how. */
export function debugLog(where: string, error: unknown): void {
	if (ON) console.debug(`Sitegloss: ${where}:`, debugText(error));
}
