import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setSystemTime,
	test,
} from "bun:test";
import { Window } from "happy-dom";
import type { Case, Mark } from "../src/lib/case.ts";
import { summarize } from "../src/lib/element.ts";
import type { MarkMatch } from "../src/lib/messages.ts";
import { pageFilterEnds, statusLeft } from "../src/sidepanel/page-filter.ts";
import { initialState, type PanelState } from "../src/sidepanel/state.ts";
import type { Actions } from "../src/sidepanel/view.ts";
import { sampleCase, withOneMark } from "./fixtures.ts";

const window = new Window({ url: "chrome-extension://x/sidepanel/index.html" });
const globals = globalThis as unknown as Record<string, unknown>;
const before = { document: globals["document"] };
let render: (state: PanelState, actions: Actions) => void;
let afterVerify: typeof import("../src/sidepanel/view.ts")["afterVerify"];
let ago: (iso: string, now?: number) => string;
let webAppNote: (state: PanelState) => string | undefined;
let TALKING_AFTER_MS: number;
let holdTalkingFor: (ms: number) => void;
let pagePath: (url: string) => string;
let noneFoundText: (
	c: Case,
	url: string | undefined,
	allLost: boolean,
) => string | undefined;
let ASKING_DOWNLOADS: string;
let IMPORT_BUSY: string;
let EXPORT_ALL_BUSY: string;

/** Actions that do nothing, except for `some`. */
const actionsWith = (some: Partial<Actions>) =>
	new Proxy(some as Actions, {
		get: (target, key: keyof Actions) => target[key] ?? (() => undefined),
	});
const noActions = actionsWith({});
const el = <T extends HTMLElement>(id: string) =>
	window.document.getElementById(id) as unknown as T;

/** The side panel's page, and `view.ts` drawing into it. */
beforeAll(async () => {
	window.document.write(
		await Bun.file(
			new URL("../src/sidepanel/index.html", import.meta.url),
		).text(),
	);
	globals["document"] = window.document;
	({
		render,
		afterVerify,
		ASKING_DOWNLOADS,
		IMPORT_BUSY,
		EXPORT_ALL_BUSY,
		webAppNote,
		noneFoundText,
		TALKING_AFTER_MS,
		holdTalkingFor,
		pagePath,
	} = await import("../src/sidepanel/view.ts"));
	({ ago } = await import("../src/sidepanel/cloud-view.ts"));
});

afterAll(() => {
	globals["document"] = before.document;
});

function caseState(c: Case, change?: (s: PanelState) => void): PanelState {
	const state = initialState();
	state.view = { kind: "case", id: c.id };
	state.current = c;
	change?.(state);
	return state;
}

describe("the tab", () => {
	const home = (
		tab: PanelState["tab"],
		change?: (s: PanelState) => void,
		actions: Actions = noActions,
	) => {
		const state = initialState();
		state.tab = tab;
		change?.(state);
		render(state, actions);
	};
	const text = (id: string) => el(id).textContent;
	const allow = () =>
		el("access-notice").querySelector(
			'[data-action="allow-all-sites"]',
		) as unknown as HTMLButtonElement;

	test("one heading, This page: its address, else its title, else nothing more", () => {
		expect(text("page-heading")).toBe("This page");
		home({ id: 1, url: "", title: "", size: undefined });
		expect(el("page").hidden).toBe(true);
		home({ id: 1, url: "", title: "Kasse", size: undefined });
		expect(el("page").hidden).toBe(false);
		expect(text("page")).toBe("Kasse");
	});

	test("without an address: a notice with a warning sign, the icon's click and Allow on all sites", () => {
		const asked: string[] = [];
		home({ id: 1, url: "", title: "", size: undefined }, undefined, {
			...noActions,
			allowAllSites: () => asked.push("all"),
		} as Actions);
		const notice = el("access-notice");
		expect(notice.hidden).toBe(false);
		expect(notice.querySelector("svg.notice-icon")).not.toBeNull();
		expect(notice.textContent).toContain("Click the Sitegloss icon");
		// It stands above New case for this page, and the hint below says nothing.
		expect(notice.nextElementSibling).toBe(el("new-case"));
		expect(el("hint").hidden).toBe(true);
		expect(allow().hidden).toBe(false);
		allow().click();
		expect(asked).toEqual(["all"]);
		// Marking needs the page: off, and its title points at the notice.
		expect(el<HTMLButtonElement>("new-case").disabled).toBe(true);
		expect(el("new-case").title).toContain("see the notice");
	});

	test("without an address although Sitegloss may run on all sites: Chrome's own pages, no button", () => {
		home({ id: 1, url: "", title: "", size: undefined }, (s) => {
			s.allSites = true;
		});
		expect(el("access-notice").hidden).toBe(false);
		expect(text("access-notice")).toContain("cannot run on this tab");
		expect(allow().hidden).toBe(true);
		expect(el<HTMLButtonElement>("new-case").disabled).toBe(true);
	});

	test("a tab still loading has no address yet: no notice", () => {
		home({ id: 1, url: "", title: "", size: undefined, loading: true });
		expect(el("access-notice").hidden).toBe(true);
		expect(el<HTMLButtonElement>("new-case").disabled).toBe(false);
	});

	test("with an address: no notice, New case for this page on", () => {
		home({
			id: 1,
			url: "https://www.example.com/kk",
			title: "KK",
			size: undefined,
		});
		expect(text("page")).toBe("www.example.com/kk");
		expect(el("hint").hidden).toBe(true);
		expect(el("access-notice").hidden).toBe(true);
		expect(el<HTMLButtonElement>("new-case").disabled).toBe(false);
	});

	test("a hint of its own goes first", () => {
		const state = initialState();
		state.tab = { id: 1, url: "", title: "", size: undefined };
		state.hint = "Saving";
		render(state, noActions);
		expect(text("hint")).toBe("Saving");
	});
});

describe("the case list", () => {
	test("no Load of its own: opening any case draws its marks (DEC-022)", () => {
		const mine = sampleCase("c_here");
		const theirs = {
			...sampleCase("c_there"),
			page: { ...mine.page, url: "https://www.example.com/elsewhere" },
		};
		const state = initialState();
		state.tab = { id: 1, url: mine.page.url, title: "", size: undefined };
		state.cases = [mine, theirs];
		const opened: string[] = [];
		render(state, actionsWith({ openCase: (id) => opened.push(id) }));
		expect(window.document.querySelector("[data-load]")).toBeNull();
		for (const id of ["c_here", "c_there"])
			(
				window.document.querySelector(
					`[data-case="${id}"]`,
				) as unknown as HTMLElement
			).click();
		expect(opened).toEqual(["c_here", "c_there"]);
	});
});

describe("a mark's status and actions", () => {
	const mark = (n: number, resolution?: Mark["resolution"]): Mark => ({
		id: `m${n}`,
		number: n,
		shot: "s1",
		comment: `Comment ${n}`,
		author: "user",
		shape: { kind: "note", at: { x: 1, y: 1 } },
		crop: `crops/m${n}.webp`,
		element: null,
		...(resolution ? { resolution } : {}),
	});
	// Its own case each: rows of a case unchanged are kept, with their handlers.
	let n = 0;
	const twoMarks = (): Case => ({
		...sampleCase(`c_marks${++n}`),
		marks: [
			mark(1),
			mark(2, {
				kind: "wontfix",
				note: "Legal wants it",
				at: "2026-11-08T10:00:00Z",
			}),
		],
	});
	const row = (id: string) =>
		window.document.querySelector(
			`[data-mark="${id}"]`,
		) as unknown as HTMLElement;
	const action = (id: string, name: string) =>
		row(id).querySelector(
			`[data-mark-action="${name}"]`,
		) as unknown as HTMLButtonElement;
	const chips = () =>
		[...window.document.querySelectorAll("#case-status .chip")].map((b) =>
			(b.textContent ?? "").trim(),
		);

	test("a resolved mark says how, with its note, and the chips sum up", () => {
		render(caseState(twoMarks()), noActions);
		expect(row("m2").dataset["resolved"]).toBe("wontfix");
		expect(row("m2").querySelector(".history")?.textContent).toMatch(
			/^Won't fix .+ · Legal wants it$/,
		);
		expect(row("m1").querySelector(".history")).toBeNull();
		expect(chips()).toEqual(["● Open 1", "– Dismissed 1"]);
		expect(action("m1", "resolve").textContent).toBe("Resolve…");
		expect(action("m2", "reopen").textContent).toBe("Reopen…");
	});

	test("Resolve opens its form; the choice and note go to resolveMark", () => {
		const c = twoMarks();
		const calls: unknown[] = [];
		const actions = actionsWith({
			editMark: (_c, a, mode) => calls.push(["edit", a.id, mode]),
			resolveMark: (_c, a, kind, note) =>
				calls.push(["resolve", a.id, kind, note]),
		});
		render(caseState(c), actions);
		action("m1", "resolve").click();
		render(
			caseState(c, (s) => {
				s.markEdit = {
					markId: "m1",
					mark: "",
					mode: "resolve",
					kind: "fixed",
					text: "",
				};
			}),
			actions,
		);
		const form = row("m1").querySelector(
			"[data-form=resolve]",
		) as unknown as HTMLElement;
		const radio = form.querySelector(
			'input[value="cantreproduce"]',
		) as unknown as HTMLInputElement;
		radio.checked = true;
		(form.querySelector("input.note") as unknown as HTMLInputElement).value =
			"Not on dev";
		(
			form.querySelector(
				'[data-mark-action="resolve-done"]',
			) as unknown as HTMLElement
		).click();
		expect(calls).toEqual([
			["edit", "m1", "resolve"],
			["resolve", "m1", "cantreproduce", "Not on dev"],
		]);
	});

	test("a form takes the focus when it opens, not at each redraw", async () => {
		const c = twoMarks();
		const editing = (updatedAt: string) =>
			caseState({ ...c, updatedAt }, (s) => {
				s.markEdit = {
					markId: "m1",
					mark: "",
					mode: "comment",
					kind: "fixed",
					text: "x",
				};
			});
		render(editing("2026-11-08T10:00:00Z"), noActions);
		await Promise.resolve();
		const comment = row("m1").querySelector(
			"textarea",
		) as unknown as HTMLElement;
		expect(window.document.activeElement).toBe(comment as never);
		el<HTMLTextAreaElement>("verdict").focus();
		// Another window or an AI app changed the case: the list is drawn again.
		render(editing("2026-11-08T10:01:00Z"), noActions);
		await Promise.resolve();
		expect(window.document.activeElement).toBe(el("verdict") as never);
	});

	test("AI findings show under the comment with their app; Delete asks once more", () => {
		const c: Case = {
			...twoMarks(),
			marks: [
				{
					...mark(1),
					findings: [
						{
							id: "f_1",
							text: "Padding in Card.tsx",
							app: {
								id: "https://claude.ai/oauth",
								name: "Claude",
								host: "claude.ai",
							},
							at: "2026-11-10T10:00:00Z",
						},
						{
							id: "f_2",
							text: "From a file",
							app: { id: "x", host: "other.example" },
							at: "2026-11-10T10:00:00Z",
							imported: true,
						},
					],
				},
				mark(2),
			],
		};
		const deleted: string[] = [];
		const actions = actionsWith({
			deleteFinding: (_c, a, id) => void deleted.push(`${a.id}:${id}`),
		});
		render(
			caseState(c, (s) => {
				s.findingDeleteArmed = {
					markId: "m1",
					mark: "",
					findingId: "f_2",
					at: 1,
				};
			}),
			actions,
		);
		const finding = (id: string) =>
			row("m1").querySelector(
				`[data-finding="${id}"]`,
			) as unknown as HTMLElement;
		expect(row("m1").querySelector(".findings-count")?.textContent).toBe(
			"2 AI findings",
		);
		expect(row("m2").querySelector(".findings")).toBeNull();
		expect(finding("f_1").querySelector(".finding-text")?.textContent).toBe(
			"Padding in Card.tsx",
		);
		expect(finding("f_1").textContent).toContain("Claude (claude.ai), ");
		expect(finding("f_2").textContent).toContain(
			"other.example, as the file says",
		);
		const button = (id: string) =>
			finding(id).querySelector(
				'[data-finding-action="delete"]',
			) as unknown as HTMLButtonElement;
		expect(button("f_1").textContent).toBe("Delete finding");
		expect(button("f_2").textContent).toBe("Really delete?");
		button("f_1").click();
		expect(deleted).toEqual(["m1:f_1"]);
	});

	test("a finding gone from a mark whose comment form is open: the form stays, with its draft", () => {
		const c: Case = {
			...twoMarks(),
			marks: [
				{
					...mark(1),
					findings: [
						{
							id: "f_1",
							text: "Padding in Card.tsx",
							app: { id: "x", host: "other.example" },
							at: "2026-11-10T10:00:00Z",
						},
					],
				},
				mark(2),
			],
		};
		const editing = (value: Case) =>
			caseState(value, (s) => {
				s.markEdit = {
					markId: "m1",
					mark: "",
					mode: "comment",
					kind: "fixed",
					text: "A draft not saved yet",
				};
			});
		render(editing(c), noActions);
		const { findings: _gone, ...bare } = c.marks[0] as Mark;
		render(
			editing({
				...c,
				updatedAt: "2026-11-10T11:00:00Z",
				marks: [bare, mark(2)],
			}),
			noActions,
		);
		expect(row("m1").querySelector("[data-finding]")).toBeNull();
		expect(row("m1").querySelector('[data-form="comment"]')).not.toBeNull();
		expect(
			(row("m1").querySelector("textarea") as unknown as HTMLTextAreaElement)
				.value,
		).toBe("A draft not saved yet");
	});

	test("a finding's Delete, clicked once, asks on its own mark only: ids repeat on other marks", () => {
		const finding = (id: string) => ({
			id,
			text: "Same id elsewhere",
			app: { id: "x", host: "other.example" },
			at: "2026-11-10T10:00:00Z",
		});
		const c: Case = {
			...twoMarks(),
			marks: [
				{ ...mark(1), findings: [finding("f_1")] },
				{ ...mark(2), findings: [finding("f_1")] },
			],
		};
		render(
			caseState(c, (s) => {
				s.findingDeleteArmed = {
					markId: "m2",
					mark: "",
					findingId: "f_1",
					at: 1,
				};
			}),
			noActions,
		);
		const button = (markId: string) =>
			row(markId).querySelector(
				'[data-finding="f_1"] [data-finding-action="delete"]',
			) as unknown as HTMLButtonElement;
		expect(button("m1").textContent).toBe("Delete finding");
		expect(button("m1").hasAttribute("data-armed")).toBe(false);
		expect(button("m2").textContent).toBe("Really delete?");
		expect(button("m2").hasAttribute("data-armed")).toBe(true);
	});

	test("Delete asks once more", () => {
		const c = twoMarks();
		render(
			caseState(c, (s) => {
				s.markDeleteArmed = { markId: "m1", mark: "", at: 1 };
			}),
			noActions,
		);
		expect(action("m1", "delete").textContent).toBe("Really delete?");
		expect(action("m2", "delete").textContent).toBe("Delete mark");
	});

	test("Show sits in a mark's head, where the page can show the mark", () => {
		const c = twoMarks();
		const shown: [string, number][] = [];
		const actions = actionsWith({
			showMatch: (_caseId, a, candidate) => shown.push([a.id, candidate]),
		});
		const found: MarkMatch = {
			markId: "m1",
			number: 1,
			status: "found",
			score: 1,
			current: 0,
			candidates: [
				{ score: 1, summary: "p", selector: "p", visible: true, found: true },
			],
		};
		// A note or box: no element to find, but Show still scrolls to it.
		const noElement: MarkMatch = {
			markId: "m2",
			number: 2,
			status: "no-element",
			score: 0,
			current: 0,
			candidates: [],
		};
		const withImages = (loaded: boolean, matches = new Map([["m1", found]])) =>
			caseState(c, (s) => {
				s.images = {
					caseId: c.id,
					version: "v1",
					urls: new Map([
						["crops/m1.webp", "blob:m1"],
						["crops/m2.webp", "blob:m2"],
					]),
				};
				if (loaded)
					s.loaded = {
						caseId: c.id,
						tabId: 1,
						url: "https://www.example.com/kk",
						matches,
					};
			});
		// Not loaded on a tab: nothing to show.
		render(withImages(false), actions);
		expect(row("m1").querySelector("[data-action=show]")).toBeNull();
		render(withImages(true), actions);
		const show = (id: string) =>
			row(id).querySelector(
				".mark-head [data-action=show]",
			) as unknown as HTMLButtonElement | null;
		expect(show("m1")?.getAttribute("aria-label")).toBe(
			"Show mark 1 on the page",
		);
		show("m1")?.click();
		expect(shown).toEqual([["m1", 0]]);
		// A mark the page has no match for: no Show.
		expect(show("m2")).toBeNull();
		// A note or box has no element, and Show still scrolls to it.
		render(
			withImages(
				true,
				new Map([
					["m1", found],
					["m2", noElement],
				]),
			),
			actions,
		);
		show("m2")?.click();
		expect(shown).toEqual([
			["m1", 0],
			["m2", 0],
		]);
		// A picture's tile opens it larger in a tab of its own (DEC-061).
		const crop = row("m1").querySelector(
			"button.tile",
		) as unknown as HTMLButtonElement;
		expect(crop.getAttribute("data-action")).toBe("open-larger");
		expect(crop.getAttribute("aria-label")).toContain("shows it large");
	});

	test("a mark opens and closes at its head; Expand all opens every one", () => {
		const c = twoMarks();
		render(caseState(c), noActions);
		const isOpen = (id: string) => {
			const toggle = row(id).querySelector(".mark-toggle");
			const body = row(id).querySelector(".body") as unknown as HTMLElement;
			expect(toggle?.getAttribute("aria-expanded")).toBe(String(!body.hidden));
			return !body.hidden;
		};
		const all = () =>
			window.document.getElementById(
				"toggle-marks",
			) as unknown as HTMLButtonElement;
		expect([isOpen("m1"), isOpen("m2")]).toEqual([false, false]);
		expect(all().textContent).toBe("Expand all");
		(
			row("m1").querySelector(".mark-toggle") as unknown as HTMLButtonElement
		).click();
		expect([isOpen("m1"), isOpen("m2")]).toEqual([true, false]);
		all().click();
		expect([isOpen("m1"), isOpen("m2")]).toEqual([true, true]);
		expect(all().textContent).toBe("Collapse all");
		// Drawn again (the case changed): what was open stays open.
		render(caseState({ ...c, updatedAt: "2026-11-08T23:00:00Z" }), noActions);
		expect([isOpen("m1"), isOpen("m2")]).toEqual([true, true]);
		all().click();
		expect([isOpen("m1"), isOpen("m2")]).toEqual([false, false]);
		// A mark being edited is open.
		render(
			caseState(c, (s) => {
				s.markEdit = {
					markId: "m2",
					mark: "",
					mode: "comment",
					kind: "fixed",
					text: "",
				};
			}),
			noActions,
		);
		expect(isOpen("m2")).toBe(true);
		// Neither Collapse all nor its own head hides its form.
		all().click();
		all().click();
		expect([isOpen("m1"), isOpen("m2")]).toEqual([false, true]);
		(
			row("m2").querySelector(".mark-toggle") as unknown as HTMLButtonElement
		).click();
		expect(isOpen("m2")).toBe(true);
	});

	test("a dismissed mark says its state in a word, and the counts read apart", () => {
		const c = twoMarks();
		const found: MarkMatch = {
			markId: "m1",
			number: 1,
			status: "lost",
			score: 0,
			current: 0,
			candidates: [],
		};
		render(
			caseState(c, (s) => {
				s.loaded = {
					caseId: c.id,
					tabId: 1,
					url: "https://www.example.com/kk",
					matches: new Map([["m1", found]]),
				};
			}),
			noActions,
		);
		const state = (id: string) =>
			row(id).querySelector(".mark-sub .state")?.textContent;
		const pill = (id: string) =>
			row(id).querySelector(".mark-sub .pill")?.textContent;
		expect(state("m1")).toBe("Not found on this page");
		expect(pill("m1")).toBeUndefined();
		expect(pill("m2")).toBe("Won't fix");
		expect(window.document.getElementById("marks-heading")?.textContent).toBe(
			"Marks 2",
		);
		// The bar: one open, one dismissed, each its share; above the actions.
		const bar = [
			...window.document.querySelectorAll("#case-status .progress > span"),
		].map((s) => [s.getAttribute("data-kind"), s.getAttribute("style")]);
		expect(bar).toEqual([
			["open", "flex-grow: 1"],
			["dismissed", "flex-grow: 1"],
		]);
	});
});

