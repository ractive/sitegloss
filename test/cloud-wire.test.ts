/**
 * The sync's pure parts (DEC-039): what counts as a change, the operations
 * a difference becomes, and how a case here and the server's copy of it are
 * brought together.
 */

import { describe, expect, test } from "bun:test";
import {
	type Case,
	type ElementDetails,
	type Mark,
	validateCase,
	withComment,
} from "../src/lib/case.ts";
import type { Op, WireMark, WireShot } from "../src/lib/cloud/api.ts";
import { type CaseBook, emptyBook } from "../src/lib/cloud/book.ts";
import {
	applyOp,
	canonical,
	caseContent,
	contentIn,
	deriveOps,
	fixedOf,
	isClean,
	markContent,
	markPatch,
	mergeCase,
	mergeContent,
	NeedsImage,
	opKey,
	relink,
	renumber,
	same,
} from "../src/lib/cloud/wire.ts";
import { sampleCase } from "./fixtures.ts";

const NOW = "2026-11-19T12:00:00.000Z";

const mark = (n: number, shot = "s1"): Mark => ({
	id: `m${n}`,
	number: n,
	shot,
	comment: `comment ${n}`,
	author: "user",
	shape: { kind: "box", rect: { x: n, y: 2, width: 30, height: 40 } },
	crop: `crops/m${n}.webp`,
	element: null,
});

function local(marks: Mark[] = [mark(1), mark(2)]): Case {
	return {
		...sampleCase("c_1", "2026-11-19T10:00:00.000Z"),
		pages: [{ url: "https://www.example.com/kk", title: "KK", lang: "de" }],
		shots: [
			{
				id: "s1",
				image: "shots/s1.webp",
				scrollX: 0,
				scrollY: 0,
				viewport: { width: 1280, height: 800, dpr: 2 },
				capturedAt: "2026-11-19T09:00:00.000Z",
				url: "https://www.example.com/kk",
			},
		],
		marks: marks,
	};
}

const ref = (path: string) => ({
	sha256: path.padEnd(64, "0").slice(0, 64),
	width: 10,
	height: 10,
	bytes: 30,
});

let ids = 0;
const newId = (prefix: string) => `${prefix}_${++ids}`;

/** The case sent whole: the book as it is once the server took every operation. */
function synced(c: Case): { book: CaseBook; ops: Op[] } {
	const book = emptyBook(c.id, "synced", "team_1");
	const { ops } = deriveOps(c, book, ref, newId);
	for (const op of ops) applyOp(book, op);
	return { book, ops };
}

describe("what counts as the same", () => {
	test("the order of the keys does not, nor what is undefined, nor who the server says did it", () => {
		expect(
			same(
				{ kind: "fixed", at: "t", note: undefined },
				{ at: "t", kind: "fixed", user: { id: "u", name: "Tess" } },
			),
		).toBe(true);
		expect(same({ kind: "fixed", at: "t" }, { kind: "wontfix", at: "t" })).toBe(
			false,
		);
		// For "is the stored case another one now", who did it counts.
		expect(canonical({ user: { id: "u" } }, true)).toContain("user");
	});

	test("the same change again has the same key, whatever its id", () => {
		const a: Op = {
			opId: "o_1",
			type: "mark.patch",
			markId: "m_1",
			comment: "x",
		};
		const b: Op = {
			opId: "o_2",
			type: "mark.patch",
			markId: "m_1",
			comment: "x",
		};
		const c: Op = {
			opId: "o_3",
			type: "mark.patch",
			markId: "m_1",
			comment: "y",
		};
		expect(opKey(a)).toBe(opKey(b));
		expect(opKey(a)).not.toBe(opKey(c));
	});
});

