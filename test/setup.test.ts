import {
	afterAll,
	beforeAll,
	describe,
	expect,
	jest,
	spyOn,
	test,
} from "bun:test";
import { SETUP_GUIDE } from "@ractive-ch/tab-mcp-client/setup";
import { Window } from "happy-dom";
import type { Setup } from "../src/sidepanel/setup.ts";

const window = new Window({ url: "chrome-extension://x/sidepanel/index.html" });
const globals = globalThis as unknown as Record<string, unknown>;
const before = { document: globals["document"] };
let setup: Setup;
let SELECTED: string;
let COPIED_MS: number;

const ADDRESS = "https://relay.example/s/sitegloss/mcp";
const el = <T extends HTMLElement>(id: string) =>
	window.document.getElementById(id) as unknown as T;
const steps = () => [
	...el("setup-steps").querySelectorAll<HTMLLIElement>(":scope > li"),
];
const step = (app: string) =>
	el("setup-steps").querySelector<HTMLLIElement>(`li[data-app="${app}"]`);
const clipboard = window.navigator.clipboard;
/** Let the clipboard's promise settle (its microtasks: no timer, so also with fake timers). */
const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};
/** `ms` pass on the fake clock. */
const later = (ms: number) => jest.advanceTimersByTime(ms);

/** The side panel's page, and the setup steps in it. */
beforeAll(async () => {
	window.document.write(
		await Bun.file(
			new URL("../src/sidepanel/index.html", import.meta.url),
		).text(),
	);
	globals["document"] = window.document;
	const module = await import("../src/sidepanel/setup.ts");
	({ SELECTED, COPIED_MS } = module);
	setup = module.startSetup();
});

afterAll(() => {
	globals["document"] = before.document;
});