describe("a mark's pictures: its screenshot first, then the images added (DEC-058)", () => {
	const DANA = { id: "u_dana", name: "Dana" };
	// Its own case each: rows of a case unchanged are kept.
	const marked = (id: string): Case => {
		const c = withOneMark(sampleCase(id));
		const a = c.marks[0] as Mark;
		c.marks = [
			{
				...a,
				images: [
					{
						id: "i_a",
						image: "images/i_a.webp",
						added: { at: "2026-11-22T10:00:00Z", user: DANA },
					},
					{
						id: "i_b",
						image: "images/i_b.webp",
						added: { at: "2026-11-22T11:00:00Z" },
					},
					{
						id: "i_c",
						image: "images/i_c.webp",
						added: { at: "2026-11-20T09:00:00Z", imported: true },
					},
				],
			},
		];
		return c;
	};
	const stateOf = (c: Case, urls: [string, string][]) =>
		caseState(c, (s) => {
			s.images = { caseId: c.id, version: c.updatedAt, urls: new Map(urls) };
		});

	test("one grid, the screenshot named first and never removed, the added ones counted from 1", () => {
		const c = marked("c_pictures1");
		const a = c.marks[0] as Mark;
		const asked: string[] = [];
		render(
			stateOf(c, [
				[a.crop, "blob:crop"],
				["images/i_a.webp", "blob:a"],
				["images/i_b.webp", "blob:b"],
				["images/i_c.webp", "blob:c"],
			]),
			actionsWith({
				addImages: () => asked.push("add"),
				deleteImage: (_c, _a, id) => asked.push(`remove ${id}`),
				openPicture: (_c, _a, id) => asked.push(`open ${id}`),
			}),
		);
		const row = window.document.querySelector(
			`[data-mark="${a.id}"] .pictures`,
		);
		const names = [
			...(row?.querySelectorAll("button.tile[data-action=open-larger]") ?? []),
		].map((b) => b.getAttribute("aria-label"));
		const larger = ": shows it large";
		expect(names).toEqual([
			`Screenshot of mark ${a.number}, taken by Sitegloss${larger}`,
			`Image 1 of 3 on mark ${a.number}, added by Dana${larger}`,
			`Image 2 of 3 on mark ${a.number}${larger}`,
			`Image 3 of 3 on mark ${a.number}, from an imported file${larger}`,
		]);
		const captions = [...(row?.querySelectorAll("figcaption") ?? [])].map(
			(f) => f.firstChild?.textContent,
		);
		expect(captions).toEqual(["Screenshot", "Image 1", "Image 2", "Image 3"]);
		// The screenshot's place has nothing to remove it with, not even a
		// disabled control: its one control opens it larger, in one step (DEC-061).
		const shot = row?.querySelector('[data-picture="screenshot"]');
		expect(
			[...(shot?.querySelectorAll("button, a, input, [tabindex]") ?? [])].map(
				(e) => e.getAttribute("data-action"),
			),
		).toEqual(["open-larger"]);
		(
			shot?.querySelector("button.tile") as unknown as
				| HTMLButtonElement
				| undefined
		)?.click();
		(
			row?.querySelector('[data-picture="i_b"] button.tile') as unknown as
				| HTMLButtonElement
				| undefined
		)?.click();
		expect(asked.splice(0)).toEqual(["open screenshot", "open i_b"]);
		expect(shot?.querySelector("button")?.getAttribute("title")).toBe(
			"Taken by Sitegloss when the mark was made. It stays with the mark. Click to see it large; Escape closes it.",
		);
		(
			row?.querySelector(
				`[aria-label="Remove image 2 from mark ${a.number}"]`,
			) as unknown as HTMLButtonElement | undefined
		)?.click();
		(
			row?.querySelector("[data-action=add-image]") as unknown as
				| HTMLButtonElement
				| undefined
		)?.click();
		expect(asked).toEqual(["remove i_b", "add"]);
		// The way to add one is the grid's last tile.
		expect(row?.lastElementChild?.getAttribute("data-action")).toBe(
			"add-image",
		);
		// The subline counts only what was added.
		expect(
			window.document.querySelector(`[data-mark="${a.id}"] .images-count`)
				?.textContent,
		).toBe("+3 images");
	});

	test("a screenshot not here is said in its place; a mark with six offers no more", () => {
		const c = marked("c_pictures2");
		const a = c.marks[0] as Mark;
		const six = Array.from({ length: 6 }, (_, i) => ({
			id: `i_${i}`,
			image: `images/i_${i}.webp`,
			added: { at: "2026-11-22T10:00:00Z" },
		}));
		c.marks = [{ ...a, images: six }];
		render(stateOf(c, []), noActions);
		const row = window.document.querySelector(
			`[data-mark="${a.id}"] .pictures`,
		);
		expect(row?.querySelector('[data-picture="screenshot"]')?.textContent).toBe(
			"The screenshot is missing.Screenshot",
		);
		expect(row?.querySelector("[data-action=add-image]")).toBeNull();
		expect(
			window.document.querySelector(`[data-mark="${a.id}"] .pictures-full`)
				?.textContent,
		).toBe("6 of 6 images");
	});

	test("a Delete or Remove pressed from the keyboard keeps the focus on its armed control, and on the next one when its image goes", () => {
		const c = marked("c_pictures5");
		const a = c.marks[0] as Mark;
		c.marks = [
			{
				...a,
				findings: [
					{
						id: "f_1",
						text: "Padding",
						app: { id: "x", name: "Claude", host: "claude.ai" },
						at: "2026-11-10T10:00:00Z",
					},
				],
			},
		];
		const urls = new Map([
			[a.crop, "blob:crop"],
			["images/i_a.webp", "blob:a"],
			["images/i_b.webp", "blob:b"],
			["images/i_c.webp", "blob:c"],
		]);
		const draw = (armed: (s: PanelState) => void, of: Case = c) =>
			render(
				caseState(of, (s) => {
					s.images = { caseId: of.id, version: of.updatedAt, urls };
					armed(s);
				}),
				noActions,
			);
		const at = (selector: string) =>
			window.document.querySelector(
				`[data-mark="${a.id}"] ${selector}`,
			) as unknown as HTMLElement;
		const focused = () =>
			window.document.activeElement as unknown as HTMLElement;
		draw(() => undefined);
		at(".mark-toggle").click();
		at('[data-picture="i_b"] [data-action=remove-image]').focus();
		draw((s) => {
			s.imageDeleteArmed = { markId: a.id, mark: "", imageId: "i_b", at: 1 };
		});
		expect(focused().getAttribute("aria-label")).toBe(
			`Really remove image 2 from mark ${a.number}?`,
		);
		// Removed: the next picture's Remove has the focus.
		const without = {
			...c,
			updatedAt: "2026-11-22T12:00:00Z",
			marks: c.marks.map((x) => ({
				...x,
				images: (x.images ?? []).filter((i) => i.id !== "i_b"),
			})),
		};
		draw(() => undefined, without);
		expect(
			focused().closest("[data-picture]")?.getAttribute("data-picture"),
		).toBe("i_c");
		at('[data-mark-action="delete"]').focus();
		draw((s) => {
			s.markDeleteArmed = { markId: a.id, mark: "", at: 1 };
		}, without);
		expect(focused().textContent).toBe("Really delete?");
		at('[data-finding="f_1"] [data-finding-action="delete"]').focus();
		draw((s) => {
			s.findingDeleteArmed = {
				markId: a.id,
				mark: "",
				findingId: "f_1",
				at: 1,
			};
		}, without);
		expect(focused().getAttribute("data-finding-action")).toBe("delete");
		expect(focused().hasAttribute("data-armed")).toBe(true);
	});

	test("a mark deleted from the keyboard leaves the focus on the next mark's head, else the one before", () => {
		const c = marked("c_pictures7");
		const a = c.marks[0] as Mark;
		const second = {
			...a,
			id: "m2",
			number: 2,
			crop: "crops/m2.webp",
			images: [],
		};
		const both = { ...c, marks: [a, second] };
		render(caseState(both), noActions);
		const toggle = (id: string) =>
			window.document.querySelector(
				`[data-mark="${id}"] .mark-toggle`,
			) as unknown as HTMLElement;
		const del = (id: string) =>
			window.document.querySelector(
				`[data-mark="${id}"] [data-mark-action="delete"]`,
			) as unknown as HTMLElement;
		toggle(a.id).click();
		del(a.id).focus();
		render(
			caseState({
				...both,
				marks: [second],
				updatedAt: "2026-11-22T13:00:00Z",
			}),
			noActions,
		);
		expect(window.document.activeElement).toBe(toggle("m2") as never);
		// The last one: the mark before it.
		const back = { ...both, updatedAt: "2026-11-22T14:00:00Z" };
		render(caseState(back), noActions);
		toggle("m2").click();
		del("m2").focus();
		render(
			caseState({ ...back, marks: [a], updatedAt: "2026-11-22T15:00:00Z" }),
			noActions,
		);
		expect(window.document.activeElement).toBe(toggle(a.id) as never);
	});

	test("an image the team does not have says so on its tile, in words", () => {
		const c = marked("c_pictures6");
		const a = c.marks[0] as Mark;
		render(
			caseState(c, (s) => {
				s.images = {
					caseId: c.id,
					version: c.updatedAt,
					urls: new Map([["images/i_b.webp", "blob:b"]]),
				};
				s.cloud.status = {
					state: "problem",
					problems: [],
					undecided: 0,
					notSent: { [c.id]: { i_b: "The team's storage is full" } },
				};
			}),
			noActions,
		);
		const note = (id: string) =>
			window.document.querySelector(
				`[data-mark="${a.id}"] [data-picture="${id}"] .tile-note`,
			)?.textContent;
		expect(note("i_b")).toBe("Not sent: The team's storage is full. Try again");
		expect(note("i_a")).toBeUndefined();
	});

	test("an image held back past six is a tile of its own: not sent, why, and its Remove", () => {
		const c = marked("c_pictures8");
		const a = c.marks[0] as Mark;
		const image = (id: string) => ({
			id,
			image: `images/${id}.webp`,
			added: { at: "2026-11-22T10:00:00Z" },
		});
		c.marks = [
			{
				...a,
				images: ["t1", "t2", "t3", "t4", "t5", "t6"].map(image),
				heldImages: [image("i_mine")],
			},
		];
		render(caseState(c), noActions);
		const tile = window.document.querySelector(
			`[data-mark="${a.id}"] [data-picture="i_mine"]`,
		);
		expect(tile?.querySelector("figcaption")?.textContent).toBe("Image 7");
		expect(tile?.querySelector(".tile-note")?.textContent).toBe(
			"Not sent: the mark already holds six images. It goes when a place is free.",
		);
		expect(
			tile
				?.querySelector("[data-action=remove-image]")
				?.getAttribute("aria-label"),
		).toBe(`Remove image 7 from mark ${a.number}`);
		expect(
			window.document.querySelector(
				`[data-mark="${a.id}"] [data-action=add-image]`,
			),
		).toBeNull();
		expect(
			window.document.querySelector(`[data-mark="${a.id}"] .pictures-full`)
				?.textContent,
		).toBe("6 of 6 images; 1 more waits for a place");
	});

	test("with the page filter on, a mark of that page keeps its pictures", () => {
		const c = marked("c_pictures4");
		const a = c.marks[0] as Mark;
		render(
			caseState(c, (s) => {
				s.images = {
					caseId: c.id,
					version: c.updatedAt,
					urls: new Map([[a.crop, "blob:crop"]]),
				};
				s.markPage = {
					caseId: c.id,
					choice: { page: new URL(c.page.url).pathname },
					upTo: 3,
				};
			}),
			noActions,
		);
		const row = window.document.querySelector(`[data-mark="${a.id}"]`);
		expect(row).not.toBeNull();
		expect(row?.querySelectorAll(".pictures figure").length).toBe(4);
		expect(row?.querySelector(".images-count")?.textContent).toBe("+3 images");
	});

	test("a Remove clicked once says so on its tile, in words", () => {
		const c = marked("c_pictures3");
		const a = c.marks[0] as Mark;
		render(
			caseState(c, (s) => {
				s.images = {
					caseId: c.id,
					version: c.updatedAt,
					urls: new Map([["images/i_b.webp", "blob:b"]]),
				};
				s.imageDeleteArmed = {
					markId: a.id,
					mark: "",
					imageId: "i_b",
					at: 0,
				};
			}),
			noActions,
		);
		const remove = (id: string) =>
			window.document.querySelector(
				`[data-mark="${a.id}"] [data-picture="${id}"] [data-action=remove-image]`,
			);
		expect(remove("i_b")?.textContent).toBe("Really remove?");
		expect(remove("i_b")?.getAttribute("aria-label")).toBe(
			`Really remove image 2 from mark ${a.number}?`,
		);
		expect(remove("i_a")?.getAttribute("data-armed")).toBeNull();
	});
});

describe("Verify closes its mark (DEC-061)", () => {
	test("Verify closes the row; the focus goes to the next mark to verify, else the row's head", async () => {
		const fixed = { kind: "fixed" as const, at: "2026-11-14T09:00:00Z" };
		const m = (k: number, resolution?: Mark["resolution"]): Mark => ({
			id: `m${k}`,
			number: k,
			shot: "s1",
			comment: `Comment ${k}`,
			author: "user",
			shape: { kind: "note", at: { x: 1, y: 1 } },
			crop: `crops/m${k}.webp`,
			element: null,
			...(resolution ? { resolution } : {}),
		});
		const c: Case = {
			...sampleCase("c_verify_close"),
			marks: [m(1, fixed), m(2), m(3, fixed)],
		};
		const verified: string[] = [];
		const actions = actionsWith({
			verifyMark: (_c, a) => void verified.push(a.id),
		});
		render(caseState(c), actions);
		const row = (id: string) =>
			window.document.querySelector(
				`[data-mark="${id}"]`,
			) as unknown as HTMLElement;
		(
			row("m1").querySelector(".mark-toggle") as unknown as HTMLButtonElement
		).click();
		expect(row("m1").hasAttribute("data-open")).toBe(true);
		(
			row("m1").querySelector(
				'[data-mark-action="verify"]',
			) as unknown as HTMLButtonElement
		).click();
		expect(verified).toEqual(["m1"]);
		// Stored as verified: drawn closed, the focus on mark 3, the next to verify.
		const done: Case = {
			...c,
			updatedAt: "2026-11-15T09:00:00Z",
			marks: [
				m(1, { ...fixed, verified: { at: "2026-11-15T09:00:00Z" } }),
				m(2),
				m(3, fixed),
			],
		};
		render(caseState(done), actions);
		expect(row("m1").hasAttribute("data-open")).toBe(false);
		expect(
			window.document.activeElement ===
				(row("m3").querySelector(".mark-toggle") as unknown),
		).toBe(true);
	});

	test("a Verify not saved takes no focus later from a field the person moved to (DEC-064's review)", () => {
		const fixed = { kind: "fixed" as const, at: "2026-11-14T09:00:00Z" };
		const base = withOneMark(sampleCase("c_verify_failed"));
		const c: Case = {
			...base,
			marks: base.marks.map((a) => ({ ...a, resolution: fixed })),
		};
		render(caseState(c), noActions);
		const row = window.document.querySelector(
			'[data-mark="m1"]',
		) as unknown as HTMLElement;
		(row.querySelector(".head-verify") as unknown as HTMLButtonElement).click();
		// Not saved: the person types the summary meanwhile.
		el<HTMLTextAreaElement>("verdict").focus();
		const later: Case = {
			...c,
			updatedAt: "2026-11-15T09:00:00Z",
			marks: c.marks.map((a) => ({
				...a,
				resolution: { ...fixed, verified: { at: "2026-11-15T09:00:00Z" } },
			})),
		};
		render(caseState(later), noActions);
		expect(window.document.activeElement?.id).toBe("verdict");
	});

	test("where the focus goes after a Verify", () => {
		const order = [
			{ id: "m1", status: "fixed" },
			{ id: "m2", status: "open" },
			{ id: "m3", status: "fixed" },
		];
		expect(afterVerify(order, "m1")).toEqual({ markId: "m3" });
		expect(afterVerify(order, "m3")).toEqual({ markId: "m1" });
		expect(afterVerify([{ id: "m1", status: "verified" }], "m1")).toEqual({
			markId: "m1",
		});
		expect(afterVerify(order, "gone")).toBeUndefined();
	});
});

