/**
 * Finding a mark's element in another environment: every candidate is
 * scored by the weighted similarity of its details to the stored ones (after
 * Similo; see kb/design/overview.md). Pure, so it is tested without a browser.
 */

import type { ElementDetails } from "./case.ts";

export type MatchStatus = "found" | "probable" | "ambiguous" | "lost";

export const FOUND = 0.75;
export const PROBABLE = 0.5;
/** How much a name that says more than the text counts against that text (`identity`). */
export const NAME_WEIGHT = 0.7;
/** Two candidates closer than this are a tie. */
export const TIE = 0.03;

export const WEIGHTS = {
	testId: 3,
	id: 1.5,
	tag: 1.5,
	role: 1,
	name: 1.5,
	text: 1.5,
	classes: 1,
	attributes: 1,
	heading: 1,
	landmark: 0.5,
	ancestors: 0.5,
	position: 0.5,
	size: 0.5,
} as const;

interface Grams {
	text: string;
	grams: Map<string, number>;
}

/**
 * Normalised text and its bigrams, remembered: loading a case compares the
 * same strings thousands of times. Loading empties it when it is done
 * (`clearTextCache`), and it is emptied when it grows large.
 */
const gramCache = new Map<string, Grams>();

function grams(s: string): Grams {
	let found = gramCache.get(s);
	if (found === undefined) {
		const text = s.toLowerCase().replace(/\s+/g, " ").trim();
		const out = new Map<string, number>();
		for (let i = 0; i < text.length - 1; i++) {
			const g = text.slice(i, i + 2);
			out.set(g, (out.get(g) ?? 0) + 1);
		}
		if (gramCache.size > 20_000) gramCache.clear();
		found = { text, grams: out };
		gramCache.set(s, found);
	}
	return found;
}

/** Forget the remembered bigrams (they can hold megabytes of page text). */
export function clearTextCache(): void {
	gramCache.clear();
}

/** Dice coefficient of character bigrams, ignoring case and spacing (0 to 1). */
export function textSimilarity(a: string, b: string): number {
	const { text: x, grams: gx } = grams(a);
	const { text: y, grams: gy } = grams(b);
	if (x === y) return 1;
	if (x.length < 2 || y.length < 2) return 0;
	let shared = 0;
	for (const [g, n] of gx) shared += Math.min(n, gy.get(g) ?? 0);
	return (2 * shared) / (x.length - 1 + (y.length - 1));
}

function jaccard(a: readonly string[], b: readonly string[]): number {
	const x = new Set(a);
	const y = new Set(b);
	let inter = 0;
	for (const v of x) if (y.has(v)) inter++;
	const union = x.size + y.size - inter;
	return union === 0 ? 1 : inter / union;
}

/** 2 × longest common subsequence ÷ total length. */
function sequenceSimilarity(
	a: readonly string[],
	b: readonly string[],
): number {
	if (a.length + b.length === 0) return 1;
	const row = new Array<number>(b.length + 1).fill(0);
	for (const x of a) {
		let diagonal = 0;
		for (let j = 1; j <= b.length; j++) {
			const above = row[j] ?? 0;
			row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0);
			diagonal = above;
		}
	}
	return (2 * (row[b.length] ?? 0)) / (a.length + b.length);
}

function centre(d: ElementDetails): { x: number; y: number } | undefined {
	if (d.page.width <= 0 || d.page.height <= 0) return undefined;
	return {
		x: (d.rect.x + d.rect.width / 2) / d.page.width,
		y: (d.rect.y + d.rect.height / 2) / d.page.height,
	};
}

/** Values that name one element, as long as no other element has them too. */
const NAMING = ["testId", "id", "src", "href"] as const;
type Naming = (typeof NAMING)[number];

function naming(d: ElementDetails, key: Naming): string | undefined {
	return key === "src" || key === "href" ? d.attributes[key] : d[key];
}

/**
 * `candidate` as `stored` can be compared with (DEC-047): a link keeps its
 * fragment only where it names a place on the page, and only while that
 * place exists. Where one side has a fragment and the other none (a mark
 * stored before, or a target rendered later or not yet), their links are
 * compared without it; two fragments still tell two links apart.
 */