describe("How do I add it?", () => {
	test("hidden, and no steps, without an address", () => {
		setup.show("");
		expect(el("setup").hidden).toBe(true);
		expect(steps()).toEqual([]);
	});

	test("collapsed under the address, the guide link last, the status outside", () => {
		setup.show(ADDRESS);
		const details = el<HTMLDetailsElement>("setup");
		expect(details.hidden).toBe(false);
		expect(details.open).toBe(false);
		expect(details.querySelector("summary")?.textContent).toBe(
			"How do I add it?",
		);
		expect(el("pair-address").parentElement?.nextElementSibling?.id).toBe(
			"setup",
		);
		const link = details.lastElementChild?.querySelector("a");
		expect(link?.id).toBe("setup-guide");
		expect(link?.getAttribute("href")).toBe(SETUP_GUIDE);
		expect(link?.textContent).toBe(
			"Step by step, and what to do when it fails",
		);
		expect(details.contains(el("copy-status"))).toBe(false);
		expect(el("copy-status").getAttribute("role")).toBe("status");
		// The guide is no separate how-to link any more.
		expect(
			el("pairing").querySelectorAll(`a[href="${SETUP_GUIDE}"]`).length,
		).toBe(1);
	});

	test("each AI app with its text; commands for Claude Code and Codex, naming sitegloss-browser", () => {
		setup.show(ADDRESS);
		expect(
			steps().map((li) => li.querySelector("strong")?.textContent),
		).toEqual([
			"Claude (claude.ai and the desktop app)",
			"ChatGPT",
			"Claude Code",
			"Codex",
		]);
		for (const li of steps())
			expect(li.querySelector("span")?.textContent).not.toBe("");
		for (const app of ["claude", "chatgpt"])
			expect(step(app)?.querySelector("pre")).toBeNull();
		for (const [app, name] of [
			["claude-code", "Claude Code"],
			["codex", "Codex"],
		] as const) {
			const pre = step(app)?.querySelector("pre");
			expect(pre?.getAttribute("dir")).toBe("ltr");
			expect(pre?.textContent).toContain(` sitegloss-browser `);
			expect(pre?.textContent).toContain(ADDRESS);
			const copy = step(app)?.querySelector("button");
			expect(copy?.textContent).toBe("Copy");
			expect(copy?.getAttribute("aria-label")).toBe(`Copy ${name} command`);
		}
		// Not "sitegloss": sitegloss.dev's own MCP server has that name in the same app.
		expect(step("claude-code")?.querySelector("pre")?.textContent).toBe(
			`claude mcp add --transport http sitegloss-browser ${ADDRESS}`,
		);
	});

	test("a note's code as code, its text as text", () => {
		setup.show(ADDRESS);
		const notes = el("setup-steps").querySelectorAll(".note");
		expect(notes.length).toBeGreaterThan(0);
		for (const note of notes)
			for (const child of note.childNodes)
				expect(
					child.nodeType === 3 || (child as Element).tagName === "CODE",
				).toBe(true);
	});

	test("Copy copies the command as it is, says Copied and in the status line", async () => {
		setup.show(ADDRESS);
		const written: string[] = [];
		const spy = spyOn(clipboard, "writeText").mockImplementation(
			async (text: string) => {
				written.push(text);
			},
		);
		try {
			jest.useFakeTimers();
			const pre = step("codex")?.querySelector("pre");
			const copy = step("codex")?.querySelector("button") as HTMLButtonElement;
			copy.click();
			await settle();
			expect(written).toEqual([pre?.textContent ?? ""]);
			expect(copy.textContent).toBe("Copied");
			expect(copy.getAttribute("aria-label")).toBe("Copied Codex command");
			expect(el("copy-status").textContent).toBe("Copied Codex command");
			// The same address again: the list stays, and its "Copied".
			setup.show(ADDRESS);
			expect(step("codex")?.querySelector("button")).toBe(copy);
			expect(copy.textContent).toBe("Copied");
			later(COPIED_MS + 50);
			expect(copy.textContent).toBe("Copy");
			expect(copy.getAttribute("aria-label")).toBe("Copy Codex command");
		} finally {
			jest.useRealTimers();
			spy.mockRestore();
		}
	});

	test("a second Copy keeps saying Copied for its own full time", async () => {
		setup.show(ADDRESS);
		const spy = spyOn(clipboard, "writeText").mockImplementation(
			async () => {},
		);
		try {
			jest.useFakeTimers();
			const copy = step("codex")?.querySelector("button") as HTMLButtonElement;
			copy.click();
			await settle();
			later(COPIED_MS / 2);
			copy.click();
			await settle();
			// Past the first Copy's time, within the second's.
			later(COPIED_MS / 2 + 100);
			expect(copy.textContent).toBe("Copied");
			expect(copy.getAttribute("aria-label")).toBe("Copied Codex command");
			later(COPIED_MS / 2 + 50);
			expect(copy.textContent).toBe("Copy");
		} finally {
			jest.useRealTimers();
			spy.mockRestore();
		}
	});

	test("a refused clipboard selects the command and says how to copy it", async () => {
		setup.show(ADDRESS);
		const spy = spyOn(clipboard, "writeText").mockImplementation(async () => {
			throw new Error("Document is not focused");
		});
		try {
			const pre = step("claude-code")?.querySelector("pre");
			const copy = step("claude-code")?.querySelector(
				"button",
			) as HTMLButtonElement;
			copy.click();
			await settle();
			expect(copy.textContent).toBe("Copy");
			expect(window.document.getSelection()?.toString()).toBe(
				pre?.textContent ?? "",
			);
			expect(el("copy-status").textContent).toBe(SELECTED);
		} finally {
			spy.mockRestore();
		}
	});

	test("another address (another relay) makes the steps again", () => {
		setup.show(ADDRESS);
		const first = step("codex");
		const other = "https://other.example/s/sitegloss/mcp";
		setup.show(other);
		expect(step("codex")).not.toBe(first);
		expect(step("codex")?.querySelector("pre")?.textContent).toContain(other);
	});

	test.each([
		"https://relay.example/s/x'y/mcp",
		"https://relay.example/s/$(id)/mcp",
		"https://relay.example/s/x y/mcp",
	])(
		"an address a shell would not read as plain (%s): no commands",
		(address) => {
			setup.show(address);
			expect(steps().length).toBe(4);
			expect(el("setup-steps").querySelector("pre")).toBeNull();
			expect(
				el("setup-steps").querySelector('button[aria-label$=" command"]'),
			).toBeNull();
			// Only as text, never as markup.
			expect(el("setup-steps").querySelector("img, script")).toBeNull();
		},
	);

	test("text only as text: markup in the address stays text", () => {
		setup.show('https://relay.example/s/<img src=x onerror="1">/mcp');
		expect(el("setup-steps").querySelector("img")).toBeNull();
		setup.show("");
	});
});