describe("the operations a case becomes", () => {
	test("a new case: itself, its screenshots, then its marks by number", () => {
		const c = local();
		const book = emptyBook(c.id, "synced", "team_1");
		const { ops, missing } = deriveOps(c, book, ref, newId);
		expect(missing).toEqual([]);
		expect(ops.map((op) => op.type)).toEqual([
			"case.create",
			"shot.create",
			"mark.create",
			"mark.create",
		]);
		const created = ops[0] as Extract<Op, { type: "case.create" }>;
		expect(created.case).toMatchObject({
			id: "c_1",
			title: "Button contrast",
			client: { viewport: { width: 1280, height: 800, dpr: 2 } },
			lastNumber: 2,
		});
		// The list of pages is the server's, made from the screenshots: a new
		// case names none, and each screenshot says what its page is called.
		expect("pages" in created.case).toBe(false);
		const shot = ops[1] as Extract<Op, { type: "shot.create" }>;
		expect(shot.shot.url).toBe("https://www.example.com/kk");
		expect(shot.page).toEqual({ title: "KK", lang: "de" });
		expect(shot.shot.id).toBe(book.shots["s1"] as string);
		const first = ops[2] as Extract<Op, { type: "mark.create" }>;
		expect(first.mark.number).toBe(1);
		expect(first.mark.shotId).toBe(shot.shot.id);
		expect(first.mark.id).toBe(book.marks["m1"] as string);
		// Ids at the server are not the positions here.
		expect(first.mark.id).not.toBe("m1");
		expect(first.mark.crop).toEqual(ref("crops/m1.webp"));
	});

	test("once the server has it, nothing; then only what changed", () => {
		const c = local();
		const { book } = synced(c);
		expect(isClean(c, book)).toBe(true);
		expect(deriveOps(c, book, ref, newId).ops).toEqual([]);
		const changed: Case = {
			...c,
			title: "Another title",
			verdict: "Fix the contrast",
			marks: [
				{
					...mark(1),
					comment: "Edited",
					resolution: { kind: "fixed", at: NOW },
					findings: [
						{
							id: "f_1",
							text: "Found",
							app: { id: "https://claude.ai/oauth", host: "claude.ai" },
							at: NOW,
						},
					],
				},
				mark(2),
			],
		};
		expect(isClean(changed, book)).toBe(false);
		const { ops } = deriveOps(changed, book, ref, newId);
		expect(ops).toEqual([
			{
				opId: expect.any(String),
				type: "case.patch",
				caseId: "c_1",
				title: "Another title",
				summary: "Fix the contrast",
			},
			{
				opId: expect.any(String),
				type: "mark.patch",
				markId: book.marks["m1"] as string,
				comment: "Edited",
				author: "user",
				state: { resolution: { kind: "fixed", at: NOW }, reopens: [] },
				findings: {
					upsert: [
						{
							id: "f_1",
							text: "Found",
							app: { id: "https://claude.ai/oauth", host: "claude.ai" },
							at: NOW,
						},
					],
				},
			},
		]);
		for (const op of ops) applyOp(book, op);
		expect(isClean(changed, book)).toBe(true);
	});

	test("a mark deleted here is deleted there, a finding too; a screenshot the server drops itself", () => {
		const c = local([
			{
				...mark(1),
				findings: [
					{
						id: "f_1",
						text: "Found",
						app: { id: "https://claude.ai/oauth", host: "claude.ai" },
						at: NOW,
					},
				],
			},
			mark(2),
		]);
		const { book } = synced(c);
		const wire = book.marks["m2"] as string;
		const { ops } = deriveOps({ ...c, marks: [mark(1)] }, book, ref, newId);
		expect(ops).toEqual([
			{ opId: expect.any(String), type: "mark.delete", markId: wire },
			{
				opId: expect.any(String),
				type: "mark.patch",
				markId: book.marks["m1"] as string,
				findings: { remove: ["f_1"] },
			},
		]);
	});

	test("an image that is not here: its mark is left out and named, the rest goes", () => {
		const c = local();
		const book = emptyBook(c.id, "synced", "team_1");
		const { ops, missing } = deriveOps(
			c,
			book,
			(path) => (path === "crops/m2.webp" ? undefined : ref(path)),
			newId,
		);
		expect(missing).toEqual(["crops/m2.webp"]);
		expect(ops.map((op) => op.type)).toEqual([
			"case.create",
			"shot.create",
			"mark.create",
		]);
	});

	test("a mark renumbered here whose book was not written is put together with the server's again", () => {
		const c = local();
		const { book } = synced(c);
		const wire = book.marks["m2"] as string;
		// The case says m5 now; the book still says m2.
		const moved: Case = {
			...c,
			marks: [
				mark(1),
				{ ...mark(2), id: "m5", number: 5, crop: "crops/m5.webp" },
			],
		};
		relink(moved, book);
		expect(book.marks).toEqual({ m1: book.marks["m1"] as string, m5: wire });
		// No mark is deleted or made again: only the case's highest number is told.
		expect(deriveOps(moved, book, ref, newId).ops).toEqual([
			{
				opId: expect.any(String),
				type: "case.patch",
				caseId: "c_1",
				lastNumber: 5,
			},
		]);
	});
});

