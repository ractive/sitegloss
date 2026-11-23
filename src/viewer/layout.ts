/**
 * How the picture viewer's window and its picture are laid out (DEC-064),
 * pure so it is tested without a browser: the window's bounds, known before
 * the window exists (so it opens at its size and place in one step, no
 * resize once it is shown), whether "Actual size" changes anything, and
 * whether Previous and Next are offered.
 */

export interface Size {
	width: number;
	height: number;
}

export interface Bounds extends Size {
	left: number;
	top: number;
}

/** Around the picture in the window: the stage's padding and the picture's edge. */
export const PICTURE_PAD = 34;
/** The viewer's bar, one line. */
export const BAR_HEIGHT = 56;
/**
 * The window's frame above the page (a popup's title and address bars), which
 * `chrome.windows.create` counts in its height: 88 px measured in Chrome; the
 * viewer measures it each time it opens and the next window uses that.
 */
export const WINDOW_FRAME = 88;
/** Never narrower than the bar needs on one line, never lower than this. */
export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 360;
/** Kept from the screen's edges. */
export const SCREEN_MARGIN = 16;

const clamp = (n: number, low: number, high: number) =>
	Math.min(Math.max(n, low), Math.max(low, high));

/**
 * The window for a picture of `picture` pixels (none: not known), centred
 * over the browser window `over`, inside the screen's free area `screen`: as
 * large as the picture at its size and the bar need, and no larger than the
 * screen leaves.
 */
export function viewerBounds(
	picture: Size | undefined,
	over: Bounds,
	screen: Bounds,
	frame: number = WINDOW_FRAME,
): Bounds {
	const roomW = screen.width - 2 * SCREEN_MARGIN;
	const roomH = screen.height - 2 * SCREEN_MARGIN;
	const want: Size =
		picture === undefined
			? { width: over.width * 0.85, height: over.height * 0.85 }
			: {
					width: picture.width + PICTURE_PAD,
					height: picture.height + PICTURE_PAD + BAR_HEIGHT + frame,
				};
	const width = Math.round(
		clamp(want.width, Math.min(MIN_WIDTH, roomW), roomW),
	);
	const height = Math.round(
		clamp(want.height, Math.min(MIN_HEIGHT, roomH), roomH),
	);
	const left = Math.round(
		clamp(
			over.left + (over.width - width) / 2,
			screen.left + SCREEN_MARGIN,
			screen.left + SCREEN_MARGIN + roomW - width,
		),
	);
	const top = Math.round(
		clamp(
			over.top + (over.height - height) / 2,
			screen.top + SCREEN_MARGIN,
			screen.top + SCREEN_MARGIN + roomH - height,
		),
	);
	return { left, top, width, height };
}

/**
 * What the size control offers for a picture of `natural` pixels in `room`
 * (the stage's inner size): it switches only where the picture is larger
 * than the room in one direction, so fitting makes it smaller; `fitted` is
 * the share it is shown at, fitted (1 where it fits).
 */
export function sizeChoice(
	natural: Size,
	room: Size,
): { canSwitch: boolean; fitted: number } {
	const fitted = Math.min(
		1,
		room.width / Math.max(1, natural.width),
		room.height / Math.max(1, natural.height),
	);
	return { canSwitch: fitted < 1, fitted };
}

/** Previous, Next, "1 of n" and the arrow keys: only for more than one picture. */
export const offersNavigation = (pictures: number) => pictures > 1;
