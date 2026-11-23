import { afterAll, beforeEach, describe, expect, test } from "bun:test";

/** A browser of windows and tabs, enough for the viewer's window (DEC-064). */
function fakeChrome() {
	const store: Record<string, unknown> = {};
	const tabs = new Map<number, { id: number; windowId: number; url: string }>();
	let next = 100;
	const calls: string[] = [];
	const api = {
		runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
		storage: {
			local: {
				get: async (key: string) => ({ [key]: store[key] }),
				set: async (o: Record<string, unknown>) => void Object.assign(store, o),
			},
			session: {
				get: async (key: string) => ({ [key]: store[key] }),
				set: async (o: Record<string, unknown>) => void Object.assign(store, o),
			},
		},
		windows: {
			get: async (id: number) => ({
				id,
				left: 0,
				top: 0,
				width: 1200,
				height: 800,
			}),
			create: async (o: { url: string }) => {
				calls.push("create");
				await new Promise((r) => setTimeout(r, 20));
				const id = next++;
				const tab = { id: next++, windowId: id, url: o.url };
				tabs.set(tab.id, tab);
				return { id, tabs: [tab] };
			},
			update: async () => {
				calls.push("focus");
				return {};
			},
			remove: async () => undefined,
		},
		tabs: {
			get: async (id: number) => {
				const t = tabs.get(id);
				if (!t) throw new Error("no tab");
				return t;
			},
			update: async (id: number, o: { url: string }) => {
				calls.push("update");
				const t = tabs.get(id);
				if (t) t.url = o.url;
				return t;
			},
		},
	};
	return { api, calls, tabs };
}

let browser: ReturnType<typeof fakeChrome>;
const had = (globalThis as { chrome?: unknown }).chrome;
afterAll(() => {
	(globalThis as { chrome?: unknown }).chrome = had;
});
beforeEach(() => {
	browser = fakeChrome();
	(globalThis as { chrome?: unknown }).chrome = browser.api;
});

describe("the viewer's window (DEC-064)", () => {
	test("two quick clicks: one window, the second picture shown in it", async () => {
		const { openViewer } = await import("../src/worker/viewer-window.ts");
		const [a, b] = await Promise.all([
			openViewer("c_1", "m1", "screenshot", 1),
			openViewer("c_1", "m1", "i_a", 1),
		]);
		expect(a).toBe(b);
		expect(browser.calls.filter((c) => c === "create")).toEqual(["create"]);
		const [tab] = [...browser.tabs.values()];
		expect(tab?.url).toContain("picture=i_a");
	});

	test("a viewer tab moved out of its window is the person's: a new window opens", async () => {
		const { openViewer } = await import("../src/worker/viewer-window.ts");
		await openViewer("c_1", "m1", "screenshot", 2);
		const [tab] = [...browser.tabs.values()];
		if (tab) tab.windowId = 999;
		await openViewer("c_1", "m1", "i_a", 2);
		expect(browser.calls.filter((c) => c === "create").length).toBe(2);
		expect(tab?.url).toContain("picture=screenshot");
	});
});

test("a failed open rejects for the caller only: no rejection left unhandled (DEC-064's second review)", async () => {
	const { openViewer } = await import("../src/worker/viewer-window.ts");
	browser.api.windows.get = async () => {
		throw new Error("No window with id: 5");
	};
	const unhandled: unknown[] = [];
	const on = (e: unknown) => void unhandled.push(e);
	process.on("unhandledRejection", on);
	try {
		await expect(openViewer("c_1", "m1", "screenshot", 5)).rejects.toThrow(
			"No window",
		);
		await new Promise((r) => setTimeout(r, 20));
		expect(unhandled).toEqual([]);
	} finally {
		process.off("unhandledRejection", on);
	}
});

test("the window's bounds use the frame the last viewer measured; a layout from the panel is checked (DEC-064)", async () => {
	const { boundsFor, rememberFrame, viewerLayoutOk } = await import(
		"../src/worker/viewer-window.ts"
	);
	const layout = {
		picture: { width: 640, height: 300 },
		over: { left: 0, top: 0, width: 1400, height: 900 },
		screen: { left: 0, top: 0, width: 1920, height: 1200 },
	};
	const first = await boundsFor(layout);
	await rememberFrame(60);
	const after = await boundsFor(layout);
	expect(first.height - after.height).toBe(28);
	expect(viewerLayoutOk(layout)).toBe(true);
	expect(
		viewerLayoutOk({ ...layout, over: { ...layout.over, width: -1 } }),
	).toBe(false);
	expect(
		viewerLayoutOk({ ...layout, picture: { width: Number.NaN, height: 3 } }),
	).toBe(false);
});

describe("the viewer goes with its case (DEC-064's review)", () => {
	test("it stays only while its case is open and not closed", async () => {
		const { viewerStays } = await import("../src/sidepanel/viewer-follow.ts");
		expect(viewerStays("c_1", { id: "c_1" })).toBe(true);
		expect(viewerStays("c_1", { id: "c_2" })).toBe(false);
		expect(viewerStays("c_1", undefined)).toBe(false);
		expect(
			viewerStays("c_1", { id: "c_1", closed: { at: "2026-11-23" } }),
		).toBe(false);
	});
});