function comparable(
	stored: ElementDetails,
	candidate: ElementDetails,
): ElementDetails {
	const mine = stored.attributes["href"];
	const theirs = candidate.attributes["href"];
	if (mine === undefined || theirs === undefined) return candidate;
	const a = mine.indexOf("#");
	const b = theirs.indexOf("#");
	if (a < 0 === b < 0) return candidate;
	// The candidate's link as the stored one is written: with the stored
	// fragment where only the candidate lacks one, without its own where
	// only the stored one lacks one.
	const href =
		b >= 0 ? theirs.slice(0, b) : theirs === mine.slice(0, a) ? mine : theirs;
	return { ...candidate, attributes: { ...candidate.attributes, href } };
}

const NOTHING_REPEATED: ReadonlySet<Naming> = new Set();

/** Which of the stored element's naming values several candidates have. */
function repeatedNames(
	stored: ElementDetails,
	candidates: readonly ElementDetails[],
): Set<Naming> {
	const repeated = new Set<Naming>();
	for (const key of NAMING) {
		const value = naming(stored, key);
		if (!value) continue;
		let count = 0;
		for (const c of candidates)
			if (naming(comparable(stored, c), key) === value) count++;
		if (count > 1) repeated.add(key);
	}
	return repeated;
}

/**
 * How much a candidate shares what identifies the stored element, 0 to 1: its
 * test id or id, else its accessible name or text, else its image or link.
 * `undefined` when nothing tells: the stored element has none of these, or
 * only a value repeated on the page (`repeated`) or an image or link that
 * differs, which another environment may simply have renamed.
 */
export function identity(
	stored: ElementDetails,
	candidate: ElementDetails,
	repeated: ReadonlySet<Naming> = NOTHING_REPEATED,
): number | undefined {
	candidate = comparable(stored, candidate);
	const same = (key: Naming) =>
		!!naming(stored, key) && naming(candidate, key) === naming(stored, key);
	const names = (key: Naming) => same(key) && !repeated.has(key);
	if (names("testId") || names("id")) return 1;
	// A name that says more than the visible text (an `aria-label` beyond
	// "Edit") is what tells such elements apart, so it weighs most; the text
	// counts too, but cannot make up for another name. In one card of the web
	// app, "Edit" for the mark's text and "Edit" and "Delete" for a comment,
	// named "Edit the comment by …" and "Delete the comment by …" (mark 47,
	// DEC-063): the same text under another name is not the element. And a
	// text that changed under the same name still is (a "Notifications"
	// button whose badge read 12 and now 3; a labelled region whose content
	// is another environment's data), as is the same text under a name with
	// another user's name in it (DEC-064's review).
	if (
		stored.name &&
		stored.text &&
		grams(stored.name).text !== grams(stored.text).text
	)
		return (
			NAME_WEIGHT * textSimilarity(stored.name, candidate.name ?? "") +
			(1 - NAME_WEIGHT) * textSimilarity(stored.text, candidate.text ?? "")
		);
	const texts: number[] = [];
	if (stored.name)
		texts.push(textSimilarity(stored.name, candidate.name ?? ""));
	if (stored.text)
		texts.push(textSimilarity(stored.text, candidate.text ?? ""));
	if (texts.length > 0) return Math.max(...texts);
	if (names("src") || names("href")) return 1;
	if (NAMING.some(same)) return undefined;
	return stored.testId || stored.id ? 0 : undefined;
}

/**
 * The share of the context score a candidate keeps by its identity: siblings
 * share tag, classes, heading and position, so without this the neighbour of
 * a removed element would be "found". An element whose name and text were
 * rewritten completely is therefore reported lost: the screenshot still
 * shows what was meant.
 */
function identityFactor(value: number | undefined): number {
	if (value === undefined || value >= 0.7) return 1;
	if (value <= 0.5) return 0.5;
	return 0.5 + (value - 0.5) * 2.5;
}