describe("Verify (DEC-023)", () => {
	const CLAUDE = {
		id: "https://claude.ai/oauth",
		name: "Claude",
		host: "claude.ai",
	};
	const mark = (n: number, more: Partial<Mark> = {}): Mark => ({
		id: `m${n}`,
		number: n,
		shot: "s1",
		comment: `Comment ${n}`,
		author: "user",
		shape: { kind: "note", at: { x: 1, y: 1 } },
		crop: `crops/m${n}.webp`,
		element: null,
		...more,
	});
	let n = 0;
	/** Open, to verify, verified, won't fix; mark 1 reopened once. */
	const fourMarks = (): Case => ({
		...sampleCase(`c_verify${++n}`),
		marks: [
			mark(1, {
				reopens: [
					{
						note: "Still pale on hover\nand on focus",
						at: "2026-11-13T16:00:00Z",
						was: {
							kind: "fixed",
							note: "Darker text, 7:1 now",
							at: "2026-11-13T11:00:00Z",
						},
					},
				],
			}),
			mark(2, {
				resolution: {
					kind: "fixed",
					note: "Hover state too",
					at: "2026-11-14T09:00:00Z",
					app: CLAUDE,
				},
			}),
			mark(3, {
				resolution: {
					kind: "fixed",
					at: "2026-11-14T09:00:00Z",
					verified: { at: "2026-11-14T15:00:00Z" },
				},
			}),
			mark(4, { resolution: { kind: "wontfix", at: "2026-11-14T09:00:00Z" } }),
		],
	});
	const row = (id: string) =>
		window.document.querySelector(
			`[data-mark="${id}"]`,
		) as unknown as HTMLElement;
	const actionsOf = (id: string) =>
		[...row(id).querySelectorAll(".mark-actions [data-mark-action]")].map(
			(b) => b.textContent,
		);
	const rows = () =>
		[...window.document.querySelectorAll("li.mark")].map((li) =>
			li.getAttribute("data-mark"),
		);

	test("the status block: a bar and the chips in order, counts above zero", () => {
		render(caseState(fourMarks()), noActions);
		const bar = [
			...window.document.querySelectorAll("#case-status .progress > span"),
		].map((s) => s.getAttribute("data-kind"));
		expect(bar).toEqual(["open", "toVerify", "verified", "dismissed"]);
		expect(
			[...window.document.querySelectorAll("#case-status .chip")].map((b) =>
				(b.textContent ?? "").trim(),
			),
		).toEqual(["● Open 1", "◐ To verify 1", "✓ Verified 1", "– Dismissed 1"]);
		expect(window.document.querySelector(".all-done")).toBeNull();
	});

	test("the status block and Show marks sit in the marks' section, under its heading", () => {
		const c = fourMarks();
		render(caseState(c), noActions);
		const marks = window.document.querySelector("section.marks");
		const bar = marks?.querySelector(".marks-bar");
		// The chips filter this list: straight under its bar, above the marks.
		const holder = el("case-status").parentElement;
		expect(holder?.parentElement).toBe(marks as never);
		expect(holder?.previousElementSibling).toBe(bar as never);
		expect(
			window.document.querySelector(".case-header #case-status"),
		).toBeNull();
		// Show marks is in the case's tool bar at the panel's bottom (DEC-063).
		expect(el("case-dock").contains(el("load-case") as never)).toBe(true);
		expect(bar?.contains(el("load-case") as never)).toBe(false);
		// A redraw of the list keeps both, and the focus on the button pressed.
		el("load-case").focus();
		render(
			caseState({ ...c, updatedAt: "2026-11-14T10:00:00.000Z" }),
			noActions,
		);
		expect(window.document.querySelectorAll("#load-case").length).toBe(1);
		expect(window.document.querySelectorAll("#case-status").length).toBe(1);
		expect(el("case-dock").contains(el("load-case") as never)).toBe(true);
		expect(window.document.activeElement?.id).toBe("load-case");
		// A chip drawn anew after its click has the focus still.
		(
			window.document.querySelector(
				'#case-status .chip[data-group="open"]',
			) as unknown as HTMLElement
		).focus();
		render(
			caseState(c, (s) => {
				s.markFilter = { caseId: c.id, group: "open", upTo: 4 };
			}),
			noActions,
		);
		const at = window.document.activeElement;
		expect(at?.getAttribute("data-group")).toBe("open");
		expect(at?.getAttribute("aria-pressed")).toBe("true");
		// A case without marks: no block, no gap for one.
		render(caseState({ ...c, id: "c_none", marks: [] }), noActions);
		expect(window.document.querySelector("#case-status")).toBeNull();
		expect(
			(
				window.document.querySelector(
					"section.marks .case-status",
				) as unknown as HTMLElement | null
			)?.hidden,
		).toBe(true);
	});

	test("a mark picked on the page opens its row, once per click (DEC-027)", () => {
		const c = fourMarks();
		const open = (id: string) =>
			window.document
				.querySelector(`[data-mark="${id}"]`)
				?.hasAttribute("data-open");
		render(caseState(c), noActions);
		expect(open("m3")).toBe(false);
		const picked = (at: number) =>
			caseState(c, (s) => {
				s.picked = { caseId: c.id, markId: "m3", at };
			});
		render(picked(1), noActions);
		expect(open("m3")).toBe(true);
		expect(
			window.document
				.querySelector('[data-mark="m3"]')
				?.hasAttribute("data-picked"),
		).toBe(true);
		// Closed by hand: the same click does not open it again.
		(
			window.document.querySelector(
				'[data-mark="m3"] .mark-toggle',
			) as unknown as HTMLElement
		).click();
		expect(open("m3")).toBe(false);
		render(picked(1), noActions);
		expect(open("m3")).toBe(false);
		// Another click does; another case's does not.
		render(picked(2), noActions);
		expect(open("m3")).toBe(true);
		render(
			caseState(c, (s) => {
				s.picked = { caseId: "c_other", markId: "m1", at: 3 };
			}),
			noActions,
		);
		expect(open("m1")).toBe(false);
	});

	test("a chip filters the list, a second click or Show all shows all", () => {
		const c = fourMarks();
		const filters: unknown[] = [];
		const actions = actionsWith({
			filterMarks: (id, group) => void filters.push([id, group]),
		});
		render(caseState(c), actions);
		(
			window.document.querySelector(
				'#case-status .chip[data-group="toVerify"]',
			) as unknown as HTMLElement
		).click();
		const filtered = caseState(c, (s) => {
			s.markFilter = { caseId: c.id, group: "toVerify", upTo: 4 };
		});
		render(filtered, actions);
		expect(rows()).toEqual(["m2"]);
		expect(
			window.document
				.querySelector('.chip[data-group="toVerify"]')
				?.getAttribute("aria-pressed"),
		).toBe("true");
		expect(el("marks-filtered").textContent).toBe(
			"Showing 1 of 4 marks. Show all",
		);
		(
			window.document.querySelector(
				'.chip[data-group="toVerify"]',
			) as unknown as HTMLElement
		).click();
		(
			window.document.querySelector(
				'[data-action="show-all"]',
			) as unknown as HTMLElement
		).click();
		expect(filters).toEqual([
			[c.id, "toVerify"],
			[c.id, undefined],
			[c.id, undefined],
		]);
		// Another case's filter is not this one's.
		render(
			caseState(c, (s) => {
				s.markFilter = { caseId: "c_other", group: "toVerify", upTo: 4 };
			}),
			actions,
		);
		expect(rows()).toEqual(["m1", "m2", "m3", "m4"]);
		expect(el("marks-filtered")).toBeNull();
	});

	test("the filter ends when its marks are gone, or a mark is added", () => {
		const c = fourMarks();
		const filtered = (k: Case) =>
			caseState(k, (s) => {
				s.markFilter = { caseId: c.id, group: "toVerify", upTo: 4 };
			});
		// The last mark to verify verified: all marks again, no empty list.
		const none: Case = {
			...c,
			updatedAt: "2026-11-15T10:00:00Z",
			marks: c.marks.filter((a) => a.id !== "m2"),
		};
		render(filtered(none), noActions);
		expect(rows()).toEqual(["m1", "m3", "m4"]);
		expect(el("marks-filtered")).toBeNull();
		// A mark drawn while filtered shows, whatever its status.
		const added: Case = {
			...c,
			updatedAt: "2026-11-15T11:00:00Z",
			marks: [...c.marks, mark(5)],
		};
		render(filtered(added), noActions);
		expect(rows()).toEqual(["m1", "m2", "m3", "m4", "m5"]);
		expect(
			window.document
				.querySelector('.chip[data-group="toVerify"]')
				?.getAttribute("aria-pressed"),
		).toBe("false");
	});

	test("nothing open or to verify: a line says so", () => {
		const c = fourMarks();
		c.marks = c.marks.slice(2);
		render(caseState(c), noActions);
		expect(
			window.document.querySelector("#case-status .all-done")?.textContent,
		).toBe("✓ All marks are verified or dismissed.");
	});

	test("each status: its pill, its strong button and the others", () => {
		render(caseState(fourMarks()), noActions);
		const pill = (id: string) =>
			row(id).querySelector(".mark-sub .pill")?.textContent;
		expect([pill("m1"), pill("m2"), pill("m3"), pill("m4")]).toEqual([
			undefined,
			"To verify",
			"Verified",
			"Won't fix",
		]);
		expect(actionsOf("m1")).toEqual([
			"Resolve…",
			"Edit comment",
			"Delete mark",
		]);
		expect(actionsOf("m2")).toEqual([
			"Verify",
			"Reopen…",
			"Change…",
			"Edit comment",
			"Delete mark",
		]);
		for (const id of ["m3", "m4"])
			expect(actionsOf(id)).toEqual([
				"Reopen…",
				"Change…",
				"Edit comment",
				"Delete mark",
			]);
		const strong = (id: string) =>
			[...row(id).querySelectorAll(".mark-actions .strong")].map(
				(b) => b.textContent,
			);
		expect([strong("m1"), strong("m2"), strong("m3")]).toEqual([
			["Resolve…"],
			["Verify"],
			[],
		]);
		// To verify: Verify alone, small, in the title line, so the closed row
		// is two lines like the others (DEC-064); Reopen… when it is open.
		expect(
			[...row("m2").querySelectorAll(".mark-head > button.head-verify")].map(
				(b) => b.textContent,
			),
		).toEqual(["Verify"]);
		expect(row("m2").querySelector(".mark-sub button")).toBeNull();
		expect(row("m3").querySelector(".head-verify")).toBeNull();
		expect(row("m2").querySelector(".head-verify")?.getAttribute("title")).toBe(
			"The fix holds on the page you checked",
		);
		expect(
			row("m2").querySelector(".head-verify")?.getAttribute("aria-label"),
		).toBe("Verify mark 2");
		// A mark to verify is drawn in full; verified and dismissed step back.
		expect(row("m2").hasAttribute("data-resolved")).toBe(false);
		expect(row("m2").dataset["status"]).toBe("fixed");
		expect(row("m3").dataset["resolved"]).toBe("fixed");
	});

	test("Verify in the head, and Verify and Reopen… in the body, call their actions", () => {
		const c = fourMarks();
		const calls: unknown[] = [];
		render(
			caseState(c),
			actionsWith({
				verifyMark: (_c, a) => void calls.push(["verify", a.id]),
				editMark: (_c, a, mode) => void calls.push(["edit", a.id, mode]),
			}),
		);
		(row("m2").querySelector(".head-verify") as unknown as HTMLElement).click();
		for (const name of ["verify", "reopen"])
			(
				row("m2").querySelector(
					`.body [data-mark-action="${name}"]`,
				) as unknown as HTMLElement
			).click();
		expect(calls).toEqual([
			["verify", "m2"],
			["verify", "m2"],
			["edit", "m2", "reopen"],
		]);
	});

	test("a reopened mark: its note's first line in the head, the history in order", () => {
		const c = fourMarks();
		const verified: Case = {
			...c,
			updatedAt: "2026-11-14T15:00:00Z",
			marks: [
				{
					...(c.marks[0] as Mark),
					resolution: {
						kind: "fixed",
						note: "Hover state too",
						at: "2026-11-14T09:00:00Z",
						app: CLAUDE,
						verified: { at: "2026-11-14T15:00:00Z", app: CLAUDE },
					},
				},
			],
		};
		render(caseState(c), noActions);
		expect(row("m1").querySelector(".mark-sub .reopened")?.textContent).toBe(
			"Reopened: Still pale on hover",
		);
		render(caseState(verified), noActions);
		const lines = [...row("m1").querySelectorAll(".history li")].map((li) => [
			li.getAttribute("data-kind"),
			li.textContent,
		]);
		expect(lines.map(([kind]) => kind)).toEqual([
			"fixed",
			"reopened",
			"fixed",
			"verified",
		]);
		expect(lines[0]?.[1]).toMatch(/^Fixed .+ · Darker text, 7:1 now$/);
		expect(lines[1]?.[1]).toMatch(/^Reopened .+ · Still pale on hover/);
		expect(lines[2]?.[1]).toMatch(
			/^Fixed .+ by Claude \(claude\.ai\) · Hover state too$/,
		);
		expect(lines[3]?.[1]).toMatch(/^Verified .+ by Claude \(claude\.ai\)$/);
		// Not reopened any more: no reopen line in the head.
		expect(row("m1").querySelector(".mark-sub .reopened")).toBeNull();
	});

	test("a status from a file says so in the history", () => {
		const c = fourMarks();
		const fromFile: Case = {
			...c,
			updatedAt: "2026-11-15T10:00:00Z",
			importedAt: "2026-11-15T10:00:00Z",
			marks: [
				{
					...(c.marks[1] as Mark),
					resolution: {
						kind: "fixed",
						at: "2026-11-14T09:00:00Z",
						app: CLAUDE,
						imported: true,
						verified: { at: "2026-11-14T15:00:00Z", imported: true },
					},
				},
			],
		};
		render(caseState(fromFile), noActions);
		const lines = [...row("m2").querySelectorAll(".history li")].map(
			(li) => li.textContent,
		);
		expect(lines[0]).toMatch(
			/^Fixed .+ by Claude \(claude\.ai\), as the file says$/,
		);
		expect(lines[1]).toMatch(/^Verified .+, as the file says$/);
	});

	test("the crop of a verified or dismissed mark is not greyed", async () => {
		const css = await Bun.file(
			new URL("../src/sidepanel/style.css", import.meta.url),
		).text();
		expect(css).not.toMatch(/\[data-resolved\][^{]*img/);
	});

	test("Resolve…: four choices, the note, and the choice to resolveMark", () => {
		const c = fourMarks();
		const calls: unknown[] = [];
		const actions = actionsWith({
			resolveMark: (_c, a, kind, note) => void calls.push([a.id, kind, note]),
		});
		render(
			caseState(c, (s) => {
				s.markEdit = {
					markId: "m1",
					mark: "",
					mode: "resolve",
					kind: "fixed",
					text: "",
				};
			}),
			actions,
		);
		const form = row("m1").querySelector(
			"[data-form=resolve]",
		) as unknown as HTMLElement;
		expect(form.querySelector("legend")?.textContent).toBe("Mark 1 is");
		expect(
			[...form.querySelectorAll("label.choice")].map((l) => l.textContent),
		).toEqual([
			"Fixed, to verify",
			"Fixed and verified",
			"Won't fix",
			"Can't reproduce",
		]);
		// A label that shows, no placeholder in its place (DEC-060).
		const note = form.querySelector(
			"input.note",
		) as unknown as HTMLInputElement;
		expect(note.placeholder).toBe("");
		expect(form.querySelector(`label[for="${note.id}"]`)?.textContent).toBe(
			"Note (optional): what was done, or why",
		);
		(
			form.querySelector(
				'input[value="verified"]',
			) as unknown as HTMLInputElement
		).checked = true;
		const done = form.querySelector(
			'[data-mark-action="resolve-done"]',
		) as unknown as HTMLElement;
		expect(done.textContent).toBe("Save");
		done.click();
		expect(calls).toEqual([["m1", "verified", ""]]);
	});

	test("Reopen…: the note is required, then goes to reopenMark", () => {
		const c = fourMarks();
		const calls: unknown[] = [];
		const actions = actionsWith({
			reopenMark: (_c, a, note) => void calls.push([a.id, note]),
		});
		render(
			caseState(c, (s) => {
				s.markEdit = {
					markId: "m2",
					mark: "",
					mode: "reopen",
					kind: "fixed",
					text: "",
				};
			}),
			actions,
		);
		const form = row("m2").querySelector(
			"[data-form=reopen]",
		) as unknown as HTMLElement;
		expect(form.querySelector("legend")?.textContent).toBe("Reopen mark 2");
		const field = form.querySelector(
			"textarea",
		) as unknown as HTMLTextAreaElement;
		expect(field.placeholder).toBe("");
		expect(
			window.document.getElementById(
				field.getAttribute("aria-describedby") ?? "",
			)?.textContent,
		).toBe("What is still wrong? The developer reads this first.");
		const done = form.querySelector(
			'[data-mark-action="reopen-done"]',
		) as unknown as HTMLButtonElement;
		expect(done.textContent).toBe("Reopen");
		expect(done.disabled).toBe(true);
		field.value = "   ";
		field.dispatchEvent(new window.Event("input") as unknown as Event);
		expect(done.disabled).toBe(true);
		field.value = "Still pale";
		field.dispatchEvent(new window.Event("input") as unknown as Event);
		expect(done.disabled).toBe(false);
		done.click();
		expect(calls).toEqual([["m2", "Still pale"]]);
		// The head's buttons wait while a form is open.
		expect(row("m2").querySelector(".mark-sub button")).toBeNull();
	});

	test("the case list counts by status, with the bar", () => {
		const c = fourMarks();
		const home = initialState();
		home.cases = [c];
		render(home, noActions);
		const item = window.document.querySelector(
			`[data-case="${c.id}"]`,
		) as unknown as HTMLElement;
		// One sentence for a screen reader; the bar and the words for the eye.
		expect(item.getAttribute("aria-label")).toContain(
			"4 marks, 1 open, 1 to verify, 1 verified, 1 dismissed",
		);
		expect(
			[...item.querySelectorAll(".card-chips > span")].map(
				(s) => s.textContent,
			),
		).toEqual(["● 1 open", "◐ 1 to verify", "✓ 1 verified", "– 1 dismissed"]);
		expect(
			[...item.querySelectorAll(".progress.band > span")].map((s) =>
				s.getAttribute("data-kind"),
			),
		).toEqual(["open", "toVerify", "verified", "dismissed"]);
	});

	test("the import prompt says what differs: the counts of both copies", () => {
		const here = {
			...sampleCase("c_back"),
			marks: [mark(1), mark(2), mark(3)],
		};
		const file: Case = {
			...here,
			updatedAt: "2026-11-14T10:00:00Z",
			marks: [
				mark(1),
				mark(2, { resolution: { kind: "fixed", at: "2026-11-14T09:00:00Z" } }),
				mark(3, { resolution: { kind: "fixed", at: "2026-11-14T09:00:00Z" } }),
			],
		};
		const state = initialState();
		state.importing = {
			parsed: { case: file, images: async () => new Map() },
			existing: here,
		};
		render(state, noActions);
		expect(
			window.document.querySelector('[data-role="import-counts"]')?.textContent,
		).toBe("Here: 3 open. In the file: 1 open, 2 to verify.");
		state.importing = undefined;
		render(state, noActions);
	});
});

describe("Load and Hide", () => {
	test("a case loaded on the tab in front offers to hide its marks", () => {
		const c = sampleCase("c_loaded");
		const called: string[] = [];
		const actions = actionsWith({
			loadOntoTab: () => called.push("load"),
			hideFromTab: () => called.push("hide"),
		});
		render(caseState(c), actions);
		expect(el("load-case").textContent).toBe("Show marks");
		// A button with an edge, so it is seen, but not the case's primary:
		// that is Add marks (DEC-023).
		expect(el("load-case").classList.contains("primary")).toBe(false);
		expect(el("load-case").classList.contains("quiet")).toBe(false);
		expect(el("load-case").classList.contains("link")).toBe(false);
		el("load-case").click();
		const loadedOn = (front: number) =>
			caseState(c, (s) => {
				s.tab = {
					id: front,
					url: "http://localhost:3000/kk",
					title: "",
					size: undefined,
				};
				s.loaded = {
					caseId: c.id,
					tabId: 1,
					matches: new Map(),
					url: "https://www.example.com/kk",
				};
			});
		render(loadedOn(1), actions);
		expect(el("load-case").textContent).toBe("Hide marks");
		el("load-case").click();
		// Its marks are on another tab: this one can show them.
		render(loadedOn(2), actions);
		expect(el("load-case").textContent).toBe("Show marks");
		// Loaded by an AI app: the page says so.
		render(
			caseState(c, (s) => {
				s.overlay = {
					visible: false,
					url: "",
					title: "",
					drafts: 0,
					saving: false,
					loadedCase: c.id,
				};
			}),
			actions,
		);
		expect(el("load-case").textContent).toBe("Hide marks");
		expect(called).toEqual(["load", "hide"]);
	});
});

describe("a case on a tab Sitegloss may not run on", () => {
	const noAccess = (c: Case, allSites = false) =>
		caseState(c, (s) => {
			s.tab = { id: 1, url: "", title: "", size: undefined };
			s.allSites = allSites;
		});
	const withMark = (): Case => ({
		...sampleCase("c_reach"),
		marks: [
			{
				id: "m1",
				number: 1,
				shot: "s1",
				comment: "Here",
				author: "user",
				shape: { kind: "note", at: { x: 1, y: 1 } },
				crop: "crops/m1.webp",
				element: null,
			},
		],
	});

	test("the notice with Allow on all sites; only what needs the page is off", () => {
		const c = withMark();
		const asked: string[] = [];
		const state = noAccess(c);
		state.loaded = {
			caseId: c.id,
			tabId: 1,
			url: "https://www.example.com/kk",
			matches: new Map([
				[
					"m1",
					{
						markId: "m1",
						number: 1,
						status: "no-element",
						score: 0,
						current: 0,
						candidates: [],
					},
				],
			]),
		};
		render(state, actionsWith({ allowAllSites: () => void asked.push("all") }));
		const notice = el("case-access");
		expect(notice.hidden).toBe(false);
		expect(notice.textContent).toContain("Click the Sitegloss icon");
		expect(notice.querySelector("svg.notice-icon")).not.toBeNull();
		// In the This tab block, which says nothing else.
		expect(notice.parentElement).toBe(el("this-tab"));
		expect(el("tab-line").hidden).toBe(true);
		(
			notice.querySelector(
				'[data-action="allow-all-sites"]',
			) as unknown as HTMLButtonElement
		).click();
		expect(asked).toEqual(["all"]);
		// Show marks goes; Add marks is off and says why.
		expect(el("load-case").hidden).toBe(true);
		expect(el<HTMLButtonElement>("add-marks").disabled).toBe(true);
		expect(el("add-marks").title).toContain("see the notice");
		const show = window.document.querySelector(
			'[data-action="show"]',
		) as unknown as HTMLButtonElement;
		expect(show.disabled).toBe(true);
		expect(show.title).toContain("see the notice");
		// The rest works without the tab.
		for (const id of ["export-case", "delete-case", "save-verdict"])
			expect(el<HTMLButtonElement>(id).disabled).toBe(false);
	});

	test("with all sites allowed: the tab is Chrome's own, no button", () => {
		render(noAccess(sampleCase("c_never"), true), noActions);
		expect(el("case-access").textContent).toContain("cannot run on this tab");
		expect(
			(
				el("case-access").querySelector(
					'[data-action="allow-all-sites"]',
				) as unknown as HTMLElement
			).hidden,
		).toBe(true);
	});

	test("with all sites allowed but no file access: it may be a file, the details open the toggle", () => {
		const opened: string[] = [];
		const asked: string[] = [];
		const state = noAccess(sampleCase("c_file"), true);
		state.fileAccess = false;
		render(
			state,
			actionsWith({
				openDetails: () => void opened.push("details"),
				allowAllSites: () => void asked.push("all"),
			}),
		);
		const notice = el("case-access");
		expect(notice.textContent).toContain("Allow access to file URLs");
		expect(notice.textContent).toContain("Chrome Web Store");
		const button = notice.querySelector(
			"button",
		) as unknown as HTMLButtonElement;
		expect(button.hidden).toBe(false);
		expect(button.textContent).toBe("Open Sitegloss's details");
		button.click();
		expect(opened).toEqual(["details"]);
		expect(asked).toEqual([]);
		// With file access, the tab is Chrome's own: no button.
		state.fileAccess = true;
		render(state, noActions);
		expect(notice.textContent).not.toContain("file URLs");
		expect(button.hidden).toBe(true);
	});

	test("with access: no notice, the buttons on", () => {
		render(
			caseState(withMark(), (s) => {
				s.tab = {
					id: 1,
					url: "http://localhost:3000/kk",
					title: "",
					size: undefined,
				};
			}),
			noActions,
		);
		expect(el("case-access").hidden).toBe(true);
		expect(el<HTMLButtonElement>("load-case").disabled).toBe(false);
		expect(el<HTMLButtonElement>("add-marks").disabled).toBe(false);
	});
});

describe("none of the case's marks found (DEC-022)", () => {
	const match = (n: number, status: MarkMatch["status"]): MarkMatch => ({
		markId: `m${n}`,
		number: n,
		status,
		score: status === "lost" ? 0 : 0.9,
		current: 0,
		candidates:
			status === "lost"
				? []
				: [
						{
							score: 0.9,
							summary: "button",
							selector: "button",
							visible: true,
							found: status === "found",
						},
					],
	});
	const on = (
		url: string,
		matches: MarkMatch[],
		settling = false,
	): PanelState => {
		const c = sampleCase("c_none");
		return caseState(c, (s) => {
			s.tab = { id: 1, url, title: "", size: undefined };
			s.loaded = {
				caseId: c.id,
				tabId: 1,
				url: "https://www.example.com/kk",
				matches: new Map(matches.map((m) => [m.markId, m])),
				settling,
			};
		});
	};

	test("on another page: one quiet line, no warning and no button (DEC-063)", () => {
		render(
			on("http://localhost:3000/other", [match(1, "lost"), match(2, "lost")]),
			noActions,
		);
		const line = el("none-found");
		expect(line.hidden).toBe(false);
		expect(line.querySelector("svg") === null).toBe(true);
		expect(line.querySelector("button") === null).toBe(true);
		// The facts' address above opens the one page.
		expect(line.textContent).toBe("This case's page is not in this tab.");
	});

	test("on the case's own path (another environment), none found: says that, quietly", () => {
		render(on("http://localhost:3000/kk", [match(1, "lost")]), noActions);
		expect(el("none-found").hidden).toBe(false);
		expect(el("none-found").textContent).toBe(
			"None of this page's marks were found here.",
		);
	});

	test("on its page, some found, still being looked for, or nothing to tell by: no line", () => {
		const url = "http://localhost:3000/kk";
		render(on(url, [match(1, "lost"), match(2, "probable")]), noActions);
		expect(el("none-found").hidden).toBe(true);
		render(on(url, [match(1, "lost")], true), noActions);
		expect(el("none-found").hidden).toBe(true);
		render(on(url, [match(1, "no-element")]), noActions);
		expect(el("none-found").hidden).toBe(true);
	});
});

describe("what the panel's draw found, under the case's buttons", () => {
	const found = (n: number): MarkMatch => ({
		markId: `m${n}`,
		number: n,
		status: "found",
		score: 1,
		current: 0,
		candidates: [
			{
				score: 1,
				summary: "button",
				selector: "button",
				visible: true,
				found: true,
			},
		],
	});
	const drawnWith = (n: number) => {
		const c = sampleCase("c_adding");
		return caseState(c, (s) => {
			s.tab = { id: 1, url: c.page.url, title: "", size: undefined };
			s.loaded = {
				caseId: c.id,
				tabId: 1,
				url: c.page.url,
				matches: new Map(
					Array.from({ length: n }, (_, i) => found(i + 1)).map((m) => [
						m.markId,
						m,
					]),
				),
			};
			s.caseHint = { kind: "found" };
		});
	};

	test("the same failure twice is said twice; a render for something else says nothing (DEC-064's second review)", async () => {
		const c = sampleCase("c_hint_again");
		const at = (seq: number) =>
			caseState(c, (s) => {
				s.caseHint = "Not saved: the store refused it";
				s.caseHintSeq = seq;
			});
		render(at(1), noActions);
		let writes = 0;
		new window.MutationObserver(() => void writes++).observe(
			el("case-hint") as unknown as Parameters<
				MutationObserver["observe"]
			>[0] as never,
			{ childList: true, characterData: true, subtree: true },
		);
		render(at(1), noActions);
		await Promise.resolve();
		expect(writes).toBe(0);
		render(at(2), noActions);
		await Promise.resolve();
		expect(writes).toBeGreaterThan(0);
		expect(el("case-hint").textContent).toBe("Not saved: the store refused it");
	});

	test("what a draw found is said once it settled, not at each step of its count (DEC-064's review)", () => {
		const state = drawnWith(2);
		if (state.loaded) state.loaded.settling = true;
		render(state, noActions);
		expect(el("case-hint").textContent).not.toContain("marks found");
		if (state.loaded) state.loaded.settling = false;
		render(state, noActions);
		expect(el("case-hint").textContent).toBe(
			"2 of 2 marks found on www.example.com/kk.",
		);
	});

	test("what a draw found is no sentence on screen, only for a screen reader; a mark saved while adding is counted at once (DEC-061)", () => {
		const state = drawnWith(1);
		render(state, noActions);
		expect(el("case-hint").classList.contains("visually-hidden")).toBe(true);
		expect(el("case-hint").textContent).toBe(
			"1 of 1 marks found on www.example.com/kk.",
		);
		for (const n of [2, 3, 4]) state.loaded?.matches.set(`m${n}`, found(n));
		render(state, noActions);
		expect(el("case-hint").textContent).toBe(
			"4 of 4 marks found on www.example.com/kk.",
		);
		// An action's sentence is on screen.
		state.caseHint = "Exported.";
		render(state, noActions);
		expect(el("case-hint").classList.contains("visually-hidden")).toBe(false);
	});

	test("an action's sentence stays; with the results gone, so is the line", () => {
		const said = drawnWith(2);
		said.caseHint = "Exported.";
		render(said, noActions);
		expect(el("case-hint").textContent).toBe("Exported.");
		const gone = drawnWith(2);
		gone.loaded = undefined;
		render(gone, noActions);
		expect(el("case-hint").hidden).toBe(true);
	});
});

describe("the case's page and size", () => {
	const at = (url: string) => {
		const c = sampleCase("c_page");
		return { ...c, page: { ...c.page, url } };
	};

	test("a web page's address is a link that opens it", () => {
		const opened: Case[] = [];
		const c = at("https://www.example.com/krankenkassen/default?x=1");
		render(caseState(c), actionsWith({ openPage: (it) => opened.push(it) }));
		const link = el<HTMLButtonElement>("open-page");
		expect(link.hidden).toBe(false);
		expect(link.textContent).toBe("www.example.com/krankenkassen/default");
		link.click();
		expect(opened.map((it) => it.id)).toEqual(["c_page"]);
	});

	test("any other address is only text: an imported case's is anyone's", () => {
		for (const url of [
			"javascript:alert(1)",
			"file:///etc/passwd",
			"chrome://settings",
		]) {
			render(caseState(at(url)), noActions);
			expect(el("open-page").hidden).toBe(true);
			const chips = [...(el("open-page").parentElement?.children ?? [])]
				.filter((chip) => !(chip as unknown as HTMLElement).hidden)
				.map((chip) => chip.textContent);
			// The address alone in the Pages fact; size and date in Made at.
			expect(chips).toEqual([url]);
		}
	});

	test("a tab of another size offers the case's", () => {
		const c = sampleCase("c_size");
		const { width, height } = c.page.viewport;
		const tab = (size?: { width: number; height: number }) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url: "", title: "", size };
			});
		render(tab({ width: width - 300, height }), noActions);
		expect(el("case-size").hidden).toBe(false);
		expect(el("case-size").textContent).toContain(
			`This tab is ${width - 300}×${height}`,
		);
		expect(el("match-size").textContent).toBe("Match size");
		render(tab({ width: width + 1, height }), noActions);
		expect(el("case-size").hidden).toBe(true);
		render(tab(undefined), noActions);
		expect(el("case-size").hidden).toBe(true);
	});
});

