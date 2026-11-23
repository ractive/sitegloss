import { describe, expect, test } from "bun:test";
import {
	BAR_HEIGHT,
	MIN_WIDTH,
	offersNavigation,
	PICTURE_PAD,
	SCREEN_MARGIN,
	sizeChoice,
	viewerBounds,
	WINDOW_FRAME,
} from "../src/viewer/layout.ts";

const screen = { left: 0, top: 25, width: 1920, height: 1175 };
const browser = { left: 100, top: 60, width: 1400, height: 900 };

describe("the viewer's window, before it exists (DEC-064)", () => {
	test("a small picture: as large as it needs, at least the bar's width, centred over the browser", () => {
		const b = viewerBounds({ width: 640, height: 300 }, browser, screen);
		expect(b.width).toBe(Math.max(MIN_WIDTH, 640 + PICTURE_PAD));
		expect(b.height).toBe(300 + PICTURE_PAD + BAR_HEIGHT + WINDOW_FRAME);
		expect(b.left + b.width / 2).toBeCloseTo(
			browser.left + browser.width / 2,
			0,
		);
		expect(b.top + b.height / 2).toBeCloseTo(
			browser.top + browser.height / 2,
			0,
		);
	});

	test("a picture larger than the screen: the screen less its margins, inside it", () => {
		for (const picture of [
			{ width: 2400, height: 900 },
			{ width: 800, height: 2400 },
		]) {
			const b = viewerBounds(picture, browser, screen);
			expect(b.width).toBeLessThanOrEqual(screen.width - 2 * SCREEN_MARGIN);
			expect(b.height).toBeLessThanOrEqual(screen.height - 2 * SCREEN_MARGIN);
			expect(b.left).toBeGreaterThanOrEqual(screen.left + SCREEN_MARGIN);
			expect(b.top).toBeGreaterThanOrEqual(screen.top + SCREEN_MARGIN);
			expect(b.left + b.width).toBeLessThanOrEqual(
				screen.left + screen.width - SCREEN_MARGIN,
			);
			expect(b.top + b.height).toBeLessThanOrEqual(
				screen.top + screen.height - SCREEN_MARGIN,
			);
		}
	});

	test("a small screen: never larger than it; an unknown size: most of the browser window", () => {
		const small = { left: 0, top: 0, width: 800, height: 600 };
		const b = viewerBounds({ width: 1200, height: 900 }, small, small);
		expect([b.width, b.height]).toEqual([800 - 32, 600 - 32]);
		const unknown = viewerBounds(undefined, browser, screen);
		expect(unknown.width).toBe(Math.round(browser.width * 0.85));
	});
});

describe("what the viewer offers (DEC-064)", () => {
	test("a picture that fits, or fits exactly: nothing to switch, shown at 100%", () => {
		expect(
			sizeChoice({ width: 640, height: 300 }, { width: 900, height: 600 }),
		).toEqual({
			canSwitch: false,
			fitted: 1,
		});
		expect(
			sizeChoice({ width: 900, height: 600 }, { width: 900, height: 600 }),
		).toEqual({
			canSwitch: false,
			fitted: 1,
		});
	});

	test("a picture larger than the window: Fit to window shows it smaller, Actual size at 100%", () => {
		const wide = sizeChoice(
			{ width: 2400, height: 900 },
			{ width: 1200, height: 800 },
		);
		expect(wide.canSwitch).toBe(true);
		expect(wide.fitted).toBe(0.5);
		const tall = sizeChoice(
			{ width: 800, height: 2400 },
			{ width: 1200, height: 800 },
		);
		expect(tall.fitted).toBeCloseTo(1 / 3, 5);
	});

	test("one picture: no Previous, no Next, no '1 of 1'; two: they are there", () => {
		expect(offersNavigation(1)).toBe(false);
		expect(offersNavigation(2)).toBe(true);
	});
});