describe("a mark here and the server's word on it", () => {
	const base = markContent(mark(1));

	test("what was not changed here becomes the server's; what was stays", () => {
		const mine = { ...base, comment: "Mine" };
		const theirs = {
			...base,
			resolution: { kind: "fixed" as const, at: NOW },
		};
		expect(mergeContent(mine, base, theirs)).toEqual({
			...base,
			comment: "Mine",
			resolution: { kind: "fixed", at: NOW },
		});
		// Both changed the comment: this device's stays, and is sent next.
		expect(
			mergeContent(mine, base, { ...base, comment: "Theirs" }).comment,
		).toBe("Mine");
		// Nothing to tell a change here by: the server's copy counts.
		expect(mergeContent(mine, undefined, theirs)).toEqual(theirs);
	});

	test("findings are merged one by one", () => {
		const f = (id: string, text: string) => ({
			id,
			text,
			app: { id: "https://claude.ai/oauth", host: "claude.ai" },
			at: NOW,
		});
		const before = { ...base, findings: [f("f_1", "one"), f("f_2", "two")] };
		const mine = {
			...base,
			findings: [f("f_1", "one, edited here"), f("f_3", "new here")],
		};
		const theirs = {
			...base,
			findings: [f("f_1", "one"), f("f_2", "two"), f("f_4", "new there")],
		};
		expect(
			mergeContent(mine, before, theirs).findings.map((x) => [x.id, x.text]),
		).toEqual([
			["f_1", "one, edited here"],
			// f_2 was deleted here: it stays away.
			["f_4", "new there"],
			["f_3", "new here"],
		]);
		expect(markPatch(mine, before)?.findings).toEqual({
			upsert: [f("f_1", "one, edited here"), f("f_3", "new here")],
			remove: ["f_2"],
		});
	});

	test("what comes in is kept as a case here keeps it, to the letter", () => {
		const long = "x".repeat(3000);
		const wire = {
			comment: "c",
			author: "user",
			resolution: null,
			reopens: [
				{
					at: NOW,
					was: {
						kind: "fixed",
						at: NOW,
						note: long,
						app: { id: "a", host: "h", verified: true },
						somethingNew: 1,
					},
				},
			],
			findings: [],
		} as unknown as WireMark;
		const content = contentIn(wire);
		// As `validateCase` cuts a reopen's ended note: no difference to send.
		expect(content.reopens[0]?.was.note).toHaveLength(2000);
		expect(content.reopens[0]?.was.app).toEqual({ id: "a", host: "h" });
		expect(JSON.stringify(content)).not.toContain("somethingNew");
	});
});

describe("numbers", () => {
	test("a mark takes another number: its id, its crop and the book follow; who held it moves on", () => {
		const c: Case = { ...local([mark(1), mark(2), mark(3)]), lastNumber: 3 };
		const { book } = synced(c);
		const wires = { ...book.marks };
		const out = {
			images: new Map<string, unknown>(),
			deleteImages: new Set<string>(),
		};
		const crops = new Map<string, unknown>([
			["crops/m2.webp", "crop two"],
			["crops/m3.webp", "crop three"],
		]);
		// The server says the mark here called 2 is 3.
		const next = renumber(c, book, new Map([["m2", 3]]), crops, out);
		expect(next.marks.map((a) => [a.id, a.number, a.crop, a.comment])).toEqual([
			["m1", 1, "crops/m1.webp", "comment 1"],
			["m3", 3, "crops/m3.webp", "comment 2"],
			["m4", 4, "crops/m4.webp", "comment 3"],
		]);
		expect(Object.fromEntries(out.images)).toEqual({
			"crops/m3.webp": "crop two",
			"crops/m4.webp": "crop three",
		});
		// m3's path is written anew, not deleted.
		expect([...out.deleteImages]).toEqual(["crops/m2.webp"]);
		expect(book.marks).toEqual({
			m1: wires["m1"] as string,
			m3: wires["m2"] as string,
			m4: wires["m3"] as string,
		});
		expect(next.lastNumber).toBe(4);
	});

	test("a crop that has to move and was not read is asked for", () => {
		const c = local();
		const { book } = synced(c);
		expect(() =>
			renumber(c, book, new Map([["m2", 7]]), new Map(), {
				images: new Map(),
				deleteImages: new Set(),
			}),
		).toThrow(NeedsImage);
	});
});