describe("a case of several pages (DEC-038)", () => {
	const CART = "https://shop.example/cart";
	const PAY = "https://shop.example/checkout/pay";
	const shot = (id: string, url: string, width: number) => ({
		id,
		image: `shots/${id}.webp`,
		scrollX: 0,
		scrollY: 0,
		viewport: { width, height: 800, dpr: 2 },
		capturedAt: "2026-11-19T09:00:00.000Z",
		url,
	});
	const mark = (n: number, shotId: string): Mark => ({
		id: `m${n}`,
		number: n,
		shot: shotId,
		comment: `comment ${n}`,
		author: "user",
		shape: { kind: "box", rect: { x: 1, y: 2, width: 30, height: 40 } },
		crop: `crops/m${n}.webp`,
		element: {
			tag: "button",
			classes: [],
			attributes: {},
			ancestors: [],
			rect: { x: 1, y: 2, width: 30, height: 40 },
			page: { width: 1280, height: 2000 },
			selector: "button",
		},
	});
	const flow = (id: string): Case => ({
		...sampleCase(id),
		title: "Checkout flow",
		page: { ...sampleCase(id).page, url: CART, title: "Your cart" },
		pages: [
			{ url: CART, title: "Your cart", lang: "en" },
			{ url: PAY, title: "Payment", lang: "en" },
		],
		shots: [shot("s1", CART, 1280), shot("s2", PAY, 390)],
		marks: [mark(1, "s1"), mark(2, "s1"), mark(3, "s2")],
	});
	const match = (n: number, status: MarkMatch["status"]): MarkMatch => ({
		markId: `m${n}`,
		number: n,
		status,
		score: status === "found" ? 0.9 : 0,
		current: 0,
		candidates:
			status === "found"
				? [
						{
							score: 0.9,
							summary: "button",
							selector: "button",
							visible: true,
							found: true,
						},
					]
				: [],
	});
	const pages = () =>
		[...el("case-pages").querySelectorAll("li")].map((li) => li.textContent);

	test("a mark of another page: where its link goes, and how its page is named", () => {
		const drawn = (c: Case, url: string) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url, title: "", size: undefined };
				s.loaded = {
					caseId: c.id,
					tabId: 1,
					url,
					matches: new Map(
						[match(1, "found"), match(2, "found"), match(3, "lost")].map(
							(m) => [m.markId, m],
						),
					),
				};
			});
		const link = () =>
			el("case-view").querySelector<HTMLElement>(
				'[data-mark="m3"] .mark-sub .state',
			);
		// On the mark's own site: the page where it was made.
		render(drawn(flow("c_made"), CART), noActions);
		expect(link()?.dataset["markLink"]).toBe("made");
		expect(link()?.title).toContain(PAY);
		// A page without a title is named by its path.
		const untitled = flow("c_untitled");
		render(
			drawn(
				{
					...untitled,
					pages: [
						{ url: CART, title: "Your cart", lang: "en" },
						{ url: PAY, title: "  ", lang: "en" },
					],
				},
				CART,
			),
			noActions,
		);
		expect(link()?.textContent).toBe(`On ${new URL(PAY).pathname}`);
		// A page's title is the page's own text: one line, and cut.
		const long = flow("c_long");
		render(
			drawn(
				{
					...long,
					pages: [
						{ url: CART, title: "Your cart", lang: "en" },
						{ url: PAY, title: `Pay\n now ${"x".repeat(200)}`, lang: "en" },
					],
				},
				CART,
			),
			noActions,
		);
		expect(link()?.textContent).toStartWith("On Pay now x");
		expect(link()?.textContent?.length).toBeLessThanOrEqual(63);
		expect(link()?.getAttribute("aria-label")).not.toContain("\n");
		// A mark of no web page has nowhere to go: the words, and no Show.
		const file = "file:///tmp/pay.html";
		const imported = flow("c_file");
		render(
			drawn(
				{
					...imported,
					pages: [
						{ url: CART, title: "Your cart", lang: "en" },
						{ url: file, title: "Payment", lang: "en" },
					],
					shots: [shot("s1", CART, 1280), shot("s2", file, 390)],
				},
				CART,
			),
			noActions,
		);
		expect(link()?.tagName).toBe("SPAN");
		expect(link()?.textContent).toBe("On another page");
		expect(
			el("case-view").querySelector('[data-mark="m3"] button.show'),
		).toBeNull();
	});

	test("Home: a case is this page's for any of its pages, on their own site only, and its row says how many it has", () => {
		const state = initialState();
		// The same path on localhost: the case is opened by hand there (DEC-050).
		state.tab = {
			id: 1,
			url: "http://localhost:3000/checkout/pay?step=2",
			title: "",
			size: undefined,
		};
		state.cases = [flow("c_flow"), sampleCase("c_other")];
		render(state, noActions);
		expect(el("here").hidden).toBe(true);
		expect(
			window.document.querySelector(
				'ul.cases[data-group="other"] [data-case="c_flow"]',
			),
		).not.toBeNull();
		state.tab = {
			...state.tab,
			url: "https://shop.example/checkout/pay?step=2",
		};
		render(state, noActions);
		expect(el("here").hidden).toBe(false);
		const row = el("here-cases").querySelector('[data-case="c_flow"]');
		// The site and the number of pages (DEC-067).
		expect(row?.textContent).toContain("shop.example · 2 pages");
		expect(row?.getAttribute("aria-label")).toContain(
			"on shop.example, 2 pages",
		);
		expect(
			window.document.querySelector(
				'ul.cases[data-group="other"] [data-case="c_other"]',
			)?.textContent,
		).toContain("www.example.com/kk");
		expect(
			window.document.querySelector(
				'ul.cases[data-group="other"] [data-case="c_flow"]',
			),
		).toBeNull();
	});

	test("the header lists the pages with their marks, says which the tab shows, and opens each", () => {
		const c = flow("c_pages");
		const opened: (string | undefined)[] = [];
		render(
			caseState(c, (s) => {
				s.tab = {
					id: 1,
					url: "http://localhost:3000/checkout/pay",
					title: "",
					size: undefined,
				};
			}),
			actionsWith({ openPage: (_c, url) => void opened.push(url) }),
		);
		expect(el("case-pages").hidden).toBe(false);
		// The title, its marks, its path: the host only where pages differ in it.
		expect(pages()).toEqual([
			"Your cart2 marks/cart",
			"Payment1 mark/checkout/pay",
		]);
		// The page in front is said to a screen reader once, by aria-current,
		// and shown by its row's bar and weight, not by a word that would move
		// the list.
		const here = el("case-pages").querySelector("[aria-current=page]");
		expect(here?.textContent).toBe("Payment");
		expect(el("case-pages").querySelectorAll("[aria-current]").length).toBe(1);
		// The tooltip has the whole title, the whole address, what a click does.
		expect((here as unknown as HTMLElement).title).toBe(
			`Payment\n${PAY}\nOpens in a new tab; the case's marks are drawn there`,
		);
		// The one link of a case of one page gives way to the list.
		expect(el("open-page").hidden).toBe(true);
		// The list is under "Site" and its site's heading, which opens and
		// closes it, and not in a column of the facts (DEC-065, DEC-067); one
		// site: open.
		expect(el("case-pages-section").hidden).toBe(false);
		expect(el("case-sites-heading").textContent).toBe("Site");
		expect(el("case-site-toggle-0").textContent).toBe("shop.example 2");
		expect(el("case-site-toggle-0").getAttribute("aria-expanded")).toBe("true");
		expect(el("case-site-pages-0").hidden).toBe(false);
		expect(el("case-pages").closest(".case-facts")).toBeNull();
		expect(
			[...el("case-facts").querySelectorAll(".fact")]
				.filter((f) => !(f as unknown as HTMLElement).hidden)
				.map((f) => f.querySelector("dt")?.textContent),
		).toEqual(["Link", "Made at"]);
		const links = el("case-pages").querySelectorAll(".page-name");
		(links[1] as unknown as HTMLButtonElement).click();
		(links[0] as unknown as HTMLButtonElement).click();
		expect(opened).toEqual([PAY, CART]);

		// One row per page whatever the host (DEC-063): the payment page marked
		// on shop.example and listed on staging is one row; one without a
		// title by its path. Under the heading "shop.example" its host line
		// names only what the heading does not: the other host (DEC-067).
		const other = "https://staging.shop.example/checkout/pay";
		render(
			caseState({
				...c,
				pages: [c.pages?.[0] ?? c.page, { url: other, title: " ", lang: "" }],
			}),
			noActions,
		);
		expect(pages()).toEqual([
			"Your cart2 marks/cart",
			"/checkout/pay1 markstaging.shop.example",
		]);
		// A click opens it where it was last marked: the tab shows another host.
		expect(
			el("case-pages").querySelectorAll<HTMLElement>(".page-name")[1]?.title,
		).toBe(`${PAY}\nOpens in a new tab; the case's marks are drawn there`);
	});

	test("one site: its list starts open however many pages it has; the choice is remembered, also where the tab shows none (DEC-065, DEC-067)", () => {
		const base = flow("c_many");
		const urls = ["a", "b", "c", "d", "e"].map(
			(x) => `https://shop.example/${x}`,
		);
		const c: Case = {
			...base,
			pages: urls.map((url, i) => ({
				url,
				title: `Page ${i + 1}`,
				lang: "en",
			})),
			shots: urls.map((url, i) => shot(`s${i + 1}`, url, 1280)),
			marks: urls.map((_, i) => mark(i + 1, `s${i + 1}`)),
		};
		const at = (url: string) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url, title: "", size: undefined };
			});
		const toggle = () => el<HTMLButtonElement>("case-site-toggle-0");
		render(at("http://localhost:3000/c"), noActions);
		expect(toggle().textContent).toBe("shop.example 5");
		expect(toggle().getAttribute("aria-expanded")).toBe("true");
		expect(el("case-site-pages-0").querySelectorAll("li").length).toBe(5);
		// The page in front is said above the heading too, named by its label
		// and not by a second aria-current.
		const current = () =>
			[...el("case-current-page").querySelectorAll(".page-name")].map(
				(x) => x.textContent,
			);
		expect(current()).toEqual(["Page 3"]);
		expect(el("case-current-page").parentElement?.hidden).toBe(false);
		expect(el("case-current-page").querySelector("[aria-current]")).toBeNull();
		// Closed as "Comments" is: no row of it shows.
		toggle().click();
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		expect(el("case-site-pages-0").hidden).toBe(true);
		// Remembered for the case and site, also when the tab moves on, and
		// where the tab shows none of the case's pages, render after render.
		render(at("http://localhost:3000/d"), noActions);
		expect(el("case-site-pages-0").hidden).toBe(true);
		expect(current()).toEqual(["Page 4"]);
		render(at("https://shop.example/elsewhere"), noActions);
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		render(at("https://shop.example/elsewhere"), noActions);
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		// None of the case's pages in front: no current page to say.
		expect(el("case-current-page").parentElement?.hidden).toBe(true);
		expect(el("none-found").textContent).toBe(
			"None of this case's pages is in this tab.",
		);
	});

	test("several sites: each a heading of its own, the page in front's open, all where the tab shows none; local pages apart (DEC-067)", () => {
		const base = flow("c_sites");
		const urls = [
			"https://www.comparis.ch/a",
			"https://www.comparis.ch/b",
			"https://ractive.ch/x",
			"https://shop.example/c",
			"http://localhost:3000/local",
		];
		const c: Case = {
			...base,
			page: { ...base.page, url: urls[0] as string, title: "A" },
			pages: urls.map((url, i) => ({
				url,
				title: `Page ${i + 1}`,
				lang: "en",
			})),
			// Page /x was marked on comparis.ch too: it is under both.
			shots: [
				...urls.map((url, i) => shot(`s${i + 1}`, url, 1280)),
				shot("s6", "https://comparis.ch/x", 1280),
			],
			marks: urls.map((_, i) => mark(i + 1, `s${i + 1}`)),
		};
		const at = (url: string) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url, title: "", size: undefined };
			});
		const heads = () =>
			[...el("case-pages").querySelectorAll(".pages-toggle")].map((t) => [
				t.textContent,
				t.getAttribute("aria-expanded"),
			]);
		render(at("https://ractive.ch/elsewhere"), noActions);
		expect(el("case-sites-heading").textContent).toBe("Sites");
		// Most pages first, then by name; the local page in a group of its own.
		expect(heads()).toEqual([
			["comparis.ch 3", "true"],
			["ractive.ch 1", "true"],
			["shop.example 1", "true"],
			["Local addresses 1", "true"],
		]);
		const rows = (i: number) =>
			[...el(`case-site-pages-${i}`).querySelectorAll(".page-name")].map(
				(x) => x.textContent,
			);
		expect(rows(0)).toEqual(["Page 1", "Page 2", "Page 3"]);
		expect(rows(1)).toEqual(["Page 3"]);
		expect(rows(3)).toEqual(["Page 5"]);
		// The tab on /x: the sites it is under are open, the others closed;
		// it is said once to a screen reader, though it is in two lists.
		el("case-site-pages-2").querySelector<HTMLElement>(".page-name")?.focus();
		render(at("https://ractive.ch/x"), noActions);
		expect(heads().map(([, open]) => open)).toEqual([
			"true",
			"true",
			"false",
			"false",
		]);
		expect(el("case-pages").querySelectorAll("[aria-current]").length).toBe(1);
		// A list that closed by itself hands the focus to its heading.
		expect(document.activeElement?.id).toBe("case-site-toggle-2");
		// A row under a site's heading does not name that site again, nor
		// another site, which has the row under its own heading.
		expect(el("case-site-pages-1").querySelector(".page-hosts")).toBeNull();
		// A choice holds for that case and site.
		el<HTMLButtonElement>("case-site-toggle-3").click();
		render(at("https://www.comparis.ch/a"), noActions);
		expect(heads().map(([, open]) => open)).toEqual([
			"true",
			"false",
			"false",
			"true",
		]);
		// The sites' order changes (ractive.ch gets the most pages): each
		// heading is kept, only moved, and the one with the focus keeps it.
		el<HTMLButtonElement>("case-site-toggle-1").focus();
		const more = ["y", "z", "w"].map((x) => `https://ractive.ch/${x}`);
		render(
			caseState(
				{
					...c,
					pages: [
						...(c.pages ?? []),
						...more.map((url) => ({ url, title: url, lang: "en" })),
					],
					shots: [
						...c.shots,
						...more.map((url, i) => shot(`s${i + 7}`, url, 1280)),
					],
				},
				(s) => {
					s.tab = {
						id: 1,
						url: "https://www.comparis.ch/a",
						title: "",
						size: undefined,
					};
				},
			),
			noActions,
		);
		expect(heads()[0]?.[0]).toBe("ractive.ch 4");
		expect(document.activeElement?.id).toBe("case-site-toggle-1");
	});

	test("the marks by page: this page follows the tab, any page from the list or the menu, combined with the status chips, which count what it leaves", () => {
		const base = flow("c_by_page");
		// m1 and m2 on the cart, m3 on the payment page; m2 fixed.
		const c: Case = {
			...base,
			marks: base.marks.map((a) =>
				a.number === 2
					? { ...a, resolution: { kind: "fixed", at: "2026-11-20T10:00:00Z" } }
					: a,
			),
		};
		const chosen: unknown[] = [];
		const actions = actionsWith({
			filterPage: (_id, choice) => void chosen.push(choice),
		});
		const at = (url: string, change?: (s: PanelState) => void) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url, title: "", size: undefined };
				change?.(s);
			});
		const shown = () =>
			[...el("case-view").querySelectorAll("ol.marks > li")].map(
				(li) => (li as unknown as HTMLElement).dataset["mark"],
			);
		const chip = (which: string) =>
			el("case-view").querySelector(
				`[data-page-filter="${which}"]`,
			) as unknown as HTMLButtonElement | null;
		const statusCounts = () =>
			[...el("case-view").querySelectorAll("#case-status .chip")].map(
				(b) => b.textContent,
			);
		const cart = "http://localhost:3000/cart";
		const pay = "http://localhost:3000/checkout/pay";

		// All pages by default; "This page" with the count of the page in front.
		render(at(cart), actions);
		expect(shown()).toEqual(["m1", "m2", "m3"]);
		expect(chip("all")?.getAttribute("aria-pressed")).toBe("true");
		expect(chip("here")?.textContent).toBe("This page 2");
		expect(el("marks-filtered")).toBeNull();
		chip("here")?.click();
		expect(chosen).toEqual(["here"]);

		// This page: the cart's marks; the status chips count those only.
		const here = (s: PanelState) => {
			s.markPage = { caseId: c.id, choice: "here", upTo: 3 };
		};
		render(at(cart, here), actions);
		expect(shown()).toEqual(["m1", "m2"]);
		expect(statusCounts()).toEqual(["● Open 1", "◐ To verify 1"]);
		expect(el("marks-filtered").textContent).toContain("Showing 2 of 3 marks.");
		// It follows the tab.
		render(at(pay, here), actions);
		expect(shown()).toEqual(["m3"]);
		// A page that is none of the case's: nothing, and the way back.
		render(at("http://localhost:3000/elsewhere", here), actions);
		expect(shown()).toEqual([]);
		expect(el("marks-none-on-page").textContent).toContain(
			"The tab in front shows none of this case's pages.",
		);
		// An address the panel may not read is not "none of the case's".
		render(at("", here), actions);
		expect(el("marks-none-on-page").textContent).toContain(
			"Sitegloss cannot read which page the tab in front shows",
		);

		// Combined with a status chip.
		render(
			at(cart, (s) => {
				here(s);
				s.markFilter = { caseId: c.id, group: "toVerify", upTo: 3 };
			}),
			actions,
		);
		expect(shown()).toEqual(["m2"]);
		// A page set with none of the status's marks ends the status filter
		// (in state, main.ts), so it cannot come back by itself.
		const hereChosen = { caseId: c.id, choice: "here" as const, upTo: 3 };
		expect(statusLeft(c, hereChosen, cart, "toVerify")).toBe(true);
		expect(statusLeft(c, hereChosen, pay, "toVerify")).toBe(false);

		// The list of pages: a count sets the filter to its page, said so.
		render(at(cart), actions);
		const count = el("case-pages").querySelector(
			'[data-page="https://shop.example/cart"] .page-count-button',
		) as unknown as HTMLButtonElement;
		// Its name starts with what it shows, and stays; aria-pressed says on.
		expect(count.getAttribute("aria-label")).toBe(
			"2 marks on Your cart: show only these",
		);
		expect(count.getAttribute("aria-pressed")).toBe("false");
		count.focus();
		count.click();
		expect(chosen.at(-1)).toEqual({ page: "/cart" });
		// Drawn anew pressed, the focus still on it.
		render(
			at(cart, (s) => {
				s.markPage = { caseId: c.id, choice: { page: "/cart" }, upTo: 3 };
			}),
			actions,
		);
		const pressed = el("case-pages").querySelector(
			'[data-page="https://shop.example/cart"] .page-count-button',
		);
		expect(pressed?.getAttribute("aria-pressed")).toBe("true");
		expect(pressed?.getAttribute("aria-label")).toBe(
			"2 marks on Your cart: show only these",
		);
		expect(window.document.activeElement === (pressed as unknown)).toBe(true);
		// One page, from the list or the menu: its row says it is the filter.
		const payPage = (s: PanelState) => {
			s.markPage = { caseId: c.id, choice: { page: "/checkout/pay" }, upTo: 3 };
		};
		render(at(cart, payPage), actions);
		expect(shown()).toEqual(["m3"]);
		expect(
			el("case-pages")
				.querySelector("[data-filter]")
				?.getAttribute("data-page"),
		).toBe(PAY);
		expect(el<HTMLSelectElement>("marks-page").value).toBe("/checkout/pay");
		expect(
			[...el<HTMLSelectElement>("marks-page").options].map(
				(o) => o.textContent,
			),
		).toEqual([
			"All pages",
			"Your cart (/cart): 2 marks",
			"Payment (/checkout/pay): 1 mark",
		]);
		// The menu sets it.
		const menu = el<HTMLSelectElement>("marks-page");
		menu.value = "/cart";
		menu.dispatchEvent(new window.Event("change") as unknown as Event);
		expect(chosen.at(-1)).toEqual({ page: "/cart" });
		// A save or a sync that changes nothing it shows keeps the menu (an
		// open one stays open).
		render(
			at(cart, (s) => {
				payPage(s);
				if (s.current)
					s.current = { ...s.current, updatedAt: "2026-11-23T10:00:00Z" };
			}),
			actions,
		);
		expect(el<HTMLSelectElement>("marks-page")).toBe(menu);
		// All of one page's marks settled: said of that page, not the case.
		const settled: Case = {
			...c,
			marks: c.marks.map(
				(a): Mark =>
					a.number === 3
						? {
								...a,
								resolution: {
									kind: "fixed",
									at: "2026-11-20T10:00:00Z",
									verified: { at: "2026-11-21T10:00:00Z" },
								},
							}
						: a,
			),
		};
		render(
			caseState(settled, (s) => {
				s.tab = { id: 1, url: cart, title: "", size: undefined };
				payPage(s);
			}),
			actions,
		);
		expect(el("case-status").textContent).toContain(
			"All marks on Payment are verified or dismissed.",
		);

		// Another case's filter, a page that left the case, a case of one page
		// left, a mark added since: none.
		const none = (markPage: PanelState["markPage"], of: Case = c) => {
			render(
				caseState(of, (s) => {
					s.tab = { id: 1, url: cart, title: "", size: undefined };
					s.markPage = markPage;
				}),
				actions,
			);
			return shown();
		};
		expect(
			none({ caseId: "c_other", choice: { page: "/checkout/pay" }, upTo: 3 }),
		).toEqual(["m1", "m2", "m3"]);
		expect(none({ caseId: c.id, choice: { page: "/gone" }, upTo: 3 })).toEqual([
			"m1",
			"m2",
			"m3",
		]);
		expect(
			none({ caseId: c.id, choice: { page: "/checkout/pay" }, upTo: 2 }),
		).toEqual(["m1", "m2", "m3"]);
		const onePage: Case = {
			...c,
			pages: [c.pages?.[0] ?? c.page],
			shots: c.shots.slice(0, 1),
			marks: c.marks.filter((a) => a.shot === "s1"),
		};
		expect(
			pageFilterEnds(onePage, { caseId: c.id, choice: "here", upTo: 3 }),
		).toBe(true);
		expect(
			pageFilterEnds(c, { caseId: c.id, choice: { page: "/gone" }, upTo: 3 }),
		).toBe(true);
		expect(pageFilterEnds(c, { caseId: c.id, choice: "here", upTo: 3 })).toBe(
			false,
		);
	});

	test("the size offered is the one the marks of the page in front were made at", () => {
		const c = flow("c_sizes");
		const on = (url: string) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url, title: "", size: { width: 1000, height: 800 } };
			});
		render(on("http://localhost:3000/cart"), noActions);
		expect(el("case-size").textContent).toContain(
			"This tab is 1000×800; the marks were made at 1280×800.",
		);
		render(on("http://localhost:3000/checkout/pay"), noActions);
		expect(el("case-size").textContent).toContain(
			"This tab is 1000×800; the marks were made at 390×800.",
		);
	});

	test("a mark of another page is on another page, not lost; none found is said of the page's own", () => {
		const c = flow("c_judged");
		const on = (url: string, matches: MarkMatch[]) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url, title: "", size: undefined };
				s.loaded = {
					caseId: c.id,
					tabId: 1,
					url,
					matches: new Map(matches.map((m) => [m.markId, m])),
				};
				s.caseHint = { kind: "found" };
			});
		const word = (n: number) =>
			el("case-view").querySelector(`[data-mark="m${n}"] .mark-sub .state`)
				?.textContent;
		const cart = "http://localhost:3000/cart";
		const opened: [string, string][] = [];
		render(
			on(cart, [match(1, "found"), match(2, "found"), match(3, "lost")]),
			actionsWith({
				openMarkPage: (_c, mark, where) => void opened.push([mark.id, where]),
			}),
		);
		expect(el("none-found").hidden).toBe(true);
		// Not on screen: the page filter's counts say it (DEC-061).
		expect(el("case-hint").classList.contains("visually-hidden")).toBe(true);
		expect(word(1)).toContain("Found here");
		// A link to the mark's page, named by its title: not the bare words.
		expect(word(3)).toBe("On Payment");
		const link = el("case-view").querySelector<HTMLButtonElement>(
			'[data-mark="m3"] .mark-sub button.elsewhere',
		);
		expect(link?.getAttribute("aria-label")).toBe(
			"On Payment: opens in this tab and shows mark 3 there",
		);
		// On localhost the link stays on localhost: the same page there.
		expect(link?.dataset["markLink"]).toBe("here");
		expect(link?.title).toContain("localhost:3000/checkout/pay");
		// Every mark has Show: here it scrolls to the mark, there it opens the page.
		const showOf = (n: number) =>
			el("case-view").querySelector<HTMLButtonElement>(
				`[data-mark="m${n}"] button.show`,
			);
		expect(showOf(1)?.dataset["action"]).toBe("show");
		expect(showOf(3)?.dataset["action"]).toBe("show-elsewhere");
		expect(showOf(3)?.getAttribute("aria-label")).toBe(
			"Show mark 3: open Payment in this tab",
		);
		showOf(3)?.click();
		el("case-view")
			.querySelector<HTMLButtonElement>(
				'[data-mark="m3"] .mark-sub button.elsewhere',
			)
			?.click();
		expect(opened).toEqual([
			["m3", "here"],
			["m3", "here"],
		]);
		// Not red, and no "Not found" in its row.
		const row = el("case-view").querySelector('[data-mark="m3"]');
		expect(row?.getAttribute("data-colour")).toBeNull();
		expect(row?.textContent).toContain("Marked on shop.example/checkout/pay");
		expect(row?.textContent).not.toContain("Not found");

		// The page's own marks are gone: that is said, of this page.
		render(
			on(cart, [match(1, "lost"), match(2, "lost"), match(3, "lost")]),
			noActions,
		);
		expect(el("none-found").hidden).toBe(false);
		expect(el("none-found").textContent).toContain(
			"None of this page's marks were found here.",
		);
		expect(el("none-found").textContent).not.toContain("other pages");

		// A page that is none of the case's: one quiet line; the pages list,
		// open, says where the marks are (DEC-063); every mark is on another page.
		render(
			on("http://localhost:3000/account", [
				match(1, "lost"),
				match(2, "lost"),
				match(3, "lost"),
			]),
			noActions,
		);
		expect(el("none-found").textContent).toBe(
			"None of this case's pages is in this tab.",
		);
		expect([word(1), word(2), word(3)]).toEqual([
			"On Your cart",
			"On Your cart",
			"On Payment",
		]);
		expect(el("case-hint").hidden).toBe(true);
		// Started on a page that has no marks (DEC-026), marked elsewhere: on
		// that page nothing is said; it is one of the case's, and normal.
		const START = "https://shop.example/start";
		const started: Case = {
			...c,
			page: { ...c.page, url: START },
			pages: [{ url: START, title: "Start", lang: "en" }, ...(c.pages ?? [])],
		};
		expect(
			noneFoundText(started, "http://localhost:3000/start", false) ===
				undefined,
		).toBe(true);

		// The tab went on within the page (a single-page app): what the panel
		// has is about the page before until it is read again, and then says
		// the new page's numbers, not the old ones.
		const pay = "http://localhost:3000/checkout/pay";
		const moved = on(pay, [
			match(1, "lost"),
			match(2, "lost"),
			match(3, "found"),
		]);
		render(moved, noActions);
		expect(el("case-hint").classList.contains("visually-hidden")).toBe(true);
		expect(word(3)).toContain("Found here");
		expect(word(1)).toBe("On Your cart");
	});
});

