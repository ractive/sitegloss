/**
 * The page's review bar's place (DEC-061): where the person left it, the
 * same in every tab of this profile, kept by the service worker.
 */

/** Where it is kept, in the extension's `storage.local`. */
export const BAR_PLACE_KEY = "sitegloss.barPlace";

/** The review bar's place: its distance from the window's right edge and from its top, in px (DEC-061). */
export interface BarPlace {
	right: number;
	top: number;
}

/** Where the bar is at first, and after a double click on it or Home on its handle. */
export const BAR_HOME: BarPlace = { right: 16, top: 16 };

/** How far an arrow key moves the bar; with Shift, four times that. */
export const BAR_STEP = 16;

/**
 * `place` kept inside a window of `vw` × `vh` for a bar of `w` × `h`, 8 px
 * from each edge; a window too small for it keeps it at the top right.
 */
export function clampBar(
	place: BarPlace,
	w: number,
	h: number,
	vw: number,
	vh: number,
): BarPlace {
	const keep = (v: number, max: number) =>
		Math.round(Math.max(8, Math.min(v, Math.max(8, max))));
	return {
		right: keep(place.right, vw - w - 8),
		top: keep(place.top, vh - h - 8),
	};
}

/** A stored place, read back: one that is not two numbers is none. */
export function storedBarPlace(value: unknown): BarPlace | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { right, top } = value as Record<string, unknown>;
	return typeof right === "number" &&
		typeof top === "number" &&
		Number.isFinite(right) &&
		Number.isFinite(top)
		? { right, top }
		: undefined;
}