describe("a case that is here and at the server, with no record of what the server had", () => {
	const wireShot: WireShot = {
		id: "sh_1",
		caseId: "c_1",
		url: "https://www.example.com/kk",
		image: ref("server shot"),
		scrollX: 0,
		scrollY: 0,
		viewport: { width: 1280, height: 800, dpr: 2 },
		capturedAt: "2026-11-19T09:00:00.000Z",
		rev: 1,
	};
	const wireMark = (n: number, comment: string): WireMark => ({
		id: `m_${n}`,
		caseId: "c_1",
		number: n,
		shotId: "sh_1",
		comment,
		author: "user",
		shape: mark(n).shape as WireMark["shape"],
		crop: ref(`server crop ${n}`),
		element: null,
		resolution: null,
		reopens: [],
		findings: [],
		status: "open",
		createdBy: { id: "u_tess", name: "Tess Tester" },
		createdAt: NOW,
		updatedAt: NOW,
		rev: 1,
	});

	test("the same marks are the same marks, the server's copy counts, and a mark only here is sent", () => {
		// It came in from a file: marks 1 and 2 as the team has them, 3 added here.
		const c = local([
			{ ...mark(1), comment: "As the file said" },
			mark(2),
			mark(3),
		]);
		const merged = mergeCase(
			c,
			emptyBook("c_1", "local"),
			{
				case: {
					id: "c_1",
					teamId: "team_1",
					title: "The team's title",
					link: null,
					summary: null,
					pages: [
						{ url: "https://www.example.com/kk", title: "KK", lang: "de" },
					],
					client: {},
					lastNumber: 2,
					importedAt: null,
					closed: null,
					createdBy: null,
					createdAt: NOW,
					updatedAt: NOW,
					rev: 1,
				},
				shots: [wireShot],
				marks: [wireMark(1, "As the team has it"), wireMark(2, "comment 2")],
				removedMarks: [],
				removedShots: [],
			},
			new Map(),
			new Map(),
			{ teamId: "team_1", whole: true, now: NOW },
		);
		expect(merged?.value.title).toBe("The team's title");
		expect(merged?.value.marks.map((a) => a.comment)).toEqual([
			"As the team has it",
			"comment 2",
			"comment 3",
		]);
		const book = merged?.book as CaseBook;
		expect(book.mode).toBe("synced");
		expect(book.marks).toEqual({ m1: "m_1", m2: "m_2" });
		expect(book.shots).toEqual({ s1: "sh_1" });
		// No image was needed: nothing new came.
		expect(merged?.images.size).toBe(0);
		const { ops } = deriveOps(merged?.value as Case, book, ref, newId);
		expect(ops.map((op) => op.type)).toEqual(["case.patch", "mark.create"]);
		expect(fixedOf(mark(3))).not.toBe(fixedOf(mark(2)));
	});

	test("the case's content as the server has it is what is compared next", () => {
		const c = local();
		expect(caseContent(c)).toEqual({
			title: "Button contrast",
			link: null,
			summary: null,
			// Not its pages: the server keeps that list, from the screenshots.
			lastNumber: 2,
		});
	});
});