describe("the account and the sync with a team (DEC-039)", () => {
	type Cloud = PanelState["cloud"];
	const TEAM = {
		id: "t_1",
		name: "Pedal & Pine web",
		permissions: ["case:create", "case:delete", "mark:create"],
	};
	const account = (
		more: Partial<NonNullable<Cloud["account"]>> = {},
	): NonNullable<Cloud["account"]> => ({
		name: "Tess Tester",
		email: "tess@example.com",
		userId: "u_tess",
		server: "https://app.sitegloss.dev",
		teams: [TEAM],
		teamId: "t_1",
		expired: false,
		...more,
	});
	const home = (cloud: Partial<Cloud>, actions: Actions = noActions) => {
		const state = initialState();
		Object.assign(state.cloud, cloud);
		render(state, actions);
		return state;
	};
	const button = (action: string, within = "cloud") =>
		el(within).querySelector(
			`[data-action="${action}"]`,
		) as unknown as HTMLButtonElement | null;

	test("signed out: what signing in sends where, in one sentence, and Sign in", () => {
		const clicked: string[] = [];
		home({}, actionsWith({ cloudSignIn: () => void clicked.push("in") }));
		expect(el("cloud-heading").textContent).toBe("Team");
		// Home in the order a newcomer reads it, one level each (DEC-045).
		expect(
			[...document.querySelectorAll("#home h2, #home h3")].map(
				(h) => `${h.tagName} ${h.textContent}`,
			),
		).toEqual([
			"H2 This page",
			"H2 Cases",
			"H2 Team",
			"H2 Files",
			"H3 Copy to a folder",
		]);
		expect(el("cloud").dataset["cloud"]).toBe("off");
		expect(el("cloud").textContent).toContain(
			"Sign in to sync with your team.",
		);
		// What goes where: the server, and what is kept out of an address.
		expect(el("cloud").textContent).toContain("app.sitegloss.dev");
		expect(el("cloud").textContent).toContain("e-mail address");
		expect(el("cloud").textContent).toContain("stays in this browser");
		// The service itself: no word about the server, and nothing to choose
		// unless one opens "Server".
		expect(el("cloud-server-name")).toBeNull();
		const details = el("cloud").querySelector(
			".cloud-server",
		) as unknown as HTMLDetailsElement;
		expect(details.hasAttribute("open")).toBe(false);
		button("cloud-sign-in")?.click();
		expect(clicked).toEqual(["in"]);
		expect(el("cloud-banner").hidden).toBe(true);
		// The browser's window is open: no second one.
		home({ signingIn: true });
		expect(button("cloud-sign-in")?.disabled).toBe(true);
		expect(button("cloud-sign-in")?.textContent).toBe("Signing in…");
		// And no other server meanwhile: the sign-in ends where it began.
		expect(el<HTMLSelectElement>("cloud-server-choice").disabled).toBe(true);
		expect(el<HTMLInputElement>("cloud-server").disabled).toBe(true);
		home({});
		expect(el<HTMLSelectElement>("cloud-server-choice").disabled).toBe(false);
		expect(el<HTMLInputElement>("cloud-server").disabled).toBe(false);
	});

	test("the server is chosen from three: the service, the development server, another address (DEC-041)", () => {
		const set: string[] = [];
		const actions = actionsWith({
			cloudServer: (text) => void set.push(text),
		});
		home({}, actions);
		const choice = () => el<HTMLSelectElement>("cloud-server-choice");
		const pick = (value: string) => {
			choice().value = value;
			choice().dispatchEvent(new window.Event("change") as unknown as Event);
		};
		expect(
			[...choice().querySelectorAll("option")].map((o) => [
				o.getAttribute("value"),
				o.textContent,
			]),
		).toEqual([
			["production", "Sitegloss (app.sitegloss.dev)"],
			["development", "Development server"],
			["other", "Another address…"],
		]);
		expect(choice().value).toBe("production");
		expect(el("cloud-server-other").hidden).toBe(true);
		pick("development");
		expect(set).toEqual(["https://app.dev.sitegloss.dev"]);
		// Another address: the field shows, and nothing is chosen until one is typed.
		pick("other");
		expect(set).toHaveLength(1);
		expect(el("cloud-server-other").hidden).toBe(false);
		const field = el<HTMLInputElement>("cloud-server");
		field.value = "  ";
		field.dispatchEvent(new window.Event("change") as unknown as Event);
		expect(set).toHaveLength(1);
		field.value = "http://localhost:3200";
		field.dispatchEvent(new window.Event("change") as unknown as Event);
		expect(set).toEqual([
			"https://app.dev.sitegloss.dev",
			"http://localhost:3200",
		]);
		// Back to the service: its own address, said as "none set".
		field.blur();
		pick("production");
		expect(set.at(-1)).toBe("");
	});

	test("a server that is not the service is said in words, beside the account and before signing in", () => {
		home({ server: "https://app.dev.sitegloss.dev" });
		expect(el("cloud-server-name").textContent).toBe(
			"Development server (app.dev.sitegloss.dev): not the real Sitegloss",
		);
		expect(el<HTMLSelectElement>("cloud-server-choice").value).toBe(
			"development",
		);
		expect(el("cloud").textContent).toContain(
			"your cases go to app.dev.sitegloss.dev",
		);
		// The other address the development server may get is it as well.
		home({ server: "https://app-dev.sitegloss.dev" });
		expect(el("cloud-server-name").textContent).toBe(
			"Development server (app-dev.sitegloss.dev): not the real Sitegloss",
		);
		home({ server: "http://localhost:3200" });
		expect(el("cloud-server-name").textContent).toBe(
			"Another server (localhost:3200): not sitegloss.dev",
		);
		expect(el<HTMLSelectElement>("cloud-server-choice").value).toBe("other");
		expect(el<HTMLInputElement>("cloud-server").value).toBe(
			"http://localhost:3200",
		);
		expect(el("cloud-server-other").hidden).toBe(false);
		// Signed in: beside the account, and nothing to choose any more.
		home({
			server: "https://app.dev.sitegloss.dev",
			account: account({ server: "https://app.dev.sitegloss.dev" }),
		});
		expect(el("cloud-server-name").textContent).toBe(
			"Development server (app.dev.sitegloss.dev): not the real Sitegloss",
		);
		expect(el("cloud-server-choice")).toBeNull();
		home({ account: account() });
		expect(el("cloud-server-name")).toBeNull();
	});

	test("signed in: who, which team, what the sync is at, Sync now and Sign out", () => {
		const did: string[] = [];
		const actions = actionsWith({
			cloudSyncNow: () => void did.push("sync"),
			cloudSignOut: () => void did.push("out"),
		});
		home(
			{
				account: account(),
				status: {
					state: "synced",
					lastSyncedAt: "2026-11-19T10:00:00.000Z",
					problems: [],
					undecided: 0,
				},
			},
			actions,
		);
		expect(el("cloud-who").textContent).toBe(
			"Signed in as Tess Tester (tess@example.com)",
		);
		expect(el("cloud-team-name").textContent).toBe("Team: Pedal & Pine web");
		// The stream not open yet: when it last synced, and Sync now.
		expect(el("cloud-status").textContent).toStartWith("Last synced ");
		expect(el("cloud").dataset["cloud"]).toBe("synced");
		button("cloud-sync-now")?.click();
		button("cloud-sign-out")?.click();
		expect(did).toEqual(["sync", "out"]);

		const at = (status: Cloud["status"]) => {
			home({ account: account(), status }, actions);
			return el("cloud-status").textContent;
		};
		expect(at({ state: "syncing", left: 3, problems: [], undecided: 0 })).toBe(
			"Syncing 3 cases…",
		);
		expect(
			at({
				state: "offline",
				text: "The server cannot be reached. Your changes are kept and sent when it can.",
				problems: [],
				undecided: 0,
			}),
		).toContain("Offline: changes are kept");
		expect(
			at({ state: "offline", problems: [], undecided: 0, waiting: 1 }),
		).toContain("1 case waits to be sent");
		// What the server did not take, in its words, by case.
		at({
			state: "problem",
			problems: [
				{
					caseId: "c_1",
					title: "Checkout",
					text: "A change to a mark was not taken: A mark holds at most 20 findings.",
				},
			],
			undecided: 0,
		});
		expect(el("cloud-problems").textContent).toBe(
			"“Checkout”: A change to a mark was not taken: A mark holds at most 20 findings.",
		);
	});

	test("the status line says the state, not a time: up to date while the stream is open and nothing waits; Sync now only when it can do something (DEC-045)", () => {
		const synced = (more: Partial<NonNullable<Cloud["status"]>> = {}) => ({
			state: "synced" as const,
			lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
			problems: [],
			undecided: 0,
			waiting: 0,
			...more,
		});
		const line = () => el("cloud-status").textContent;
		home({ account: account(), status: synced(), live: true });
		expect(line()).toBe("Up to date. Changes sync as you work.");
		expect(button("cloud-sync-now")).toBeNull();
		expect(button("cloud-sign-out")).not.toBeNull();
		// Something waits to be sent: said, and Sync now sends it.
		home({ account: account(), status: synced({ waiting: 2 }), live: true });
		expect(line()).toBe("2 cases wait to be sent.");
		expect(button("cloud-sync-now")).not.toBeNull();
		// The stream closed for a while: when it last synced, and how the
		// team's changes come now.
		home({ account: account(), status: synced(), live: false });
		expect(line()).toStartWith("Last synced 5 minutes ago.");
		expect(line()).toContain("not coming in live");
		expect(button("cloud-sync-now")).not.toBeNull();
		// Being opened: when it last synced, no claim about live changes.
		home({ account: account(), status: synced(), live: undefined });
		expect(line()).toBe("Last synced 5 minutes ago.");
		// A refusal: Sync now tries again.
		home({
			account: account(),
			status: {
				...synced(),
				state: "problem",
				text: "Some changes were not taken by the server:",
				problems: [{ caseId: "c_1", text: "No." }],
			},
			live: true,
		});
		expect(button("cloud-sync-now")).not.toBeNull();
		// While it syncs, nothing to press.
		home({
			account: account(),
			status: { ...synced(), state: "syncing" },
			live: true,
		});
		expect(line()).toBe("Syncing…");
		expect(button("cloud-sync-now")).toBeNull();
	});

	test("a minute later only the time's words change in place: nothing drawn anew, the focus stays (DEC-045)", () => {
		const real = Date.now;
		const t = Date.parse("2026-11-20T14:08:00.000Z");
		try {
			Date.now = () => t;
			const state = initialState();
			Object.assign(state.cloud, {
				account: account(),
				live: false,
				minute: 1,
				status: {
					state: "synced",
					lastSyncedAt: new Date(t - 5 * 60_000).toISOString(),
					problems: [],
					undecided: 0,
					waiting: 0,
				},
			});
			render(state, noActions);
			const first = el("cloud").firstElementChild;
			button("cloud-sync-now")?.focus();
			expect(el("cloud-status").textContent).toStartWith(
				"Last synced 5 minutes ago.",
			);
			// The tick, a minute later.
			Date.now = () => t + 60_000;
			state.cloud.minute = 2;
			render(state, noActions);
			expect(el("cloud-status").textContent).toStartWith(
				"Last synced 6 minutes ago.",
			);
			expect(el("cloud").firstElementChild).toBe(first);
			expect(window.document.activeElement?.getAttribute("data-action")).toBe(
				"cloud-sync-now",
			);
			// And a tick with the same words changes nothing at all.
			state.cloud.minute = 3;
			const line = el("cloud-status");
			render(state, noActions);
			expect(el("cloud-status")).toBe(line);
		} finally {
			Date.now = real;
		}
	});

	test("a time said as people say it", () => {
		const now = Date.parse("2026-11-20T14:08:00.000Z");
		expect(ago("2026-11-20T14:07:40.000Z", now)).toBe("just now");
		expect(ago("2026-11-20T14:07:00.000Z", now)).toBe("1 minute ago");
		expect(ago("2026-11-20T13:08:00.000Z", now)).toBe("1 hour ago");
		expect(ago("2026-11-18T14:08:00.000Z", now)).toStartWith("on ");
	});

	test("the tab in front is the team's web app: said in one line, only for the server signed in to (DEC-045)", () => {
		const tab = (url: string) => ({
			id: 1,
			url,
			title: "Case",
			size: undefined,
		});
		const at = (url: string, more: Partial<Cloud> = {}) => {
			const state = initialState();
			Object.assign(state.cloud, { account: account(), ...more });
			state.tab = tab(url);
			render(state, noActions);
			return el("web-app-note");
		};
		const note = at("https://app.sitegloss.dev/t/pedal/cases/c_1");
		expect(note.hidden).toBe(false);
		expect(note.textContent).toContain(
			"your team's web app at app.sitegloss.dev",
		);
		expect(at("https://shop.example/cart").hidden).toBe(true);
		// Signed out: no team, no web app of one.
		expect(
			at("https://app.sitegloss.dev/t/pedal", { account: undefined }).hidden,
		).toBe(true);
		// Signed in to the development server: the service's pages are not its web app.
		expect(
			at("https://app.sitegloss.dev/t/pedal", {
				account: account({ server: "https://app.dev.sitegloss.dev" }),
			}).hidden,
		).toBe(true);
		expect(
			at("https://app.dev.sitegloss.dev/t/pedal", {
				account: account({ server: "https://app.dev.sitegloss.dev" }),
			}).hidden,
		).toBe(false);
		// Not in an open case (DEC-061): Home says it; the case's head stays calm.
		const c = sampleCase("c_1");
		const state = caseState(c, (s) => {
			s.cloud.account = account();
			s.tab = tab("https://app.sitegloss.dev/t/pedal/cases/c_1");
		});
		render(state, noActions);
		expect(el("case-view").textContent).not.toContain("your team's web app");
		expect(webAppNote(state)).toContain("your team's web app");
	});

	test("an AI app just paired: its card says what to ask it and offers the way back (DEC-045)", () => {
		const closed: string[] = [];
		const actions = actionsWith({ closeSettings: () => void closed.push("x") });
		const state = initialState();
		state.settings = true;
		state.ai.justPaired = { grantId: "g1", name: "Claude" };
		render(state, actions);
		expect(el("paired-next").hidden).toBe(false);
		expect(el("paired-next-text").textContent).toBe("Claude is connected.");
		expect(el("paired-next").textContent).toContain("fix its marks");
		expect(el("paired-back").textContent).toBe("Back to the cases");
		el<HTMLButtonElement>("paired-back").click();
		expect(closed).toEqual(["x"]);
		// Opened over a case: back to it.
		const c = sampleCase("c_1");
		const over = caseState(c, (s) => {
			s.settings = true;
			s.ai.justPaired = { grantId: "g1", name: "Claude" };
		});
		render(over, actions);
		expect(el("paired-back").textContent).toBe("Back to the case");
		// Not in the card's view any more, or nothing paired: nothing said.
		over.settings = false;
		render(over, actions);
		expect(el("paired-next").hidden).toBe(true);
	});

	test("several teams: a chooser; no team yet: where to make one", () => {
		const chosen: string[] = [];
		const teams = [TEAM, { id: "t_2", name: "Other team", permissions: [] }];
		home(
			{ account: account({ teams, teamId: undefined }) },
			actionsWith({ cloudTeam: (id) => void chosen.push(id) }),
		);
		const select = el<HTMLSelectElement>("cloud-team");
		expect([...select.options].map((o) => o.textContent)).toEqual([
			"Choose a team…",
			"Pedal & Pine web",
			"Other team",
		]);
		expect(el("cloud-status").textContent).toBe("Choose a team to sync with.");
		select.value = "t_2";
		select.dispatchEvent(new window.Event("change") as unknown as Event);
		expect(chosen).toEqual(["t_2"]);
		home({ account: account({ teams: [], teamId: undefined }) });
		expect(el("cloud-status").textContent).toContain("in no team yet");
		expect(el("cloud-status").textContent).toContain("app.sitegloss.dev");
	});

	test("a note is said under the status, and not as a warning", () => {
		home({
			account: account(),
			status: {
				state: "synced",
				lastSyncedAt: "2026-11-19T10:00:00.000Z",
				problems: [],
				notes: [
					{
						caseId: "c_1",
						title: "Your cart",
						text: "1 mark deleted while not syncing is back: the team still has it.",
					},
				],
				undecided: 0,
			},
		});
		expect(el("cloud").dataset["cloud"]).toBe("synced");
		expect(el("cloud-problems")).toBeNull();
		const note = el("cloud-notes").querySelector("li");
		expect(note?.textContent).toBe(
			"“Your cart”: 1 mark deleted while not syncing is back: the team still has it.",
		);
		expect(note?.getAttribute("role")).toBeNull();
		expect(note?.className).toBe("meta");
	});

	test("cases that were here before the team: asked above every view, with what sharing means", () => {
		const answers: boolean[] = [];
		const state = home(
			{
				account: account(),
				status: { state: "synced", problems: [], undecided: 2 },
			},
			actionsWith({ cloudDecide: (share) => void answers.push(share) }),
		);
		const banner = el("cloud-banner");
		expect(banner.hidden).toBe(false);
		expect(banner.textContent).toContain(
			"2 cases are on this device only. Sync them with “Pedal & Pine web”? Its members will see them, with their marks, screenshots and the addresses of the pages marked.",
		);
		button("cloud-sync-them", "cloud-banner")?.click();
		button("cloud-keep-them", "cloud-banner")?.click();
		expect(answers).toEqual([true, false]);
		expect(button("cloud-keep-them", "cloud-banner")?.textContent).toBe(
			"Keep them on this device",
		);
		// Cases the team already has: the question says what the click replaces.
		home({
			account: account(),
			status: {
				state: "synced",
				problems: [],
				undecided: 2,
				joins: { cases: 1, marks: 3 },
			},
		});
		expect(el("cloud-banner").textContent).toContain(
			"addresses of the pages marked. The team already has 1 of them; where both differ the team's text is kept: 3 marks.",
		);
		home({
			account: account(),
			status: {
				state: "synced",
				problems: [],
				undecided: 1,
				joins: { cases: 1, marks: 1 },
			},
		});
		expect(el("cloud-banner").textContent).toContain(
			"The team already has this case; where both differ the team's text is kept: 1 mark.",
		);
		home({
			account: account(),
			status: {
				state: "synced",
				problems: [],
				undecided: 1,
				joins: { cases: 1, marks: 0 },
			},
		});
		expect(el("cloud-banner").textContent).toContain(
			"pages marked. The team already has this case.",
		);
		// On a server that is not the service the question names the server:
		// a team's name is that server's word, and the click sends cases.
		for (const [server, host] of [
			["https://sync.example.org", "sync.example.org"],
			["https://app.dev.sitegloss.dev", "app.dev.sitegloss.dev"],
		] as const) {
			home({
				server,
				account: account({ server }),
				status: { state: "synced", problems: [], undecided: 2 },
			});
			expect(el("cloud-banner").textContent).toContain(
				`Sync them with “Pedal & Pine web” on ${host}? Its members`,
			);
		}
		home({
			account: account(),
			status: { state: "synced", problems: [], undecided: 2 },
		});
		expect(el("cloud-banner").textContent).not.toContain(" on app.");
		// In a case too: the banner is above the views.
		state.view = { kind: "case", id: "c_x" };
		state.current = sampleCase("c_x");
		render(state, noActions);
		expect(el("cloud-banner").hidden).toBe(false);
		// One case, and a role that may not share.
		home({
			account: account({ teams: [{ ...TEAM, permissions: [] }] }),
			status: { state: "synced", problems: [], undecided: 1 },
		});
		expect(el("cloud-banner").textContent).toContain(
			"1 case is on this device only",
		);
		expect(el("cloud-banner").textContent).toContain("does not allow sharing");
		expect(button("cloud-sync-them", "cloud-banner")).toBeNull();
	});

	test("a sign-in that ran out: said above every view, with Sign in again", () => {
		const clicked: string[] = [];
		home(
			{ account: account({ expired: true }) },
			actionsWith({ cloudSignIn: () => void clicked.push("in") }),
		);
		expect(el("cloud-banner").textContent).toContain("Team sync is signed out");
		button("cloud-sign-in", "cloud-banner")?.click();
		expect(clicked).toEqual(["in"]);
		expect(el("cloud").dataset["cloud"]).toBe("signed-out");
		expect(button("cloud-sync-now")).toBeNull();
	});

	test("a case says whether the team has it; one on this device only can be shared, and is tagged in the list", () => {
		const shared: string[] = [];
		const c = sampleCase("c_local");
		const cloud: Partial<Cloud> = {
			account: account(),
			modes: { c_local: "local", c_team: "synced" },
		};
		const state = caseState(c, (s) => Object.assign(s.cloud, cloud));
		render(state, actionsWith({ cloudShare: (id) => void shared.push(id) }));
		expect(el("case-team").hidden).toBe(false);
		expect(el("case-team").firstElementChild?.textContent).toBe(
			"On this device only. ",
		);
		expect(el("share-case").hidden).toBe(false);
		el("share-case").click();
		expect(shared).toEqual(["c_local"]);
		// The team's case, and one made since (the sync has not seen it yet).
		for (const id of ["c_team", "c_new"]) {
			const team = caseState(sampleCase(id), (s) =>
				Object.assign(s.cloud, cloud),
			);
			render(team, noActions);
			expect(el("case-team").firstElementChild?.textContent).toBe(
				"Synced with “Pedal & Pine web”",
			);
			expect(el("share-case").hidden).toBe(true);
		}
		// Nobody signed in: nothing about a team anywhere.
		render(caseState(sampleCase("c_local")), noActions);
		expect(el("case-team").hidden).toBe(true);

		const list = initialState();
		Object.assign(list.cloud, cloud);
		list.cases = [sampleCase("c_local"), sampleCase("c_team")];
		render(list, noActions);
		const tag = (id: string) =>
			window.document.querySelector(`[data-case="${id}"] .device-only`)
				?.textContent;
		expect(tag("c_local")).toBe("This device only");
		expect(tag("c_team")).toBeUndefined();
	});

	test("deleting a case the team has says that it deletes it for the team; a role that may not cannot", () => {
		const cloud: Partial<Cloud> = {
			account: account(),
			modes: { c_team: "synced" },
		};
		const armed = (id: string, with_: Partial<Cloud>, arm: boolean) => {
			const state = caseState(sampleCase(id), (s) => {
				Object.assign(s.cloud, with_);
				s.deleteArmedAt = arm ? 1 : undefined;
			});
			render(state, noActions);
			return el<HTMLButtonElement>("delete-case");
		};
		expect(armed("c_team", cloud, false).title).toContain(
			"for everyone in “Pedal & Pine web” (click twice)",
		);
		expect(armed("c_team", cloud, true).textContent).toBe(
			"Really delete for the team?",
		);
		expect(armed("c_team", cloud, true).title).toContain(
			"Click again to delete this case and its screenshots, here and for everyone in “Pedal & Pine web”",
		);
		// A case on this device only is deleted as ever.
		expect(
			armed("c_local", { ...cloud, modes: { c_local: "local" } }, true)
				.textContent,
		).toBe("Really delete?");
		const noDelete = {
			...cloud,
			account: account({ teams: [{ ...TEAM, permissions: ["case:create"] }] }),
		};
		const button = armed("c_team", noDelete, false);
		expect(button.disabled).toBe(true);
		expect(button.title).toContain("does not allow deleting");
		expect(
			armed("c_local", { ...noDelete, modes: { c_local: "local" } }, false)
				.disabled,
		).toBe(false);
	});

	test("who did something shows: by Dana, by Dana via Claude, added by Tess (DEC-046)", () => {
		const c = sampleCase("c_who");
		const app = {
			id: "https://claude.ai/oauth",
			name: "Claude",
			host: "claude.ai",
		};
		const marked: Case = {
			...c,
			shots: [
				{
					id: "s1",
					image: "shots/s1.webp",
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 2 },
					capturedAt: "2026-11-19T09:00:00.000Z",
				},
			],
			marks: [
				{
					id: "m1",
					number: 1,
					shot: "s1",
					comment: "Too pale",
					author: "user",
					shape: { kind: "note", at: { x: 1, y: 2 } },
					crop: "crops/m1.webp",
					element: null,
					createdBy: { id: "u_tess", name: "Tess Tester" },
					resolution: {
						kind: "fixed",
						at: "2026-11-19T10:00:00.000Z",
						app,
						user: { id: "u_dana", name: "Dana Developer" },
						verified: {
							at: "2026-11-19T11:00:00.000Z",
							user: { id: "u_tess", name: "Tess Tester" },
						},
					},
					findings: [
						{
							id: "f_1",
							text: "The token is overridden",
							app,
							at: "2026-11-19T09:30:00.000Z",
							user: { id: "u_dana", name: "Dana Developer" },
						},
					],
				},
			],
		};
		render(caseState(marked), noActions);
		const mark = el("case-view").querySelector('[data-mark="m1"]');
		const history = [...(mark?.querySelectorAll(".history li") ?? [])].map(
			(li) => li.textContent,
		);
		expect(history[0]).toContain("by Dana Developer via Claude");
		expect(history[1]).toContain("by Tess Tester");
		expect(mark?.querySelector(".finding-meta")?.textContent).toContain(
			"Dana Developer via Claude",
		);
		expect(mark?.querySelector(".mark-by")?.textContent).toBe(
			"Added by Tess Tester",
		);
	});
});