/** How alike a candidate is to the stored element (0 to 1). */
export function score(
	stored: ElementDetails,
	candidate: ElementDetails,
	repeated: ReadonlySet<Naming> = NOTHING_REPEATED,
): number {
	candidate = comparable(stored, candidate);
	let total = 0;
	let weight = 0;
	const add = (w: number, similarity: number) => {
		total += w * similarity;
		weight += w;
	};
	if (stored.testId)
		add(WEIGHTS.testId, candidate.testId === stored.testId ? 1 : 0);
	if (stored.id) add(WEIGHTS.id, candidate.id === stored.id ? 1 : 0);
	add(WEIGHTS.tag, candidate.tag === stored.tag ? 1 : 0);
	if (stored.role) add(WEIGHTS.role, candidate.role === stored.role ? 1 : 0);
	if (stored.name)
		add(WEIGHTS.name, textSimilarity(stored.name, candidate.name ?? ""));
	if (stored.text)
		add(WEIGHTS.text, textSimilarity(stored.text, candidate.text ?? ""));
	if (stored.classes.length > 0)
		add(WEIGHTS.classes, jaccard(stored.classes, candidate.classes));
	const keys = Object.keys(stored.attributes);
	if (keys.length > 0) {
		const same = keys.filter(
			(k) => candidate.attributes[k] === stored.attributes[k],
		).length;
		add(WEIGHTS.attributes, same / keys.length);
	}
	if (stored.heading)
		add(
			WEIGHTS.heading,
			// A mark stored before DEC-047 says the heading by the rule then:
			// the better of the candidate's heading now and by that rule.
			Math.max(
				textSimilarity(stored.heading, candidate.heading ?? ""),
				candidate.headingBefore === undefined
					? 0
					: textSimilarity(stored.heading, candidate.headingBefore),
			),
		);
	if (stored.landmark)
		add(WEIGHTS.landmark, candidate.landmark === stored.landmark ? 1 : 0);
	if (stored.ancestors.length > 0)
		add(
			WEIGHTS.ancestors,
			sequenceSimilarity(stored.ancestors, candidate.ancestors),
		);
	const a = centre(stored);
	const b = centre(candidate);
	if (a !== undefined && b !== undefined && stored.rect.width > 0)
		add(
			WEIGHTS.position,
			Math.max(0, 1 - 3 * Math.hypot(a.x - b.x, a.y - b.y)),
		);
	const areaA = stored.rect.width * stored.rect.height;
	const areaB = candidate.rect.width * candidate.rect.height;
	if (areaA > 0)
		add(
			WEIGHTS.size,
			areaB > 0 ? Math.min(areaA, areaB) / Math.max(areaA, areaB) : 0,
		);
	if (weight === 0) return 0;
	return (
		(total / weight) * identityFactor(identity(stored, candidate, repeated))
	);
}

export interface Ranked {
	/** Index into the candidates. */
	index: number;
	score: number;
	/** Something identifies it, beyond looking like the stored element. */
	identified: boolean;
}

/** The best candidates, best first. */
export function rank(
	stored: ElementDetails,
	candidates: readonly ElementDetails[],
	limit = 3,
): Ranked[] {
	const repeated = repeatedNames(stored, candidates);
	return candidates
		.map((c, index) => ({ index, score: score(stored, c, repeated) }))
		.sort((x, y) => y.score - x.score || x.index - y.index)
		.slice(0, limit)
		.map((r) => ({
			...r,
			identified:
				identity(stored, candidates[r.index] as ElementDetails, repeated) !==
				undefined,
		}));
}

/**
 * Sure enough to say "found". Without identity, only the surroundings speak
 * for a candidate: any sibling can look the same, so it stays probable.
 */
export function isFound(r: Ranked): boolean {
	return r.score >= FOUND && r.identified;
}

export function classify(ranked: readonly Ranked[]): MatchStatus {
	const [best, second] = ranked;
	if (best === undefined || best.score < PROBABLE) return "lost";
	if (second !== undefined && best.score - second.score < TIE)
		return "ambiguous";
	return isFound(best) ? "found" : "probable";
}