describe("a mark's look: computed styles, backdrop, siblings (DEC-048)", () => {
	const button: ElementDetails = {
		tag: "button",
		name: "Book now",
		classes: ["Button_ghost"],
		attributes: { type: "button" },
		ancestors: ["div.Hero"],
		rect: { x: 24, y: 310, width: 96, height: 40 },
		page: { width: 1280, height: 3000 },
		selector: "button.Button_ghost",
		heading: "Book a ride",
	};
	const link: ElementDetails = {
		tag: "a",
		role: "link",
		text: "Prices",
		classes: [],
		attributes: { href: "/demo#prices" },
		ancestors: ["nav"],
		rect: { x: 400, y: 10, width: 60, height: 20 },
		page: { width: 1280, height: 3000 },
		selector: "nav > a:nth-of-type(2)",
	};
	const look = {
		styles: {
			color: "rgb(245, 207, 88)",
			"background-color": "rgb(242, 194, 48)",
			"font-size": "16px",
			display: "inline-block",
		},
		backdrop: { color: "rgb(242, 194, 48)", depth: 0 },
		siblings: [
			{ offset: -1, tag: "p", rect: { x: 24, y: 260, width: 300, height: 40 } },
		],
	};

	test("is no part of a mark's fingerprint: the build before this one computed the same", () => {
		// fixedOf of these three drawings, computed by the extension's main
		// (c4e97c9) before this change: a book that build wrote holds them.
		const before = {
			element: "1h9cbfikwf9",
			arrow: "1s41a021xzz",
			box: "1yh3r7b9ryr",
		};
		const drawings: Record<
			keyof typeof before,
			Pick<Mark, "shape" | "element">
		> = {
			element: {
				shape: { kind: "element", rect: button.rect },
				element: button,
			},
			arrow: {
				shape: {
					kind: "arrow",
					from: { x: 30, y: 320 },
					to: { x: 410, y: 15 },
				},
				element: link,
			},
			box: {
				shape: { kind: "box", rect: { x: 5, y: 5, width: 50, height: 50 } },
				element: null,
			},
		};
		for (const [name, drawing] of Object.entries(drawings) as [
			keyof typeof before,
			Pick<Mark, "shape" | "element">,
		][]) {
			expect(fixedOf(drawing)).toBe(before[name]);
			if (drawing.element !== null)
				expect(
					fixedOf({ ...drawing, element: { ...drawing.element, ...look } }),
				).toBe(before[name]);
		}
	});

	test("goes out once, with mark.create, within what the server keeps; never in mark.patch", () => {
		const styled: Mark = {
			...mark(1),
			shape: { kind: "element", rect: button.rect },
			element: {
				...button,
				...look,
				// Not what this build records; a file could hold it. Left out.
				styles: { ...look.styles, "--brand": "#0a7", cursor: "url(x.cur)" },
			},
		};
		const c = local([styled, mark(2)]);
		const { book, ops } = synced(c);
		const created = ops.filter(
			(op): op is Extract<Op, { type: "mark.create" }> =>
				op.type === "mark.create",
		);
		expect(created[0]?.mark.element).toEqual({ ...button, ...look });
		expect(created[1]?.mark.element).toBeNull();
		// Sent: nothing more.
		expect(deriveOps(c, book, ref, newId).ops).toEqual([]);
		// A comment changed: a mark.patch without an element.
		const edited = local([{ ...styled, comment: "Edited" }, mark(2)]);
		const { ops: next } = deriveOps(edited, book, ref, newId);
		expect(next.map((op) => op.type)).toEqual(["mark.patch"]);
		expect(JSON.stringify(next)).not.toContain("styles");
	});

	test("a mark the build before synced makes no operation, with or without a look here", () => {
		const plain: Mark = {
			...mark(1),
			shape: { kind: "element", rect: button.rect },
			element: button,
		};
		const { book } = synced(local([plain, mark(2)]));
		expect(deriveOps(local([plain, mark(2)]), book, ref, newId).ops).toEqual(
			[],
		);
		const styled = { ...plain, element: { ...button, ...look } };
		expect(deriveOps(local([styled, mark(2)]), book, ref, newId).ops).toEqual(
			[],
		);
	});
});

