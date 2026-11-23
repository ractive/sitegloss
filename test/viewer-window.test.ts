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