describe("the thread and closing (DEC-046)", () => {
	const withThread = (c: Case): Case => ({
		...c,
		comments: [
			{
				id: "k_1",
				text: "Looked at both pages.",
				at: "2026-11-20T10:00:00.000Z",
				user: { id: "u_tess", name: "Tess Tester" },
			},
			{
				id: "k_2",
				mark: "m1",
				text: "Fixed in PR 12.",
				at: "2026-11-20T11:00:00.000Z",
				user: { id: "u_dana", name: "Dana Developer" },
				app: {
					id: "https://claude.ai/oauth",
					name: "Claude",
					host: "claude.ai",
				},
			},
		],
	});

	const asTess = (s: PanelState) => {
		s.cloud.account = {
			name: "Tess Tester",
			email: "tess@example.com",
			userId: "u_tess",
			server: "https://app.sitegloss.dev",
			teams: [],
			teamId: undefined,
			expired: false,
		};
	};
	const twoOfTess = (c: Case): Case => ({
		...c,
		comments: ["k_a", "k_b"].map((id, i) => ({
			id,
			mark: "m1",
			text: `Comment ${i + 1}`,
			at: `2026-11-20T1${i}:00:00.000Z`,
			user: { id: "u_tess", name: "Tess Tester" },
		})),
	});

	test("at a mark, the focus stays on the comment acted on after a redraw, not the first one (DEC-064's review)", () => {
		const c = twoOfTess(withOneMark(sampleCase("c_two")));
		render(caseState(c, asTess), noActions);
		const del = (id: string) =>
			window.document.querySelector(
				`[data-mark-thread="m1"] [data-comment="${id}"] [data-action="comment-delete"]`,
			) as unknown as HTMLButtonElement;
		del("k_b").focus();
		// Another change of the case redraws the list.
		render(
			caseState({ ...c, updatedAt: "2026-11-21T10:00:00.000Z" }, asTess),
			noActions,
		);
		expect(window.document.activeElement === (del("k_b") as unknown)).toBe(
			true,
		);
	});

	test("a comment at a mark whose save fails keeps its box and its text (DEC-064's review)", async () => {
		const c = withOneMark(sampleCase("c_fail"));
		let answer = false;
		const actions = actionsWith({ addComment: () => Promise.resolve(answer) });
		render(caseState(c, asTess), actions);
		const q = (sel: string) =>
			window.document.querySelector(
				`[data-mark-thread="m1"] ${sel}`,
			) as unknown as HTMLElement | null;
		(q('[data-action="mark-comment-open"]') as HTMLButtonElement).click();
		await Promise.resolve();
		const box = q("textarea") as unknown as HTMLTextAreaElement;
		box.value = "Checked on staging";
		box.dispatchEvent(new window.Event("input") as unknown as Event);
		(q('[data-action="mark-comment-add"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		render(
			caseState({ ...c, updatedAt: "2026-11-21T10:00:00.000Z" }, asTess),
			actions,
		);
		expect(
			(q("textarea") as unknown as HTMLTextAreaElement | null)?.value,
		).toBe("Checked on staging");
		// Saved the next time: the box closes.
		answer = true;
		(q('[data-action="mark-comment-add"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		expect(q("textarea") === null).toBe(true);
	});

	test("typing at a mark survives a redraw of the list: the same box, the caret where it was (DEC-064's review)", async () => {
		const c = withOneMark(sampleCase("c_typing"));
		render(caseState(c, asTess), noActions);
		(
			window.document.querySelector(
				'[data-mark-thread="m1"] [data-action="mark-comment-open"]',
			) as unknown as HTMLButtonElement
		).click();
		await Promise.resolve();
		const box = () =>
			window.document.querySelector(
				'[data-mark-thread="m1"] textarea',
			) as unknown as HTMLTextAreaElement;
		box().value = "Half way";
		box().dispatchEvent(new window.Event("input") as unknown as Event);
		box().setSelectionRange(4, 4);
		render(
			caseState({ ...c, updatedAt: "2026-11-21T10:00:00.000Z" }, asTess),
			noActions,
		);
		expect(window.document.activeElement === (box() as unknown)).toBe(true);
		expect([box().value, box().selectionStart]).toEqual(["Half way", 4]);
	});

	test("the thread at the bottom is the case's; a comment about a mark shows at the mark, with Add comment there (DEC-061)", async () => {
		const done: string[] = [];
		const actions = actionsWith({
			addComment: (_c, text, mark) => void done.push(`add ${text} ${mark}`),
			deleteComment: (_c, id) => void done.push(`delete ${id}`),
		});
		const c = withThread(withOneMark(sampleCase("c_t")));
		render(
			caseState(c, (s) => {
				s.cloud.account = {
					name: "Tess Tester",
					email: "tess@example.com",
					userId: "u_tess",
					server: "https://app.sitegloss.dev",
					teams: [],
					teamId: undefined,
					expired: false,
				};
			}),
			actions,
		);
		const items = [
			...window.document.querySelectorAll("#case-thread li[data-comment]"),
		];
		// The case's own comment at the bottom, Tess's: Edit and Delete comment.
		expect(
			items.map((li) => li.querySelector(".comment-meta")?.textContent),
		).toEqual([expect.stringMatching(/^Tess Tester · /)]);
		expect(
			items[0]?.querySelector('[data-action="comment-delete"]')?.textContent,
		).toBe("Delete comment");
		expect(el("thread-heading").textContent).toBe("Comments 1");
		// A disclosure, open: the case has a comment (DEC-063); closed by a click.
		const toggle = () =>
			el("thread-heading").querySelector(
				"button",
			) as unknown as HTMLButtonElement;
		expect(toggle().getAttribute("aria-expanded")).toBe("true");
		expect(el("thread-body").hidden).toBe(false);
		toggle().click();
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		expect(el("thread-body").hidden).toBe(true);
		toggle().click();
		expect(el("thread-body").hidden).toBe(false);
		// The mark says it has a comment, and shows it, Dana's (none of Tess's tools).
		expect(
			window.document.querySelector("[data-mark] .comments-count")?.textContent,
		).toBe("1 comment");
		const atMark = window.document.querySelector('[data-mark-thread="m1"]');
		const there = [...(atMark?.querySelectorAll("li[data-comment]") ?? [])];
		expect(
			there.map((li) => li.querySelector(".comment-meta")?.textContent),
		).toEqual([expect.stringMatching(/^Dana Developer via Claude · /)]);
		expect(there[0]?.textContent).not.toContain("on mark");
		expect(
			there[0]?.querySelector('[data-action="comment-delete"]'),
		).toBeNull();
		// Add comment at the mark: a button that opens the box (DEC-063).
		expect(atMark?.querySelector("textarea") === null).toBe(true);
		(
			atMark?.querySelector('[data-action="mark-comment-open"]') as unknown as
				| HTMLButtonElement
				| undefined
		)?.click();
		const field = window.document.querySelector(
			'[data-mark-thread="m1"] textarea',
		) as unknown as HTMLTextAreaElement;
		await Promise.resolve();
		expect(window.document.activeElement === (field as unknown)).toBe(true);
		field.value = "Checked on staging";
		field.dispatchEvent(new window.Event("input") as unknown as Event);
		(
			window.document.querySelector(
				'[data-mark-thread="m1"] [data-action="mark-comment-add"]',
			) as unknown as HTMLButtonElement | undefined
		)?.click();
		expect(done).toEqual(["add Checked on staging m1"]);
	});

	test("a comment's text is laid out as written: paragraphs apart, list lines beside their marker, every character of every line kept and none read as markup", async () => {
		const { commentBlocks } = await import("../src/sidepanel/thread-view.ts");
		const laid = (text: string) =>
			commentBlocks(text).flatMap((b) =>
				b.getAttribute("role") === "list"
					? [...b.children].map((li) => `li:${li.textContent}`)
					: [`p:${b.textContent}`],
			);
		expect(
			laid(
				"Done: <b>24</b> of 25.\r\nSee https://shop.example/x  \n\n\n- one\n  - nested,  two  blanks\n* **not bold**\n\n1. first\n2)\tsecond\nlast line",
			),
		).toEqual([
			"p:Done: <b>24</b> of 25.\nSee https://shop.example/x  ",
			"li:- one",
			"li:  - nested,  two  blanks",
			"li:* **not bold**",
			"li:1. first",
			"li:2)\tsecond",
			"p:last line",
		]);
		// No list where none was written, and no element out of the text.
		expect(laid("1.5 km\n-5 degrees\n-\nA - B")).toEqual([
			"p:1.5 km\n-5 degrees\n-\nA - B",
		]);
		expect(
			commentBlocks("<b>x</b> [a](https://shop.example)").some(
				(b) => b.querySelector("b, a") !== null,
			),
		).toBe(false);
		// A long line of blanks costs no more than its length.
		const t = performance.now();
		commentBlocks(`- ${" ".repeat(20_000)}x\u2028`);
		expect(performance.now() - t).toBeLessThan(50);
	});

	test("a mark shows its last three comments, the earlier ones folded (as the web's markThread)", async () => {
		const { markThreadShown } = await import("../src/sidepanel/thread-view.ts");
		expect(markThreadShown([1, 2, 3, 4, 5], false)).toEqual({
			shown: [3, 4, 5],
			earlier: 2,
		});
		expect(markThreadShown([1, 2, 3, 4, 5], true)).toEqual({
			shown: [1, 2, 3, 4, 5],
			earlier: 0,
		});
		expect(markThreadShown([1], false)).toEqual({ shown: [1], earlier: 0 });
	});

	test("Close case and Reopen case; a closed case says who closed it, and is filed under Closed, folded", () => {
		const closed: boolean[] = [];
		const actions = actionsWith({
			setCaseClosed: (_c, value) => void closed.push(value),
		});
		const c = sampleCase("c_c");
		render(caseState(c), actions);
		expect(el("close-case").textContent).toBe("Close case");
		el<HTMLButtonElement>("close-case").click();
		expect(closed).toEqual([true]);
		const shut: Case = {
			...c,
			closed: {
				at: "2026-11-20T12:00:00.000Z",
				user: { id: "u_tess", name: "Tess Tester" },
				app: { id: "x", name: "Claude", host: "claude.ai" },
			},
		};
		render(caseState(shut), actions);
		expect(el("close-case").textContent).toBe("Reopen case");
		expect(el("case-closed").textContent).toMatch(
			/^Closed .* by Tess Tester via Claude\.$/,
		);
		// Home: the open case in the list, the closed one under Closed, folded.
		const state = initialState();
		state.cases = [sampleCase("c_open"), shut];
		render(state, actions);
		const group = el<HTMLDetailsElement>("closed-cases");
		expect(group.open).toBe(false);
		expect(group.querySelector("summary")?.textContent).toBe("Closed 1");
		expect(group.querySelectorAll("[data-case]")).toHaveLength(1);
		expect(
			window.document.querySelectorAll(
				'#cases > ul[data-group="other"] [data-case]',
			),
		).toHaveLength(1);
	});
});

describe("what stays between renders", () => {
	test("the open case's buttons stay the same elements", () => {
		const c = sampleCase("c_keep");
		render(caseState(c), noActions);
		const buttons = ["load-case", "add-marks", "export-case", "delete-case"];
		const drawn = buttons.map((id) => el(id));
		const same = () => buttons.every((id, i) => el(id) === drawn[i]);
		render(
			caseState(c, (s) => {
				s.deleteArmedAt = 1;
				s.caseHint = "3 of 5 marks found";
			}),
			noActions,
		);
		expect(same()).toBe(true);
		expect(el("delete-case").textContent).toBe("Really delete?");
		expect(el("delete-case").hasAttribute("data-armed")).toBe(true);
		expect(el("case-hint").textContent).toBe("3 of 5 marks found");
		expect(el("case-hint").hidden).toBe(false);
		render(caseState(c), noActions);
		expect(el("delete-case").textContent).toBe("Delete case");
		expect(el("delete-case").hasAttribute("data-armed")).toBe(false);
		expect(el("case-hint").hidden).toBe(true);
	});

	test("a button acts on the case as it is now, not as it was first drawn", () => {
		const c = sampleCase("c_now");
		const exported: Case[] = [];
		const actions = actionsWith({ exportCase: (x) => void exported.push(x) });
		render(caseState(c), actions);
		const newer = { ...c, title: "Newer", updatedAt: "2026-11-05T10:00:00Z" };
		render(caseState(newer), actions);
		el("export-case").click();
		expect(exported).toEqual([newer]);
	});

	test("the case list is drawn again only when it shows something else", () => {
		const state = initialState();
		state.cases = [sampleCase("c_a"), sampleCase("c_b")];
		render(state, noActions);
		const item = () => window.document.querySelector("[data-case]");
		const first = item();
		render(state, noActions);
		expect(item() === first).toBe(true);
		state.cases = [
			{ ...sampleCase("c_a"), updatedAt: "2026-11-05T10:00:00Z" },
			sampleCase("c_b"),
		];
		render(state, noActions);
		expect(item() === first).toBe(false);
	});

	test("the import prompt is drawn again only when it shows something else", () => {
		const existing = sampleCase("c_in");
		const state = initialState();
		state.importing = {
			parsed: { case: sampleCase("c_in"), images: async () => new Map() },
			existing,
		};
		render(state, noActions);
		const button = () =>
			window.document.querySelector('[data-action="import-replace"]');
		const first = button();
		expect(first === null).toBe(false);
		render(state, noActions);
		expect(button() === first).toBe(true);
		state.importing = {
			...state.importing,
			existing: { ...existing, updatedAt: "2026-11-05T10:00:00Z" },
		};
		render(state, noActions);
		expect(button() === first).toBe(false);
		state.importing = undefined;
		render(state, noActions);
		expect(button() === null).toBe(true);
		expect(el("import-prompt").hidden).toBe(true);
	});
});

describe("the summary for the developer", () => {
	const value = () => el<HTMLTextAreaElement>("verdict").value;

	test("is labelled so and says what it is for", () => {
		const c = { ...sampleCase("c_s"), verdict: "Darker button" };
		render(caseState(c), noActions);
		expect(
			window.document.querySelector('label[for="verdict"]')?.textContent,
		).toBe("Summary for the developer");
		// Help under the label, no placeholder (DEC-060).
		expect(el<HTMLTextAreaElement>("verdict").placeholder).toBe("");
		expect(el("verdict-help").textContent).toContain(
			"Whoever loads this case sees it first.",
		);
		// A comment box gets no placeholder (the owner, DEC-060).
		expect(el<HTMLTextAreaElement>("comment-new").placeholder).toBe("");
		expect(el("save-verdict").textContent).toBe("Save summary");
	});

	test("a case's card shows its start on one line; its name only says there is one", () => {
		const long = `Darker button\n\nand ${"more ".repeat(100)}`;
		const home = initialState();
		home.cases = [
			{ ...sampleCase("c_s"), verdict: long },
			{ ...sampleCase("c_none"), verdict: null },
		];
		render(home, noActions);
		const card = window.document.querySelector('[data-case="c_s"]');
		const line = card?.querySelector(".card-summary")?.textContent ?? "";
		expect(line.startsWith("Darker button and more")).toBe(true);
		expect(line.length).toBe(200);
		expect(card?.getAttribute("aria-label")).not.toContain("Darker");
		expect(card?.getAttribute("aria-label")).toEndWith(
			", with a summary for the developer",
		);
		const none = window.document.querySelector('[data-case="c_none"]');
		expect(none?.querySelector(".card-summary")).toBeNull();
		expect(none?.getAttribute("aria-label")).not.toContain("summary");
		// The summary is the case's content: right under its title, before
		// the facts (DEC-064).
		expect(
			card?.querySelector(".card-head")?.nextElementSibling?.className,
		).toBe("card-summary");
	});

	test("a case without marks has no band on its card (DEC-064)", () => {
		const home = initialState();
		home.cases = [
			{ ...sampleCase("c_empty"), marks: [] },
			withOneMark(sampleCase("c_one")),
		];
		render(home, noActions);
		const band = (id: string) =>
			window.document.querySelector(`[data-case="${id}"] > .progress.band`);
		expect(band("c_empty") === null).toBe(true);
		expect(band("c_one") === null).toBe(false);
	});

	test("a draft stays while the case changes, and comes back after leaving", () => {
		const c = sampleCase("c_v");
		const drafts = (s: PanelState) => s.verdictDrafts.set(c.id, "Typed");
		render(caseState(c, drafts), noActions);
		expect(value()).toBe("Typed");
		expect(el("verdict-status").textContent).toBe("Not saved yet");
		// Being typed in: the focus and the caret stay where they are.
		const field = el<HTMLTextAreaElement>("verdict");
		field.focus();
		field.setSelectionRange(2, 2);
		render(caseState({ ...c, verdict: "From the AI app" }, drafts), noActions);
		expect(value()).toBe("Typed");
		expect(window.document.activeElement).toBe(field as never);
		expect(field.selectionStart).toBe(2);
		render(initialState(), noActions);
		render(caseState(c, drafts), noActions);
		expect(value()).toBe("Typed");
	});

	test("without a draft it shows what is stored, whitespace or not", () => {
		const c = { ...sampleCase("c_w"), verdict: "abc" };
		const typed = (s: PanelState) => s.verdictDrafts.set(c.id, "abc\n");
		render(caseState(c, typed), noActions);
		expect(value()).toBe("abc\n");
		render(caseState(c), noActions);
		expect(value()).toBe("abc");
		render(caseState({ ...c, verdict: "From the AI app" }), noActions);
		expect(value()).toBe("From the AI app");
		expect(el("verdict-status").textContent).toBe("");
	});

	test("Save summary shows only while the text differs from what is stored", () => {
		const c = { ...sampleCase("c_sv"), verdict: "Stored" };
		render(caseState(c), noActions);
		expect(el("save-verdict").hidden).toBe(true);
		render(
			caseState(c, (s) => s.verdictDrafts.set(c.id, "Stored, and more")),
			noActions,
		);
		expect(el("save-verdict").hidden).toBe(false);
		expect(el("verdict-status").textContent).toBe("Not saved yet");
		// Saved: the draft is gone, "Saved" stays a moment without the button.
		render(
			caseState(c, (s) => (s.verdictStatus = "Saved")),
			noActions,
		);
		expect(el("save-verdict").hidden).toBe(true);
		expect(el("verdict-status").textContent).toBe("Saved");
	});

	test("typing tells the panel", () => {
		const c = sampleCase("c_t");
		const typed: string[] = [];
		const actions = actionsWith({
			typeVerdict: (_id, text) => void typed.push(text),
		});
		render(caseState(c), actions);
		const verdict = el<HTMLTextAreaElement>("verdict");
		verdict.value = "Hello";
		verdict.dispatchEvent(new window.Event("input") as unknown as Event);
		expect(typed).toEqual(["Hello"]);
	});
});

describe("an imported case", () => {
	test("says so in its header", () => {
		const c = {
			...sampleCase("c_i"),
			importedAt: "2026-11-05T09:00:00.000Z",
		};
		render(caseState(c), noActions);
		expect(el("case-origin").hidden).toBe(false);
		expect(el("case-origin").textContent).toContain("Imported from a file");
		// What came in with it is the file's: statuses and reopen notes too.
		expect(el("case-origin").textContent).toContain(
			"statuses and reopen notes, summary and findings are as the file says",
		);
		render(caseState(sampleCase("c_j")), noActions);
		expect(el("case-origin").hidden).toBe(true);
	});
});

describe("the AI app", () => {
	test("the question whether to keep AI access on: a status region, two plain answers, drawn once (DEC-059)", async () => {
		const { KEEP_ON_QUESTION, showKeepOnQuestion } = await import(
			"../src/sidepanel/ai.ts"
		);
		const box = el("keep-on-ask");
		// Always in the page, so what is put in it is said.
		expect(box.getAttribute("role")).toBe("status");
		// Right under Keep AI access on and its sentence.
		expect(
			box.previousElementSibling?.previousElementSibling?.querySelector(
				"#keep-on",
			),
		).not.toBeNull();
		const answers: boolean[] = [];
		const answer = (keep: boolean) => void answers.push(keep);
		showKeepOnQuestion(box, true, answer);
		expect(box.querySelector("p")?.textContent).toBe(KEEP_ON_QUESTION);
		const buttons = [...box.querySelectorAll("button")];
		expect(buttons.map((b) => b.textContent)).toEqual([
			"Keep it on",
			"Not now",
		]);
		// Neither is the view's amber button.
		expect(box.querySelector(".primary")).toBeNull();
		// A redraw while it is asked draws nothing anew (it would be said again).
		const first = box.firstElementChild;
		showKeepOnQuestion(box, true, answer);
		expect(box.firstElementChild).toBe(first);
		(
			box.querySelector('[data-answer="keep"]') as unknown as HTMLButtonElement
		).click();
		(
			box.querySelector(
				'[data-answer="not-now"]',
			) as unknown as HTMLButtonElement
		).click();
		expect(answers).toEqual([true, false]);
		// Taken away while one of its buttons has the focus: the focus goes
		// to the switch, not to the page's start.
		(
			box.querySelector(
				'[data-answer="not-now"]',
			) as unknown as HTMLButtonElement
		).focus();
		showKeepOnQuestion(box, false, answer, el("ai-switch"));
		expect(box.childElementCount).toBe(0);
		expect(window.document.activeElement === (el("ai-switch") as unknown)).toBe(
			true,
		);
		// The sentence it stands in for while asked is there to be hidden.
		expect(el("keep-on-note").textContent).toContain("AI access stays on");
	});

	const ai = (change: Partial<PanelState["ai"]>) => (s: PanelState) => {
		s.ai = { ...s.ai, ...change };
	};

	test("an app talking: the chip glows while its call runs and a moment after, its name unchanged (DEC-063)", async () => {
		const c = sampleCase("c_talk");
		const on = { active: true, connected: true, apps: 1 };
		const talking = () => "talking" in el("ai-button").dataset;
		// The real hold is seconds long (TALKING_AFTER_MS): not sat out here.
		const HOLD = 60;
		holdTalkingFor(HOLD);
		render(caseState(c, ai({ ...on, status: "Connected: Claude" })), noActions);
		expect(talking()).toBe(false);
		const name = () => el("ai-button").textContent;
		const before = name();
		render(
			caseState(c, ai({ ...on, status: "Connected: Claude", working: true })),
			noActions,
		);
		expect(talking()).toBe(true);
		expect(name()).toBe(before);
		render(
			caseState(c, ai({ ...on, status: "Connected: Claude", working: false })),
			noActions,
		);
		// A moment after the call: still on, then off.
		expect(talking()).toBe(true);
		await Bun.sleep(HOLD + 50);
		expect(talking()).toBe(false);
		// The connection drops while the glow is on: it goes at once, not a
		// moment after, beside a dot that is no longer green.
		render(
			caseState(c, ai({ ...on, status: "Connected: Claude", working: true })),
			noActions,
		);
		expect(talking()).toBe(true);
		render(
			caseState(
				c,
				ai({ active: true, connected: false, apps: 0, status: "Connecting" }),
			),
			noActions,
		);
		expect(talking()).toBe(false);
		// A call said to run on a connection that is gone: no glow (DEC-064's review).
		render(
			caseState(
				c,
				ai({
					active: false,
					connected: false,
					apps: 0,
					status: "Not connected",
					working: true,
				}),
			),
			noActions,
		);
		expect(talking()).toBe(false);
		// The hold as shipped, for whatever renders a talking chip after this.
		holdTalkingFor(TALKING_AFTER_MS);
	});

	test("its connection shows in the case view too; no Stop in the top bar, the pill leads to the switch (DEC-061)", () => {
		const c = sampleCase("c_ai");
		const on = { active: true, connected: true };
		render(
			caseState(c, ai({ ...on, status: "Connected: Claude", apps: 1 })),
			noActions,
		);
		expect(el("home").hidden).toBe(true);
		// What the user sees of it: the pill's label.
		expect(el("ai-label").closest("[hidden], .visually-hidden")).toBeNull();
		expect(el("ai-label").textContent).toBe("AI on · 1 app");
		// The whole sentence is the pill's name, for a screen reader.
		expect(el("ai-status").textContent).toBe("Connected: Claude");
		// The owner: Stop goes; the switch in the AI view stops AI access.
		expect(el("stop-ai")).toBeNull();
		expect(el("bar").querySelectorAll("button").length).toBe(2);
		expect(el("ai-switch").closest("label")?.title).toContain(
			"stops that at once",
		);
	});

	test("a problem is said in words without hovering: a red dot, its name in the pill, its sentence under the bar on every view (DEC-024)", () => {
		const c = sampleCase("c_problem");
		const seen = () => ({
			label: el("ai-label").textContent,
			dot: el("bar").dataset["ai"],
			line: el("ai-problem").hidden
				? undefined
				: el("ai-problem-text").textContent,
			title: el("ai-button").title,
		});
		const off = { connected: false, apps: 0, active: false };
		for (const [change, want] of [
			[
				// The panel's page in a tab.
				{
					...off,
					problem: "tab",
					status: "Open the side panel from the Sitegloss icon for AI access",
				},
				{
					label: "AI: side panel only",
					line: "Open the side panel from the Sitegloss icon for AI access.",
					title: "Open the side panel from the Sitegloss icon for AI access.",
				},
			],
			[
				// The extension was updated under an open panel.
				{
					...off,
					problem: "updated",
					status: "Sitegloss was updated: close and open this panel again.",
				},
				{
					label: "AI: reopen panel",
					line: "Sitegloss was updated: close and open this panel again.",
					title: "Sitegloss was updated: close and open this panel again.",
				},
			],
			[
				// The worker's connection could not start.
				{
					...off,
					problem: "unavailable",
					status: "AI access is not available: no storage",
				},
				{
					label: "AI unavailable",
					line: "AI access is not available: no storage.",
					title: "AI access is not available: no storage.",
				},
			],
			[
				// A connect that failed, or an address taken over.
				{
					...off,
					problem: "connection",
					status: "Not connected: Sitegloss's connection is in use elsewhere.",
				},
				{
					label: "AI problem",
					line: "Not connected: Sitegloss's connection is in use elsewhere.",
					title:
						"Not connected: Sitegloss's connection is in use elsewhere. Click for the AI app card.",
				},
			],
			[
				// Lost, and trying again by itself: still a problem, and Stop ends it.
				{
					...off,
					active: true,
					problem: "connection",
					status: "Connection lost, retrying…",
				},
				{
					label: "AI retrying…",
					line: "Connection lost, retrying…",
					title: "Connection lost, retrying… Click for the AI app card.",
				},
			],
		] as [Partial<PanelState["ai"]>, Record<string, string>][]) {
			// In a case, at home and in Settings alike.
			for (const state of [
				caseState(c, ai(change)),
				(() => {
					const s = initialState();
					ai(change)(s);
					return s;
				})(),
				caseState(c, (s) => {
					ai(change)(s);
					s.settings = true;
				}),
			]) {
				render(state, noActions);
				expect(seen()).toEqual({ ...want, dot: "problem" } as never);
				// Above the views, under the top bar.
				expect(el("ai-problem").previousElementSibling).toBe(el("bar"));
				expect(el("ai-problem").getAttribute("role")).toBe("status");
			}
		}
		// After an update the pill no longer says what was true before it.
		render(
			caseState(
				c,
				ai({
					status: "Connected: Claude",
					connected: true,
					apps: 1,
					active: true,
				}),
			),
			noActions,
		);
		expect(seen()).toMatchObject({ label: "AI on · 1 app", line: undefined });
		// The problem gone, the line goes.
		render(caseState(c), noActions);
		expect(seen()).toMatchObject({
			label: "AI off",
			dot: "off",
			line: undefined,
		});
	});

	test("its last call shows once there is one", () => {
		const c = sampleCase("c_call");
		render(caseState(c), noActions);
		expect(el("ai-call").hidden).toBe(true);
		const lastCall = { tool: "Screenshot", app: "claude.ai", at: 0 };
		render(caseState(c, ai({ lastCall })), noActions);
		expect(el("ai-call").hidden).toBe(false);
		expect(el("ai-call").textContent).toContain("Screenshot, by claude.ai");
	});

	test("the status at the top says what a click on it does", () => {
		render(caseState(sampleCase("c_b1")), noActions);
		// The status at the top is a button too.
		expect(el("ai-button").contains(el("ai-status"))).toBe(true);
		expect(el("ai-action").textContent).toBe("Turn on");
		render(caseState(sampleCase("c_b1"), ai({ connected: true })), noActions);
		expect(el("ai-action").textContent).toBe("Manage");
	});

	test("the pill: a few words, a dot in the state's colour, and the rest in its name and tooltip (DEC-024)", () => {
		const c = sampleCase("c_pill");
		const pill = () => [
			el("ai-label").textContent,
			el("bar").dataset["ai"],
			el("ai-button").title,
		];
		render(caseState(c), noActions);
		expect(pill()).toEqual([
			"AI off",
			"off",
			expect.stringContaining("turn it on"),
		]);
		// The whole status stays in the button, for a screen reader.
		expect(el("ai-status").textContent).toBe("Not connected");
		expect(el("ai-status").classList.contains("visually-hidden")).toBe(true);
		render(
			caseState(
				c,
				ai({
					status: "Waiting for an AI app to pair",
					connected: true,
					active: true,
				}),
			),
			noActions,
		);
		expect(pill()).toEqual([
			"AI on, no app yet",
			"waiting",
			expect.stringContaining("address and code"),
		]);
		const on = (apps: number, status: string) =>
			caseState(c, ai({ status, connected: true, active: true, apps }));
		render(on(1, "Connected: Claude"), noActions);
		expect(pill()).toEqual([
			"AI on · 1 app",
			"connected",
			expect.stringContaining("manage it"),
		]);
		render(on(2, "Connected: Claude, ChatGPT"), noActions);
		expect(pill()).toEqual([
			"AI on · 2 apps",
			"connected",
			expect.stringContaining("manage them"),
		]);
		render(
			caseState(c, ai({ status: "Connecting…", active: true })),
			noActions,
		);
		expect(pill()).toEqual([
			"AI connecting…",
			"waiting",
			expect.stringContaining("Click for the AI app card"),
		]);
		// Healthy in each of these: nothing is said under the bar.
		expect(el("ai-problem").hidden).toBe(true);
		expect(el("ai-problem-text").textContent).toBe("");
	});
});

describe("settings and errors at home", () => {
	test("Allow on all sites shows the permission, not the last click", () => {
		const box = el<HTMLInputElement>("all-sites");
		const state = initialState();
		box.checked = true; // the click, and Chrome said no
		render(state, noActions);
		expect(box.checked).toBe(false);
		state.allSites = true;
		render(state, noActions);
		expect(box.checked).toBe(true);
	});

	test("Keep AI access on shows the setting, also after Stop AI access", () => {
		const box = el<HTMLInputElement>("keep-on");
		const state = initialState();
		state.ai.keepOn = true;
		render(state, noActions);
		expect(box.checked).toBe(true);
		state.ai.keepOn = false;
		render(state, noActions);
		expect(box.checked).toBe(false);
	});

	test("an import error has its own place and can stay", () => {
		const state = initialState();
		state.importError = "Could not import x.zip: broken";
		render(state, noActions);
		expect(el("import-error").hidden).toBe(false);
		expect(el("import-error-text").textContent).toContain("broken");
		expect(el("hint").textContent).not.toContain("broken");
		state.importError = undefined;
		render(state, noActions);
		expect(el("import-error").hidden).toBe(true);
	});
});

describe("the New case button (DEC-023, DEC-026)", () => {
	const c = sampleCase();
	const overlay = (
		change: Partial<NonNullable<PanelState["overlay"]>> = {},
	): NonNullable<PanelState["overlay"]> => ({
		visible: false,
		url: "https://example.com/",
		title: "",
		drafts: 0,
		saving: false,
		...change,
	});
	const home = (o: PanelState["overlay"], cases: Case[] = [c]) => {
		const state = initialState();
		state.tab = {
			id: 1,
			url: "https://example.com/",
			title: "",
			size: undefined,
		};
		state.overlay = o;
		state.cases = cases;
		render(state, noActions);
		const button = el<HTMLButtonElement>("new-case");
		return {
			label: button.textContent,
			primary: button.classList.contains("primary"),
			disabled: button.disabled,
		};
	};

	test("one state: New case for this page, the one primary, whatever the page shows", () => {
		const target = { caseId: c.id, title: c.title, nextMark: 2 };
		for (const o of [
			undefined,
			overlay(),
			overlay({ drafts: 3 }),
			overlay({ visible: true }),
			overlay({ visible: true, drafts: 2, saving: true }),
			overlay({ target }),
			overlay({ target, visible: true, drafts: 1 }),
		])
			expect(home(o)).toEqual({
				label: "New case for this page",
				primary: true,
				disabled: false,
			});
		expect(home(overlay({ target }), []).label).toBe("New case for this page");
	});

	test("a page that has a case: Home says so and offers to open it; a new case steps back", () => {
		const opened: string[] = [];
		const actions = actionsWith({ openCase: (id) => void opened.push(id) });
		const at = (url: string, cases: Case[]) => {
			const state = initialState();
			state.tab = { id: 1, url, title: "", size: undefined };
			state.cases = cases;
			render(state, actions);
		};
		const own = { ...c, id: "c_own", title: "The form" };
		const second = { ...c, id: "c_second", title: "The footer" };
		const elsewhere: Case = {
			...c,
			id: "c_else",
			title: "Elsewhere",
			page: { ...c.page, url: "https://example.com/other" },
		};
		const rows = (group: string) =>
			[
				...window.document.querySelectorAll(
					`ul.cases[data-group="${group}"] [data-case]`,
				),
			].map((b) => b.getAttribute("data-case"));
		const primary = (id: string) => el(id).classList.contains("primary");

		// No case for the page: as before, the new case is the one primary.
		at("https://example.com/none", [own, elsewhere]);
		expect(el("here").hidden).toBe(true);
		expect(primary("new-case")).toBe(true);
		expect(el("cases-heading").textContent).toBe("Cases");
		expect(rows("other")).toEqual(["c_own", "c_else"]);

		// One: said in words, its row under This page, and Open this case is
		// the one amber button.
		at(c.page.url, [own, elsewhere]);
		expect(el("here").hidden).toBe(false);
		expect(el("here-text").textContent).toContain("already has a case");
		expect(rows("here")).toEqual(["c_own"]);
		expect(el("here").contains(el("open-here") as never)).toBe(true);
		expect(el("open-here").hidden).toBe(false);
		expect(primary("open-here")).toBe(true);
		expect(primary("new-case")).toBe(false);
		expect(el("new-case").textContent).toBe("New case for this page");
		// The list below holds the others, and says so.
		expect(el("cases-heading").textContent).toBe("Other cases");
		expect(rows("other")).toEqual(["c_else"]);
		el("open-here").click();
		expect(opened).toEqual(["c_own"]);

		// Several: each row opens its case, no button picks one of them.
		at(c.page.url, [own, second, elsewhere]);
		expect(el("here-text").textContent).toContain("already has 2 cases");
		expect(rows("here")).toEqual(["c_own", "c_second"]);
		expect(el("open-here").hidden).toBe(true);
		expect(primary("new-case")).toBe(false);

		// Every case is the page's: the list below says there are no others.
		at(c.page.url, [own]);
		expect(window.document.querySelector("#cases .empty")?.textContent).toBe(
			"No cases for other pages.",
		);
		// Back on a page without one.
		at("https://example.com/none", [own]);
		expect(el("here").hidden).toBe(true);
		expect(el("open-here").hidden).toBe(true);
		expect(primary("new-case")).toBe(true);
	});

	test("no hint lines for drafts: there are no drafts (DEC-026)", () => {
		home(overlay({ visible: true, drafts: 3 }));
		expect(el("hint").hidden).toBe(true);
	});
});

describe("a case deleted elsewhere while its toolbar was adding (DEC-026)", () => {
	test("says only what was lost", async () => {
		const { lostMarksText } = await import("../src/sidepanel/view.ts");
		expect(lostMarksText("Login", 1)).toBe(
			"“Login” was deleted, and 1 mark not in it yet is gone with it.",
		);
		expect(lostMarksText(undefined, 3)).toBe(
			"The case was deleted, and 3 marks not in it yet are gone with it.",
		);
	});
});

describe("the title is renamed where it is shown (DEC-026)", () => {
	const c = sampleCase("c_rename");
	const renaming = (text: string, error?: string) =>
		caseState(c, (s) => {
			s.renaming = {
				caseId: c.id,
				text,
				...(error === undefined ? {} : { error }),
			};
		});
	const shown = (id: string) => !el(id).hidden;

	test("the title with a quiet … menu beside it: Rename… there (DEC-061)", () => {
		const called: string[] = [];
		render(
			caseState(c),
			actionsWith({ startRename: (x) => void called.push(x.id) }),
		);
		// Made with these actions: the first render of this case.
		expect(el("case-view").querySelector(".case-title")?.textContent).toBe(
			"Button contrast",
		);
		const more = el<HTMLButtonElement>("case-more");
		expect(more.getAttribute("aria-label")).toBe("More actions on this case");
		expect(more.getAttribute("aria-expanded")).toBe("false");
		expect(el("case-menu").hidden).toBe(true);
		more.click();
		expect(el("case-menu").hidden).toBe(false);
		expect(more.getAttribute("aria-expanded")).toBe("true");
		const items = [...el("case-menu").querySelectorAll("[role=menuitem]")].map(
			(b) => b.textContent,
		);
		expect(items).toEqual(["Rename…", "Add a link…", "Export…", "Delete case"]);
		const button = el<HTMLButtonElement>("rename-case");
		expect(shown("rename")).toBe(false);
		button.click();
		expect(called).toEqual(["c_rename"]);
		// An item closes the menu.
		expect(el("case-menu").hidden).toBe(true);
	});

	test("renaming: a field with the title and its name, Save and Cancel; the title row goes", () => {
		render(renaming("Button contrast"), noActions);
		expect(shown("rename")).toBe(true);
		expect(
			el("case-view").querySelector<HTMLElement>(".case-title-row")?.hidden,
		).toBe(true);
		const field = el<HTMLInputElement>("rename-field");
		expect(field.value).toBe("Button contrast");
		expect(field.getAttribute("aria-label")).toBe("Case title");
		expect(field.maxLength).toBe(500);
		expect(el<HTMLButtonElement>("rename-save").disabled).toBe(false);
		expect(shown("rename-hint")).toBe(false);
	});

	test("an empty title is refused: Save off, and the field says why", () => {
		render(renaming("   "), noActions);
		expect(el<HTMLButtonElement>("rename-save").disabled).toBe(true);
		expect(el("rename-field").getAttribute("aria-invalid")).toBe("true");
		expect(shown("rename-hint")).toBe(true);
		expect(el("rename-hint").textContent).toBe("A case needs a title.");
	});

	test("a save that failed says why under the field", () => {
		render(
			renaming("Login", "Not renamed: the case no longer exists"),
			noActions,
		);
		expect(el("rename-hint").textContent).toBe(
			"Not renamed: the case no longer exists",
		);
		expect(el("rename-field").getAttribute("aria-invalid")).toBe("false");
	});

	test("done: the stored title shows, the … menu's button has the focus again", async () => {
		render(renaming("Login"), noActions);
		await Promise.resolve();
		expect(window.document.activeElement?.id).toBe("rename-field");
		render(caseState({ ...c, title: "Login" }), noActions);
		await Promise.resolve();
		expect(shown("rename")).toBe(false);
		expect(el("case-view").querySelector(".case-title")?.textContent).toBe(
			"Login",
		);
		expect(window.document.activeElement?.id).toBe("case-more");
	});
});

describe("a case's link (DEC-028)", () => {
	const TICKET = "https://tickets.example.com/browse/ABC-123?focused=1";
	const shown = (id: string) => !el(id).hidden;
	const open = () => el<HTMLAnchorElement>("case-link-open");
	const edit = () => el<HTMLButtonElement>("case-link-edit");

	test("no link: only a quiet Add a link, in the facts' Link row", () => {
		const c = sampleCase("c_link_none");
		const called: string[] = [];
		render(
			caseState(c),
			actionsWith({ startLink: (x) => void called.push(x.id) }),
		);
		// Its row in the facts, labelled (DEC-061).
		expect(
			el("case-link").closest(".fact")?.querySelector("dt")?.textContent,
		).toBe("Link");
		expect(shown("case-link-open")).toBe(false);
		expect(edit().textContent).toBe("Add a link");
		expect(edit().className).toContain("link");
		expect(shown("case-link-form")).toBe(false);
		edit().click();
		expect(called).toEqual(["c_link_none"]);
	});

	test("a link: an anchor to it in a new tab, its short text, and Edit", () => {
		const c = { ...sampleCase("c_link_one"), link: TICKET };
		render(caseState(c), noActions);
		expect(shown("case-link-open")).toBe(true);
		expect(open().getAttribute("href")).toBe(TICKET);
		expect(open().getAttribute("target")).toBe("_blank");
		expect(open().getAttribute("rel")).toBe("noopener noreferrer");
		expect(open().textContent).toBe("tickets.example.com/browse/ABC-123");
		expect(open().title).toBe(TICKET);
		expect(edit().textContent).toBe("Edit");
		// Removed again: Add a link, no address left in the anchor.
		render(caseState({ ...sampleCase("c_link_one") }), noActions);
		expect(shown("case-link-open")).toBe(false);
		expect(open().hasAttribute("href")).toBe(false);
		expect(edit().textContent).toBe("Add a link");
	});

	test("editing: the field with the stored link", () => {
		const c = { ...sampleCase("c_link_keys"), link: TICKET };
		render(
			caseState(c, (s) => {
				s.linking = { caseId: c.id, text: TICKET };
			}),
			noActions,
		);
		const field = el<HTMLInputElement>("case-link-field");
		expect(shown("case-link-form")).toBe(true);
		expect(shown("case-link-open")).toBe(false);
		expect(shown("case-link-edit")).toBe(false);
		expect(field.value).toBe(TICKET);
		expect(field.type).toBe("url");
		expect(field.getAttribute("aria-label")).toBe("Link of this case");
		// Only the address's form (DEC-060).
		expect(field.placeholder).toBe("https://…");
		expect(shown("case-link-hint")).toBe(false);
	});

	test("a text that is no link, or a save that failed, says why under the field", () => {
		const c = sampleCase("c_link_error");
		render(
			caseState(c, (s) => {
				s.linking = {
					caseId: c.id,
					text: "ABC-123",
					error: "A link starts with https:// or http://",
				};
			}),
			noActions,
		);
		expect(shown("case-link-hint")).toBe(true);
		expect(el("case-link-hint").textContent).toBe(
			"A link starts with https:// or http://",
		);
		expect(el("case-link-field").getAttribute("aria-invalid")).toBe("true");
	});

	test("done: the link shows, Edit has the focus again", async () => {
		const c = sampleCase("c_link_done");
		render(
			caseState(c, (s) => {
				s.linking = { caseId: c.id, text: "" };
			}),
			noActions,
		);
		await Promise.resolve();
		expect(window.document.activeElement?.id).toBe("case-link-field");
		render(caseState({ ...c, link: TICKET }), noActions);
		await Promise.resolve();
		expect(shown("case-link-form")).toBe(false);
		expect(open().getAttribute("href")).toBe(TICKET);
		expect(window.document.activeElement?.id).toBe("case-link-edit");
	});
});

// The rename and link forms are one pattern: the same keys, the same ownership.
describe.each([
	{
		form: "rename",
		state: "renaming",
		field: "rename-field",
		save: "rename-save",
		cancel: "rename-cancel",
		edit: "rename-case",
		saveAction: "saveRename",
		cancelAction: "cancelRename",
		typeAction: "typeRename",
	},
	{
		form: "link",
		state: "linking",
		field: "case-link-field",
		save: "case-link-save",
		cancel: "case-link-cancel",
		edit: "case-link-edit",
		saveAction: "saveLink",
		cancelAction: "cancelLink",
		typeAction: "typeLink",
	},
] as const)("the $form form of a case", (f) => {
	const open = (c: Case, caseId: string, actions: Actions = noActions) =>
		render(
			caseState(c, (s) => {
				s[f.state] = { caseId, text: "Login" };
			}),
			actions,
		);

	test("Enter saves what is typed, Escape cancels, as the buttons do", () => {
		const called: string[] = [];
		// The case's parts keep the actions they were made with: a case of its own.
		const c = sampleCase(`c_${f.form}_keys`);
		open(
			c,
			c.id,
			actionsWith({
				[f.saveAction]: (_c: unknown, text: string) =>
					void called.push(`save ${text}`),
				[f.cancelAction]: () => void called.push("cancel"),
				[f.typeAction]: (text: string) => void called.push(`type ${text}`),
			}),
		);
		const field = el<HTMLInputElement>(f.field);
		field.value = "Login button";
		field.dispatchEvent(new window.Event("input") as unknown as Event);
		const key = (k: string, more: Record<string, unknown> = {}) =>
			field.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: k,
					cancelable: true,
					...more,
				}) as unknown as Event,
			);
		// The Enter that ends an IME composition is the composition's.
		key("Enter", { isComposing: true });
		key("Enter", { keyCode: 229 });
		key("Enter");
		key("Escape");
		el<HTMLButtonElement>(f.save).click();
		el<HTMLButtonElement>(f.cancel).click();
		expect(called).toEqual([
			"type Login button",
			"save Login button",
			"cancel",
			"save Login button",
			"cancel",
		]);
	});

	test("another case's form is not this one's", () => {
		open(sampleCase(`c_${f.form}_other`), "c_other");
		expect(el(f.field).closest("[hidden]")).not.toBeNull();
		expect(el(f.edit).hidden).toBe(false);
	});
});