describe("images added to a mark in the sync (DEC-058)", () => {
	const withImage = (): Case =>
		local([
			mark(1),
			{
				...mark(2),
				images: [{ id: "i_a", image: "images/i_a.webp", added: { at: NOW } }],
			},
		]);
	/** Mark 2 as the server sends it; `images` absent: a server before images. */
	const theirs = (
		book: CaseBook,
		images: WireMark["images"] | undefined,
	): WireMark => ({
		id: book.marks["m2"] as string,
		caseId: "c_1",
		number: 2,
		shotId: book.shots["s1"] as string,
		comment: "comment 2",
		author: "user",
		shape: mark(2).shape as WireMark["shape"],
		crop: ref("crops/m2.webp"),
		element: null,
		resolution: null,
		reopens: [],
		findings: [],
		...(images === undefined ? {} : { images }),
		status: "open",
		createdBy: null,
		createdAt: NOW,
		updatedAt: NOW,
		rev: 2,
	});
	const merge = (c: Case, book: CaseBook, w: WireMark) =>
		mergeCase(
			c,
			book,
			{ shots: [], marks: [w], removedMarks: [], removedShots: [] },
			new Map(),
			new Map(),
			{ teamId: "team_1", whole: false, now: NOW },
		);

	test("go with a new mark; a server that says nothing of them removes none here, one that has none removes it", () => {
		const c = withImage();
		const { book, ops } = synced(c);
		const create = ops.find(
			(op) => op.type === "mark.create" && op.mark.number === 2,
		) as Extract<Op, { type: "mark.create" }>;
		expect(create.mark.images?.map((x) => x.id)).toEqual(["i_a"]);
		expect(isClean(c, book)).toBe(true);
		const untold = merge(c, book, theirs(book, undefined));
		expect(untold?.value.marks[1]?.images?.map((x) => x.id)).toEqual(["i_a"]);
		expect(untold?.deleteImages).toEqual([]);
		expect(isClean(untold?.value as Case, untold?.book as CaseBook)).toBe(true);
		const removed = merge(c, book, theirs(book, []));
		expect(removed?.value.marks[1]?.images).toBeUndefined();
		expect(removed?.deleteImages).toEqual(["images/i_a.webp"]);
	});

	test("an image added here after the run's push is held back when the team's mark comes back full, its file kept", () => {
		const c = withImage();
		const { book } = synced(c);
		// Added between the push and the pull: not in the shadow.
		const late: Case = {
			...c,
			marks: [
				mark(1),
				{
					...(c.marks[1] as Mark),
					images: [
						...((c.marks[1] as Mark).images ?? []),
						{ id: "i_late", image: "images/i_late.webp", added: { at: NOW } },
					],
				},
			],
		};
		const six = ["i_a", "t1", "t2", "t3", "t4", "t5"].map((id) => ({
			id,
			image: ref(`images/${id}.webp`),
			added: { at: NOW, user: { id: "u_dana", name: "Dana" } },
		}));
		const merged = mergeCase(
			late,
			book,
			{
				shots: [],
				marks: [theirs(book, six)],
				removedMarks: [],
				removedShots: [],
			},
			new Map(six.map((x) => [x.image.sha256, `picture ${x.id}`])),
			new Map(),
			{ teamId: "team_1", whole: false, now: NOW },
		);
		// The team's six are the mark's images; the late one is held back,
		// its file kept, and no patch carries it.
		const after = merged?.value as Case;
		expect(after.marks[1]?.images?.map((x) => x.id)).toEqual([
			"i_a",
			"t1",
			"t2",
			"t3",
			"t4",
			"t5",
		]);
		expect(after.marks[1]?.heldImages?.map((x) => x.id)).toEqual(["i_late"]);
		expect(merged?.deleteImages).toEqual([]);
		expect(isClean(after, merged?.book as CaseBook)).toBe(true);
	});

	test("an image added here goes as an add by id, one removed here as a remove, with a key that does not hang on the picture", () => {
		const c = withImage();
		const { book } = synced(c);
		const changed: Case = {
			...c,
			marks: [
				mark(1),
				{
					...mark(2),
					images: [{ id: "i_b", image: "images/i_b.webp", added: { at: NOW } }],
				},
			],
		};
		const { ops } = deriveOps(changed, structuredClone(book), ref, newId);
		const patch = ops.find((op) => op.type === "mark.patch") as Extract<
			Op,
			{ type: "mark.patch" }
		>;
		expect(patch.images?.add?.map((x) => [x.id, x.image.sha256])).toEqual([
			["i_b", ref("images/i_b.webp").sha256],
		]);
		expect(patch.images?.remove).toEqual(["i_a"]);
		const other = deriveOps(
			changed,
			structuredClone(book),
			() => ref("x"),
			newId,
		).ops.find((op) => op.type === "mark.patch") as Op;
		expect(opKey(other)).toBe(opKey(patch));
	});
});

describe("highlights and marks of a newer kind in the sync (DEC-066)", () => {
	const highlight = {
		text: "wekend",
		before: "this ",
		after: ": pick up",
		rects: [{ x: 1, y: 2, width: 30, height: 18 }],
	};

	test("a highlight goes out once, with mark.create; never in mark.patch, nor in the fingerprint", () => {
		const marked: Mark = { ...mark(1), highlight };
		const c = local([marked, mark(2)]);
		const { book, ops } = synced(c);
		const created = ops.filter(
			(op): op is Extract<Op, { type: "mark.create" }> =>
				op.type === "mark.create",
		);
		expect(created[0]?.mark.highlight).toEqual(highlight);
		expect(created[1]?.mark.highlight).toBeUndefined();
		expect(fixedOf(marked)).toBe(fixedOf(mark(1)));
		const { ops: next } = deriveOps(
			local([{ ...marked, comment: "Edited" }, mark(2)]),
			book,
			ref,
			newId,
		);
		expect(next.map((op) => op.type)).toEqual(["mark.patch"]);
		expect(JSON.stringify(next)).not.toContain("wekend");
	});

	test("a teammate's highlight and a mark of a kind this version does not know come in, kept, and send nothing back", () => {
		const shot: WireShot = {
			id: "sh_1",
			caseId: "c_1",
			url: "https://www.example.com/kk",
			image: ref("server shot"),
			scrollX: 0,
			scrollY: 0,
			viewport: { width: 1280, height: 800, dpr: 2 },
			capturedAt: "2026-11-19T09:00:00.000Z",
			rev: 1,
		};
		const wire = (n: number, extra: Partial<WireMark>): WireMark =>
			({
				id: `m_${n}`,
				caseId: "c_1",
				number: n,
				shotId: "sh_1",
				comment: `comment ${n}`,
				author: "user",
				shape: mark(n).shape as WireMark["shape"],
				crop: ref(`server crop ${n}`),
				element: null,
				resolution: null,
				reopens: [],
				findings: [],
				status: "open",
				createdAt: NOW,
				updatedAt: NOW,
				rev: 1,
				...extra,
			}) as WireMark;
		const circle = { kind: "circle", centre: { x: 5, y: 6 }, radius: 7 };
		const book = emptyBook("c_1", "synced", "team_1");
		book.shots = { s1: "sh_1" };
		const c: Case = local([]);
		const merged = mergeCase(
			c,
			book,
			{
				shots: [shot],
				marks: [
					wire(1, { highlight }),
					wire(2, { shape: circle as unknown as WireMark["shape"] }),
					// A kind that is no name: kept, under one, not refusing the case.
					wire(3, {
						shape: { kind: 5, r: 1 } as unknown as WireMark["shape"],
					}),
					// Larger than a case keeps: its kind alone.
					wire(4, {
						shape: {
							kind: "scribble",
							data: "x".repeat(300 * 1024),
						} as unknown as WireMark["shape"],
					}),
				],
				removedMarks: [],
				removedShots: [],
			},
			new Map(
				[
					"server shot",
					"server crop 1",
					"server crop 2",
					"server crop 3",
					"server crop 4",
				].map((p) => [ref(p).sha256, "image"]),
			),
			new Map(),
			{ teamId: "team_1", whole: false, now: NOW },
		);
		const value = validateCase(merged?.value);
		expect(value.marks[0]?.highlight).toEqual(highlight);
		expect(value.marks[1]?.shape).toEqual({ kind: "unknown", given: circle });
		expect(value.marks[2]?.shape).toEqual({
			kind: "unknown",
			given: { kind: "unnamed", r: 1 },
		});
		expect(value.marks[3]?.shape).toEqual({
			kind: "unknown",
			given: { kind: "scribble" },
		});
		const markOps = (x: Case) =>
			deriveOps(x, merged?.book as CaseBook, ref, newId)
				.ops.filter((op) => op.type.startsWith("mark."))
				.map((op) => op.type);
		expect(markOps(value)).toEqual([]);
		// Its comment changed here: a patch, the shape untouched.
		expect(
			markOps(validateCase(withComment(value, "m2", "Rounder", NOW))),
		).toEqual(["mark.patch"]);
	});
});

describe("a mark of a newer kind held back from the team (DEC-066)", () => {
	test("its comment waits with it, and the case counts as having nothing to send", () => {
		const newer: Mark = {
			...mark(2),
			shape: { kind: "unknown", given: { kind: "circle", r: 3 } },
		};
		const c: Case = {
			...local([mark(1), newer]),
			comments: [{ id: "k_1", mark: "m2", text: "Rounder", at: NOW }],
		};
		const { book, ops } = synced(c);
		expect(
			ops.filter((op) => op.type === "mark.create").map((op) => op.type),
		).toEqual(["mark.create"]);
		expect(ops.some((op) => op.type === "comment.create")).toBe(false);
		expect(isClean(c, book)).toBe(true);
	});
});