describe("the top bar and Settings (DEC-023)", () => {
	test("Home: no back button; a case: All cases with a chevron, which closes it", () => {
		const called: string[] = [];
		const actions = actionsWith({
			closeCase: () => void called.push("close"),
		});
		render(initialState(), actions);
		expect(el("back").hidden).toBe(true);
		render(caseState(sampleCase("c_top")), actions);
		expect(el("back").hidden).toBe(false);
		expect(el("back").textContent).toBe("All cases");
		expect(el("back").querySelector("svg[aria-hidden=true]")).not.toBeNull();
		expect(el("back").getAttribute("aria-label")).toBe(
			"All cases: close this case",
		);
		// In the top bar, before the AI pill.
		expect(el("back").parentElement).toBe(el("bar"));
		expect(el("back").nextElementSibling).toBe(el("ai-button"));
		el("back").click();
		expect(called).toEqual(["close"]);
	});

	test("a double click on the back button is one click: it changed its meaning under the pointer", () => {
		const called: string[] = [];
		const actions = actionsWith({
			closeSettings: () => void called.push("settings"),
			closeCase: () => void called.push("case"),
		});
		const c = sampleCase("c_double");
		try {
			setSystemTime(new Date("2020-01-01T10:00:00Z"));
			render(
				caseState(c, (s) => (s.settings = true)),
				actions,
			);
			setSystemTime(new Date("2020-01-01T10:00:05Z"));
			el("back").click();
			// Settings closes: the same button is "← All cases" now.
			render(caseState(c), actions);
			setSystemTime(new Date("2020-01-01T10:00:05.200Z"));
			el("back").click();
			expect(called).toEqual(["settings"]);
			setSystemTime(new Date("2020-01-01T10:00:06Z"));
			el("back").click();
			expect(called).toEqual(["settings", "case"]);
			// Blocked a moment after the first click: the second is no decision.
			render(
				caseState(c, (s) => (s.leaving = { phase: "blocked", left: 1 })),
				actions,
			);
			setSystemTime(new Date("2020-01-01T10:00:06.100Z"));
			el("back").click();
			expect(called).toEqual(["settings", "case"]);
		} finally {
			setSystemTime();
		}
	});

	test("while the toolbar finishes, the back button waits and the case says so", () => {
		const c = sampleCase("c_leave");
		render(
			caseState(c, (s) => (s.leaving = { phase: "finishing" })),
			noActions,
		);
		expect(el<HTMLButtonElement>("back").disabled).toBe(true);
		expect(el("leave-hint").textContent).toBe("Finishing the marks…");
		render(
			caseState(c, (s) => (s.leaving = { phase: "blocked", left: 1 })),
			noActions,
		);
		expect(el<HTMLButtonElement>("back").disabled).toBe(false);
		expect(el("leave-hint").textContent).toBe(
			"1 mark is not in the case yet; the toolbar on the page says why. Click All cases again to leave without it.",
		);
		render(caseState(c), noActions);
		expect(el("leave-hint").hidden).toBe(true);
	});

	test("Settings holds the AI app card and the options, over Home or a case", () => {
		const called: string[] = [];
		const actions = actionsWith({
			closeSettings: () => void called.push("back"),
			closeCase: () => void called.push("close"),
		});
		expect(el("ai-card").closest("main")).toBe(el("settings"));
		expect(el("all-sites").closest("main")).toBe(el("settings"));
		expect(el("blur-forms").closest("main")).toBe(el("settings"));
		const c = sampleCase("c_set");
		render(
			caseState(c, (s) => (s.settings = true)),
			actions,
		);
		expect(el("settings").hidden).toBe(false);
		expect(el("case-view").hidden).toBe(true);
		expect(el("home").hidden).toBe(true);
		expect(el("back").textContent).toBe("Back");
		el("back").click();
		expect(called).toEqual(["back"]);
		// The case stays open underneath: its view is there when Back returns.
		expect(el("case-view").querySelector("h2")?.textContent).toBe(c.title);
		render(caseState(c), actions);
		expect(el("settings").hidden).toBe(true);
		expect(el("case-view").hidden).toBe(false);
		const home = initialState();
		home.settings = true;
		render(home, actions);
		expect(el("home").hidden).toBe(true);
		expect(el("back").textContent).toBe("Back");
		home.settings = false;
		render(home, actions);
		expect(el("settings").hidden).toBe(true);
		expect(el("home").hidden).toBe(false);
	});
});

describe("the case view's actions and this tab (DEC-023)", () => {
	const tab = {
		id: 7,
		url: "http://127.0.0.1/v2",
		title: "",
		size: undefined,
	};
	const overlay = (
		change: Partial<NonNullable<PanelState["overlay"]>> = {},
	): NonNullable<PanelState["overlay"]> => ({
		visible: false,
		url: tab.url,
		title: "",
		drafts: 0,
		saving: false,
		...change,
	});
	const line = () =>
		el("tab-line").hidden ? undefined : el("tab-line").textContent;

	test("Add marks and Show marks in the case's tool bar at the bottom; Export and Delete case in the … menu (DEC-061, DEC-063)", () => {
		const c = sampleCase("c_row");
		render(
			caseState(c, (s) => (s.tab = tab)),
			noActions,
		);
		const dock = el("case-dock");
		// The last thing in the case's view: sticky, it rests after the content.
		expect(dock.parentElement?.lastElementChild === dock).toBe(true);
		expect(dock.getAttribute("role")).toBe("toolbar");
		expect([...dock.querySelectorAll("button")].map((b) => b.id)).toEqual([
			"add-marks",
			"load-case",
		]);
		expect(el("case-view").querySelectorAll("#add-marks").length).toBe(1);
		// Calm at rest (DEC-064): the secondary look, amber only while adding.
		expect(el("add-marks").classList.contains("primary")).toBe(false);
		expect(el("add-marks").textContent).toBe("Add marks");
		for (const id of ["export-case", "delete-case"])
			expect(el(id).closest("[role=menu]")?.id).toBe("case-menu");
		// No amber at rest: none of the case's view is loud (DEC-064).
		expect(window.document.querySelectorAll("#case-view .primary").length).toBe(
			0,
		);
		// No second Add marks under the list: the bar is always in reach.
		render(
			caseState(withOneMark(sampleCase("c_row_end")), (s) => (s.tab = tab)),
			noActions,
		);
		expect(window.document.getElementById("add-marks-end") === null).toBe(true);
		expect(window.document.querySelectorAll("#add-marks").length).toBe(1);
	});

	test("adding: Adding marks: Done, and the line says where the marks go", () => {
		const c = sampleCase("c_adding");
		const called: string[] = [];
		const actions = actionsWith({
			addMarks: () => void called.push("add"),
			doneAdding: () => void called.push("done"),
		});
		render(
			caseState(c, (s) => (s.tab = tab)),
			actions,
		);
		el("add-marks").click();
		const target = { caseId: c.id, title: c.title, nextMark: 2 };
		render(
			caseState(c, (s) => {
				s.tab = tab;
				s.overlay = overlay({ visible: true, target });
			}),
			actions,
		);
		expect(el("add-marks").textContent).toBe("Adding marks: Done");
		expect(el("add-marks").classList.contains("primary")).toBe(true);
		// The words say it; no "pressed" beside "Done" (DEC-064's review).
		expect(el("add-marks").hasAttribute("aria-pressed")).toBe(false);
		expect(line()).toContain("Adding marks: draw on the page");
		el("add-marks").click();
		expect(called).toEqual(["add", "done"]);
		// A toolbar for another case is not this case's.
		render(
			caseState(c, (s) => {
				s.tab = tab;
				s.overlay = overlay({
					visible: true,
					target: { ...target, caseId: "c_other" },
				});
			}),
			actions,
		);
		expect(el("add-marks").textContent).toBe("Add marks");
	});

	test("marks of no case on the page are no case's: nothing said (DEC-026)", () => {
		const c = sampleCase("c_drafts");
		render(
			caseState(c, (s) => {
				s.tab = tab;
				s.overlay = overlay({ drafts: 3 });
			}),
			noActions,
		);
		expect(line()).toBeUndefined();
	});

	test("drawing, hidden, found: each says so, Hide or Show where it applies", () => {
		// With a mark: a case without one has nothing to show or hide.
		const c: Case = {
			...sampleCase("c_tabline"),
			marks: [
				{
					id: "m1",
					number: 1,
					shot: "s1",
					comment: "Here",
					author: "user",
					shape: { kind: "note", at: { x: 1, y: 1 } },
					crop: "crops/m1.webp",
					element: null,
				},
			],
		};
		render(
			caseState(c, (s) => {
				s.tab = tab;
				s.drawing = tab.id;
			}),
			noActions,
		);
		expect(line()).toBe("Looking for the marks on this tab…");
		expect(el("load-case").hidden).toBe(true);
		render(
			caseState(c, (s) => {
				s.tab = tab;
				s.hiddenOn = new Set([tab.id]);
			}),
			noActions,
		);
		expect(line()).toBe("Marks are hidden on this tab.");
		expect(el("load-case").hidden).toBe(false);
		expect(el("load-case").textContent).toBe("Show marks");
		// A case without marks has nothing to show or hide: no button, also
		// while the toolbar adds to it.
		const empty = { ...c, id: "c_empty", marks: [] };
		render(
			caseState(empty, (s) => {
				s.tab = tab;
			}),
			noActions,
		);
		expect(el("load-case").hidden).toBe(true);
		render(
			caseState(c, (s) => {
				s.tab = tab;
				s.loaded = {
					caseId: c.id,
					tabId: tab.id,
					matches: new Map(),
					url: tab.url,
				};
				s.caseHint = "3 of 4 marks found on 127.0.0.1/v2.";
			}),
			noActions,
		);
		expect(line()).toBeUndefined();
		expect(el("case-hint").textContent).toBe(
			"3 of 4 marks found on 127.0.0.1/v2.",
		);
		expect(el("case-hint").parentElement).toBe(el("this-tab"));
		expect(el("load-case").textContent).toBe("Hide marks");
	});

	test("the facts: one quiet block of label and value, the counts under the title (DEC-061)", () => {
		const c = withOneMark(sampleCase("c_meta"));
		render(caseState(c), noActions);
		const facts = [...el("case-facts").querySelectorAll(".fact")]
			.filter((f) => !(f as unknown as HTMLElement).hidden)
			.map((f) => {
				// The label as shown; one page is a fact, several a list (DEC-065).
				const dt = f.querySelector("dt");
				const shown = [...(dt?.children ?? [])].filter(
					(x) => !(x as unknown as HTMLElement).hidden,
				);
				return [
					shown.length > 0
						? shown.map((x) => x.textContent).join("")
						: dt?.textContent,
					f.querySelector("dd")?.textContent,
				];
			});
		// A case of one page: its site beside its address (DEC-067).
		expect(facts.map(([label]) => label)).toEqual([
			"Page",
			"Site",
			"Link",
			"Made at",
		]);
		expect(el("case-pages-section").hidden).toBe(true);
		expect(facts[0]?.[1]).toContain("www.example.com/kk");
		expect(facts[1]?.[1]).toBe("example.com");
		expect(facts[3]?.[1]).toContain(
			`${c.page.viewport.width}×${c.page.viewport.height}, `,
		);
		expect(el("case-counts").textContent).toBe("1 mark: 1 open");
		// A size that matters offers Match size; a few pixels do not.
		const sized = (w: number, hgt: number) =>
			caseState(c, (s) => {
				s.tab = { id: 1, url: "", title: "", size: { width: w, height: hgt } };
			});
		render(
			sized(c.page.viewport.width - 20, c.page.viewport.height),
			noActions,
		);
		expect(el("case-size").hidden).toBe(true);
		render(
			sized(c.page.viewport.width - 30, c.page.viewport.height),
			noActions,
		);
		expect(el("case-size").hidden).toBe(false);
	});
});

describe("a loaded mark", () => {
	const element = {
		tag: "button",
		classes: [],
		attributes: {},
		ancestors: [],
		rect: { x: 0, y: 0, width: 100, height: 20 },
		page: { width: 1280, height: 800 },
		selector: "button",
		text: "Berechnen",
	};
	const mark = {
		id: "m1",
		number: 1,
		shot: "s1",
		comment: "Too pale",
		author: "user",
		shape: { kind: "element", rect: element.rect },
		crop: "crops/m1.webp",
		element,
	} as Mark;
	const shownAs = (summary: string, visible = true, current = 0) =>
		caseState({ ...sampleCase("c_m"), marks: [mark] }, (s) => {
			s.loaded = {
				caseId: "c_m",
				tabId: 1,
				url: "https://www.example.com/kk",
				matches: new Map([
					[
						"m1",
						{
							markId: "m1",
							number: 1,
							status: "found",
							score: 1,
							current,
							candidates: [
								{ score: 1, summary, selector: "b", visible, found: true },
								{ score: 0.6, summary, selector: "c", visible, found: false },
							],
						},
					],
				]),
			};
		});
	const said = () =>
		document.querySelector(".match .meta")?.textContent ?? undefined;

	test("a sure match offers no other candidate, unless one is shown", () => {
		const next = () => document.querySelector("[data-action=next]");
		render(shownAs("button"), noActions);
		expect(next()).toBeNull();
		// Stepped to the second: the way back stays.
		render(shownAs("button", true, 1), noActions);
		expect(next()).not.toBeNull();
	});

	const colour = () =>
		document.querySelector<HTMLElement>(".mark")?.dataset["colour"];

	test("another candidate, not sure enough, is unsure on both", () => {
		render(shownAs(summarize(element), true, 1), noActions);
		expect(colour()).toBe("unsure");
		expect(document.querySelector(".match")?.className).toContain("unsure");
	});

	test("the pin: its colour is the status, its fill the match (DEC-024)", async () => {
		const at = "2026-11-14T09:00:00Z";
		const marks: Mark[] = [
			{ ...mark, id: "m1", number: 1 },
			{ ...mark, id: "m2", number: 2, resolution: { kind: "fixed", at } },
			{
				...mark,
				id: "m3",
				number: 3,
				resolution: { kind: "fixed", at, verified: { at } },
			},
			{ ...mark, id: "m4", number: 4, resolution: { kind: "wontfix", at } },
		];
		const candidate = (found: boolean) => ({
			score: found ? 1 : 0.6,
			summary: "button",
			selector: "b",
			visible: true,
			found,
		});
		const match = (
			n: number,
			status: MarkMatch["status"],
			candidates: ReturnType<typeof candidate>[],
		): [string, MarkMatch] => [
			`m${n}`,
			{
				markId: `m${n}`,
				number: n,
				status,
				score: candidates[0]?.score ?? 0,
				current: 0,
				candidates,
			},
		];
		render(
			caseState({ ...sampleCase("c_pin"), marks: marks }, (s) => {
				s.loaded = {
					caseId: "c_pin",
					tabId: 1,
					url: "https://www.example.com/kk",
					matches: new Map([
						match(1, "found", [candidate(true)]),
						match(2, "probable", [candidate(false)]),
						match(3, "lost", []),
						// The fourth mark was not looked for: no match at all.
					]),
				};
			}),
			noActions,
		);
		const pins = [...document.querySelectorAll<HTMLElement>(".mark")].map(
			(li) => [
				li.querySelector(".number")?.textContent,
				li.dataset["status"],
				li.dataset["colour"],
			],
		);
		expect(pins).toEqual([
			["1", "open", "found"],
			["2", "fixed", "unsure"],
			["3", "verified", "lost"],
			["4", "wontfix", undefined],
		]);
		// The style sheet turns the two into the pin's look.
		const css = await Bun.file(
			new URL("../src/sidepanel/style.css", import.meta.url),
		).text();
		const rule = (selector: string) => {
			const from = css.indexOf(`${selector} {`);
			expect(from).toBeGreaterThanOrEqual(0);
			return css.slice(from, css.indexOf("}", from)).replace(/\s+/g, " ");
		};
		for (const [selector, tone] of [
			['[data-status="open"],\n[data-group="open"]', "--st-open"],
			['[data-status="fixed"],\n[data-group="toVerify"]', "--st-verify"],
			['[data-status="verified"],\n[data-group="verified"]', "--st-verified"],
			[
				'[data-status="wontfix"],\n[data-status="cantreproduce"],\n[data-group="dismissed"]',
				"--st-dismissed",
			],
		] as const)
			expect(rule(selector)).toContain(`--tone: var(${tone});`);
		// Found, or not looked for: filled, with a ring of paper on the rail.
		expect(rule(".number")).toContain(
			"background: var(--tone, var(--st-open));",
		);
		expect(rule(".number")).toContain("box-shadow: 0 0 0 2px var(--paper);");
		// Unsure: a dashed ring outside it. Not found: hollow.
		expect(rule('.mark[data-colour="unsure"] .number')).toContain(
			"outline: 1.5px dashed var(--tone, var(--st-open));",
		);
		const hollow = rule('.mark[data-colour="lost"] .number');
		expect(hollow).toContain("background: var(--paper);");
		expect(hollow).toContain("inset 0 0 0 2px var(--tone, var(--st-open))");
		expect(hollow).toContain("color: var(--tone, var(--st-open));");
	});

	test("says nothing more about the element it expected; names another, and says when one is hidden", () => {
		render(shownAs(summarize(element)), noActions);
		expect(said()).toBeUndefined();
		render(shownAs("a link"), noActions);
		expect(said()).toBe("a link");
		render(shownAs("a span", false), noActions);
		expect(said()).toBe("a span, hidden at this width");
		render(shownAs(summarize(element), false), noActions);
		expect(said()).toBe("Hidden at this width");
	});
});

describe("where an export went (DEC-020)", () => {
	const saved = (where: string) =>
		window.document.querySelector(`#${where}`) as unknown as HTMLElement;

	test("Export all cases waits for a case, and is off while at work", () => {
		const state = initialState();
		render(state, noActions);
		expect(el<HTMLButtonElement>("export-all").disabled).toBe(true);
		state.cases = [sampleCase("c_x1")];
		render(state, noActions);
		expect(el<HTMLButtonElement>("export-all").disabled).toBe(false);
		state.exportingAll = true;
		render(state, noActions);
		expect(el<HTMLButtonElement>("export-all").disabled).toBe(true);
	});

	test("the path of all cases' file at home, with Copy and Show in folder", async () => {
		const state = initialState();
		state.cases = [sampleCase("c_x1")];
		state.exported = { of: "all", downloadId: 7, path: "/Users/a/x.zip" };
		const copied: string[] = [];
		const shown: number[] = [];
		render(
			state,
			actionsWith({
				copyPath: async (path) => {
					copied.push(path);
					return true;
				},
				showFile: (e) => shown.push(e.downloadId),
			}),
		);
		const box = saved("export-all-saved");
		expect(box.hidden).toBe(false);
		expect(box.querySelector("code")?.textContent).toBe("/Users/a/x.zip");
		const copy = box.querySelector(
			'[data-action="copy-path"]',
		) as unknown as HTMLButtonElement;
		copy.click();
		await Bun.sleep(0);
		expect(copied).toEqual(["/Users/a/x.zip"]);
		expect(copy.textContent).toBe("Copied");
		render(state, noActions);
		// Drawn again only when it shows another file: "Copied" stays.
		expect(copy.isConnected).toBe(true);
		(
			box.querySelector('[data-action="show-file"]') as unknown as HTMLElement
		).click();
		expect(shown).toEqual([7]);
		state.exported = undefined;
		render(state, noActions);
		expect(box.hidden).toBe(true);
	});

	test("a case's file shows in that case only", () => {
		const c = sampleCase("c_x2");
		render(
			caseState(c, (s) => {
				s.exported = { of: { caseId: c.id }, downloadId: 1, path: "/p.zip" };
			}),
			noActions,
		);
		expect(saved("export-saved").hidden).toBe(false);
		expect(saved("export-saved").textContent).toContain("/p.zip");
		render(
			caseState(sampleCase("c_x3"), (s) => {
				s.exported = { of: { caseId: c.id }, downloadId: 1, path: "/p.zip" };
			}),
			noActions,
		);
		expect(saved("export-saved").hidden).toBe(true);
	});

	test("while Chrome asks, it says what the answer does", () => {
		const c = sampleCase("c_x4");
		render(
			caseState(c, (s) => {
				s.askingDownloads = { caseId: c.id };
			}),
			noActions,
		);
		expect(saved("export-saved").textContent).toBe(ASKING_DOWNLOADS);
	});

	test("a file of several cases says which case it asks about, and offers Skip", () => {
		const state = initialState();
		state.importing = {
			parsed: { case: sampleCase("c_in"), images: async () => new Map() },
			existing: sampleCase("c_in"),
			batch: { name: "all.zip", rest: [], total: 3, stored: 1, skipped: 1 },
		};
		render(state, noActions);
		expect(el("import-prompt").textContent).toContain(
			"Case 3 of 3 in all.zip.",
		);
		expect(
			window.document.querySelector('[data-action="import-cancel"]')
				?.textContent,
		).toBe("Skip");
		state.importing = undefined;
		render(state, noActions);
	});
});

describe("one import at a time", () => {
	const button = (id: string) => el<HTMLButtonElement>(id);

	test("Import a case… and Export all cases are off while an import is at work, and say why", () => {
		const state = initialState();
		state.cases = [sampleCase("c_y1")];
		render(state, noActions);
		const importTitle = button("import").title;
		const exportTitle = button("export-all").title;
		expect(button("import").disabled).toBe(false);
		expect(button("export-all").disabled).toBe(false);

		state.importWork = "all.zip";
		render(state, noActions);
		expect(button("import").disabled).toBe(true);
		expect(button("export-all").disabled).toBe(true);
		expect(button("import").title).toBe(IMPORT_BUSY);
		expect(button("export-all").title).toBe(EXPORT_ALL_BUSY);
		expect(el("import-done").hidden).toBe(false);
		expect(el("import-done").textContent).toBe("Importing all.zip…");

		// Its question open: the question shows instead.
		state.importWork = undefined;
		state.importing = {
			parsed: { case: sampleCase("c_y1"), images: async () => new Map() },
			existing: sampleCase("c_y1"),
			batch: { name: "all.zip", rest: [], total: 2, stored: 0, skipped: 0 },
		};
		render(state, noActions);
		expect(button("import").disabled).toBe(true);
		expect(button("export-all").disabled).toBe(true);
		expect(el("import-done").hidden).toBe(true);
		expect(el("import-prompt").hidden).toBe(false);

		state.importing = undefined;
		state.importDone = "Imported all 2 cases of all.zip.";
		render(state, noActions);
		expect(button("import").disabled).toBe(false);
		expect(button("export-all").disabled).toBe(false);
		expect(button("import").title).toBe(importTitle);
		expect(button("export-all").title).toBe(exportTitle);
		expect(el("import-done").textContent).toBe(
			"Imported all 2 cases of all.zip.",
		);
	});
});

describe("the sync (DEC-021, DEC-025)", () => {
	const draw = (
		change: (s: PanelState["sync"]) => void,
		actions = noActions,
		view?: Case,
	) => {
		const state = view === undefined ? initialState() : caseState(view);
		change(state.sync);
		render(state, actions);
		return el<HTMLDivElement>("sync");
	};
	const sync = draw;
	const buttons = (box: HTMLElement) =>
		[...box.querySelectorAll("button")].map((b) => [
			b.textContent,
			b.title !== "",
		]);
	const labels = (box: HTMLElement) => buttons(box).map(([label]) => label);
	const synced = (s: PanelState["sync"]) => {
		s.target = "downloads";
		s.targetId = "downloads";
		s.status = {
			folderId: "downloads",
			state: "synced",
			lastSyncedAt: "2026-11-12T09:30:00Z",
		};
	};
	const pausedFolder = (s: PanelState["sync"]) => {
		s.target = "folder";
		s.targetId = "f";
		s.folder = "iCloud cases";
		s.status = { folderId: "f", state: "paused", reason: "access" };
	};
	const banner = () => el<HTMLDivElement>("sync-banner");

	test("off: what it does, Sync to Downloads first, Choose a folder…, and the note", () => {
		const box = sync(() => {});
		expect(box.querySelector(".sync-state")?.textContent).toBe("Off.");
		expect(buttons(box)).toEqual([
			["Copy to Downloads", true],
			["Choose a folder…", true],
		]);
		// Ink, not amber: amber is Home's New case for this page alone (DEC-024).
		expect(box.querySelector('[data-action="sync-downloads"]')?.className).toBe(
			"strong",
		);
		expect(box.querySelector(".sync-note")?.textContent).toContain(
			"works with this panel closed",
		);
		expect(
			(box.querySelector('[data-action="sync-choose"]') as HTMLElement).title,
		).toContain("A deleted case keeps its file");
	});

	test("asking for downloads: what Chrome asks, no buttons", () => {
		const box = sync((s) => {
			s.asking = true;
		});
		expect(box.textContent).toContain("may manage your downloads");
		expect(labels(box)).toEqual([]);
	});

	test("synced to Downloads: where, when, Show in folder · Change… · Stop syncing", () => {
		let shown = 0;
		const box = sync(synced, actionsWith({ syncShow: () => shown++ }));
		expect(box.querySelector(".sync-state")?.textContent).toBe(
			"Copying to Downloads/Sitegloss",
		);
		expect(box.querySelector(".sync-line")?.textContent).toStartWith(
			"Last written ",
		);
		expect(buttons(box)).toEqual([
			["Show in folder", true],
			["Change…", true],
			["Stop copying", true],
		]);
		(box.querySelector('[data-action="sync-show"]') as HTMLElement).click();
		expect(shown).toBe(1);
		expect(banner().hidden).toBe(true);
	});

	test("syncing to a folder: its name, how many cases are left", () => {
		const box = sync((s) => {
			s.target = "folder";
			s.targetId = "f";
			s.folder = "Sitegloss";
			s.status = { folderId: "f", state: "syncing", left: 3 };
		});
		expect(box.querySelector(".sync-state")?.textContent).toBe(
			"Copying to “Sitegloss”",
		);
		expect(box.querySelector(".sync-line")?.textContent).toBe(
			"Writing 3 cases…",
		);
		expect(labels(box)).toEqual(["Change…", "Stop copying"]);
	});

	test("Change…: the Off state's buttons with Cancel, the target still shown", () => {
		const box = sync((s) => {
			synced(s);
			s.changing = true;
		});
		expect(box.querySelector(".sync-state")?.textContent).toBe(
			"Copying to Downloads/Sitegloss",
		);
		expect(labels(box)).toEqual([
			"Copy to Downloads",
			"Choose a folder…",
			"Cancel",
		]);
	});

	test("paused, the folder: the section says so, with the banner's buttons", () => {
		let allowed = 0;
		let downloads = 0;
		const box = sync(
			pausedFolder,
			actionsWith({
				syncAllow: () => allowed++,
				syncDownloads: () => downloads++,
			}),
		);
		expect(box.querySelector(".sync-state")?.textContent).toBe(
			"Paused: Chrome wants your OK for “iCloud cases” again.",
		);
		expect(labels(box)).toEqual([
			"Allow access",
			"Use Downloads instead",
			"Change…",
			"Stop copying",
		]);
		(box.querySelector('[data-action="sync-allow"]') as HTMLElement).click();
		(
			box.querySelector('[data-action="sync-use-downloads"]') as HTMLElement
		).click();
		expect([allowed, downloads]).toEqual([1, 1]);
	});

	test("paused: the banner, on Home and in a case, that cannot be dismissed", () => {
		let allowed = 0;
		for (const view of [undefined, sampleCase("c_1")]) {
			draw(pausedFolder, actionsWith({ syncAllow: () => allowed++ }), view);
			const b = banner();
			expect(b.hidden).toBe(false);
			expect(b.getAttribute("role")).toBe("status");
			expect(b.dataset["sync"]).toBe("paused");
			expect(b.querySelector("p")?.textContent).toContain(
				"needs your OK to write to “iCloud cases”",
			);
			expect(b.querySelector("strong")?.textContent).toBe(
				"The copy to a folder is paused.",
			);
			expect(labels(b)).toEqual(["Allow access", "Use Downloads instead"]);
			(b.querySelector('[data-action="sync-allow"]') as HTMLElement).click();
		}
		expect(allowed).toBe(2);
		expect(el("case-view").hidden).toBe(false);
	});

	test("a no to Allow access: said under the banner's text", () => {
		draw((s) => {
			pausedFolder(s);
			s.refused = true;
		});
		expect(banner().textContent).toContain("Click Allow access to ask again");
	});

	test("what a banner button could not do is said in the banner, in a case too", () => {
		const box = draw(
			(s) => {
				pausedFolder(s);
				s.problem = "Chrome did not allow Sitegloss to save to your downloads.";
			},
			noActions,
			sampleCase("c_1"),
		);
		expect(banner().querySelector("[role=alert]")?.textContent).toBe(
			"Chrome did not allow Sitegloss to save to your downloads.",
		);
		// Once is enough: not again in the section.
		expect(box.querySelector("[role=alert]")).toBeNull();
	});

	test("paused, the downloads permission gone: Allow downloads", () => {
		let asked = 0;
		const box = draw(
			(s) => {
				s.target = "downloads";
				s.targetId = "downloads";
				s.status = {
					folderId: "downloads",
					state: "paused",
					reason: "downloads",
				};
			},
			actionsWith({ syncAllowDownloads: () => asked++ }),
		);
		expect(box.querySelector(".sync-state")?.textContent).toBe(
			"Paused: Sitegloss may no longer save to your downloads.",
		);
		expect(banner().querySelector("p")?.textContent).toContain(
			"no longer save to your downloads",
		);
		expect(labels(banner())).toEqual(["Allow downloads"]);
		(
			banner().querySelector(
				'[data-action="sync-allow-downloads"]',
			) as HTMLElement
		).click();
		expect(asked).toBe(1);
	});

	test("failed: the problem and Try again, in the section and the banner", () => {
		const box = sync((s) => {
			s.target = "folder";
			s.targetId = "f";
			s.folder = "Sitegloss";
			s.status = {
				folderId: "f",
				state: "failed",
				problem: "The folder “Sitegloss” is no longer there.",
			};
		});
		expect(box.querySelector("[role=alert]")?.textContent).toBe(
			"The folder “Sitegloss” is no longer there.",
		);
		expect(labels(box)).toContain("Try again");
		expect(banner().dataset["sync"]).toBe("failed");
		expect(banner().querySelector("strong")?.textContent).toBe(
			"The copy to a folder failed.",
		);
		expect(banner().querySelector("p")?.textContent).toContain(
			"The folder “Sitegloss” is no longer there.",
		);
		expect(labels(banner())).toEqual(["Try again"]);
	});

	test("the banner goes with the state", () => {
		draw(pausedFolder);
		expect(banner().hidden).toBe(false);
		draw(synced);
		expect(banner().hidden).toBe(true);
		expect(banner().childElementCount).toBe(0);
	});

	test("drawn again only when it shows something else", () => {
		const first = sync(synced).querySelector("button");
		const again = sync(synced).querySelector("button");
		expect(again).toBe(first);
		draw(pausedFolder);
		const bannerButton = banner().querySelector("button");
		draw(pausedFolder);
		expect(banner().querySelector("button")).toBe(bannerButton);
	});
});

test("every mask in the panel's style sheet has its -webkit- form beside it: Chrome 116 to 119 know no other", async () => {
	const css = await Bun.file(
		new URL("../src/sidepanel/style.css", import.meta.url),
	).text();
	const masks = [
		...css.matchAll(/^\s*(-webkit-)?mask(-[a-z]+)?:\s*([^;]+);/gm),
	];
	expect(masks.length).toBeGreaterThan(0);
	const plain = masks.filter((m) => m[1] === undefined);
	const prefixed = masks.filter((m) => m[1] !== undefined);
	expect(plain.map((m) => [m[2], m[3]])).toEqual(
		prefixed.map((m) => [m[2], m[3]]),
	);
	// The prefixed one first: where both are known, the standard one wins.
	for (const m of plain)
		expect(
			css
				.slice(0, m.index)
				.trimEnd()
				.endsWith(`-webkit-mask${m[2] ?? ""}: ${m[3]};`),
		).toBe(true);
});

describe("where a mark was made, and the offer on Home (DEC-050)", () => {
	const SEARCH = "https://shop.example/search";
	const shopCase = (id: string, closed = false): Case => {
		const c = withOneMark(sampleCase(id));
		return {
			...c,
			title: `Case ${id}`,
			page: { ...c.page, url: SEARCH },
			shots: c.shots.map((s) => ({ ...s, url: SEARCH, query: "q=shoes" })),
			...(closed ? { closed: { at: "2026-11-21T10:00:00.000Z" } } : {}),
		};
	};
	const tab = (url: string): PanelState["tab"] => ({
		id: 1,
		url,
		title: "",
		size: undefined,
	});
	const link = (which: "made" | "here") =>
		window.document.querySelector(
			`[data-mark-link="${which}"]`,
		) as unknown as HTMLButtonElement | null;

	test("Home: on the same page of the same site, open cases first and closed ones after; another host offers none", () => {
		const state = initialState();
		state.tab = tab("https://shop.example/search?q=boots");
		state.cases = [
			shopCase("c_closed", true),
			shopCase("c_open"),
			sampleCase("c_other"),
		];
		render(state, noActions);
		expect(el("here").hidden).toBe(false);
		const rows = [...el("here-cases").querySelectorAll("[data-case]")].map(
			(b) => b.getAttribute("data-case"),
		);
		expect(rows).toEqual(["c_open", "c_closed"]);
		expect(
			el("here-cases").querySelector('[data-case="c_closed"] .closed-tag')
				?.textContent,
		).toBe("Closed");
		expect(el("here-text").textContent).toContain("already has 2 cases");
		// Not under Closed as well.
		expect(
			window.document.querySelector(
				'ul.cases[data-group="closed"] [data-case="c_closed"]',
			),
		).toBeNull();
		// The same path on localhost: nothing offered, nothing about other sites.
		state.tab = tab("http://localhost:3000/search?q=shoes");
		render(state, noActions);
		expect(el("here").hidden).toBe(true);
		expect(el("home").textContent).not.toMatch(/other site/i);
		expect(
			window.document.querySelector(
				'ul.cases[data-group="other"] [data-case="c_open"]',
			),
		).not.toBeNull();
	});

	test("a mark says where it was made, with its query, and links there", () => {
		const c = shopCase("c_link");
		const asked: [string, string][] = [];
		render(
			caseState(c, (s) => {
				s.tab = tab("https://shop.example/search?q=boots");
			}),
			actionsWith({
				openMarkPage: (_c, a, where) => void asked.push([a.id, where]),
			}),
		);
		const made = link("made");
		expect(made?.textContent).toBe("shop.example/search?q=shoes");
		expect(made?.getAttribute("aria-label")).toBe(
			"Open shop.example/search?q=shoes, where mark 1 was made, in this tab",
		);
		expect(made?.tagName).toBe("BUTTON");
		// The same host in front: one link only.
		expect(link("here")).toBeNull();
		made?.click();
		expect(asked).toEqual([["m1", "made"]]);
	});

	test("with the case open on another host, the same path and query there too", () => {
		const c = shopCase("c_link2");
		const asked: string[] = [];
		render(
			caseState(c, (s) => {
				s.tab = tab("http://localhost:3000/");
			}),
			actionsWith({ openMarkPage: (_c, _a, where) => void asked.push(where) }),
		);
		const mark = window.document.querySelector('[data-mark="m1"] .mark-page');
		expect(mark?.textContent).toBe(
			"Marked on shop.example/search?q=shoes · Open on localhost:3000",
		);
		const here = link("here");
		expect(here?.getAttribute("title")).toBe(
			"Open http://localhost:3000/search?q=shoes in this tab, and show the mark there",
		);
		expect(here?.getAttribute("aria-label")).toBe(
			"Open the same page on localhost:3000, and show mark 1 there",
		);
		here?.click();
		expect(asked).toEqual(["here"]);
	});
});

describe("the second link names the origin in front (DEC-050)", () => {
	test("the same host on another scheme says the scheme; another port says the port; a page none of the case's still offers it", () => {
		const base = withOneMark(sampleCase("c_scheme"));
		const c: Case = {
			...base,
			page: { ...base.page, url: "https://shop.example/cart" },
			shots: base.shots.map((s) => ({
				...s,
				url: "https://shop.example/cart",
			})),
		};
		const line = (url: string) => {
			render(
				caseState(c, (s) => {
					s.tab = { id: 1, url, title: "", size: undefined };
				}),
				noActions,
			);
			return window.document.querySelector('[data-mark="m1"] .mark-page')
				?.textContent;
		};
		expect(line("http://shop.example/cart")).toBe(
			"Marked on shop.example/cart · Open on http://shop.example",
		);
		expect(line("https://shop.example:8443/")).toBe(
			"Marked on shop.example/cart · Open on shop.example:8443",
		);
		// localhost's home page is none of this case's pages: offered all the same.
		expect(line("http://localhost:3000/")).toBe(
			"Marked on shop.example/cart · Open on localhost:3000",
		);
		expect(
			window.document
				.querySelector('[data-mark-link="here"]')
				?.getAttribute("title"),
		).toBe(
			"Open http://localhost:3000/cart in this tab, and show the mark there",
		);
	});
});

test("two hosts' home pages are two pages, named with their hosts; other pages by their path (DEC-064's review)", () => {
	expect(pagePath("https://staging.example/")).toBe("staging.example");
	expect(pagePath("http://localhost:3000/")).toBe("localhost:3000");
	expect(pagePath("https://staging.example/t/a/settings")).toBe(
		"/t/a/settings",
	);
});
