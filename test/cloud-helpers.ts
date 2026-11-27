/**
 * Devices for the sync's tests: each a store, a database and an engine of
 * its own, signed in as someone, against one server (the fake in memory, or
 * a real one).
 */

import {
	type Case,
	type Mark,
	markStatus,
	markUrl,
	pendingImage,
} from "../src/lib/case.ts";
import type { Api, Me } from "../src/lib/cloud/api.ts";
import { type CloudStatus, KEYS } from "../src/lib/cloud/book.ts";
import { CloudSync, type EngineDeps } from "../src/lib/cloud/engine.ts";
import { memoryKv } from "../src/lib/kv.ts";
import { type Crop, type MarkDraft, saveCase } from "../src/lib/save.ts";
import { MemoryStore } from "../src/lib/store.ts";
import { newCase } from "../src/sidepanel/fresh.ts";
import { putCase } from "./fixtures.ts";

export const SERVER = "https://sitegloss.test";
export const CART = "https://shop.example/cart";
export const PAY = "https://shop.example/checkout/pay";

export interface Device<A extends Api = Api> {
	name: string;
	store: MemoryStore;
	kv: ReturnType<typeof memoryKv>;
	api: A;
	engine: CloudSync;
	/** Cases the engine said it changed here. */
	changed: string[];
	statuses: CloudStatus[];
	/** The device's clock: each look at it is a second later. */
	clock: { now: Date };
}

let devices = 0;

/**
 * A device of someone's; `api` is their connection to the server. `random`:
 * ids as the extension makes them (a real server keeps every id it saw).
 */
export function device<A extends Api>(
	name: string,
	api: A,
	random = false,
	extra: Partial<EngineDeps> = {},
): Device<A> {
	const store = new MemoryStore();
	const kv = memoryKv();
	const changed: string[] = [];
	const statuses: CloudStatus[] = [];
	const clock = { now: new Date("2026-11-19T10:00:00.000Z") };
	let ids = 0;
	const tag = `${name}${++devices}`;
	const engine = new CloudSync({
		store,
		kv,
		api: () => api,
		now: () => {
			clock.now = new Date(clock.now.getTime() + 1000);
			return clock.now;
		},
		...(random
			? {}
			: { newId: (prefix: string) => `${prefix}_${tag}_${++ids}` }),
		onChange: (ids) => changed.push(...ids),
		onStatus: (status) => statuses.push(status),
		...extra,
	});
	return { name, store, kv, api, engine, changed, statuses, clock };
}

/** Sign the device in (its one team is chosen) and let it sync. */
export async function signIn(d: Device, me?: Me): Promise<void> {
	await d.engine.signedIn(SERVER, me ?? (await d.api.me()));
}

/** Let the devices sync until they have each other's changes. */
export async function sync(...ds: Device[]): Promise<void> {
	for (let round = 0; round < 3; round++)
		for (const d of ds) await d.engine.request();
}

/**
 * An image a server takes for a WebP (a VP8X header of that size), with
 * `tag` after it: what tells one test image from another.
 */
export function webp(tag: string, width: number, height: number): Blob {
	const head = new Uint8Array(30);
	head.set(new TextEncoder().encode("RIFF\x00\x00\x00\x00WEBPVP8X"), 0);
	const w = width - 1;
	const h = height - 1;
	head.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
	head.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
	return new Blob([head, tag], { type: "image/webp" });
}

/** A test image's tag. */
export const tagOf = (image: Blob): Promise<string> => image.slice(30).text();

const crop: Crop = async (image, rects) => {
	const of = await tagOf(image);
	return rects.map((_, i) => ({
		blob: webp(`crop ${i} of ${of}`, 280, 160),
		width: 280,
		height: 160,
	}));
};

const page = (url: string, title: string) => ({
	url,
	title,
	lang: "en",
	viewport: { width: 1280, height: 800, dpr: 2 },
	userAgent: "test",
});

/** "New case for this page" on the device. */
export async function startCase(
	d: Device,
	id: string,
	url = CART,
	title = "Your cart",
): Promise<Case> {
	return putCase(
		d.store,
		newCase(id, page(url, title), d.clock.now.toISOString()),
	);
}

let shots = 0;

/** Add a mark to the case from the page at `url`, as the toolbar does. */
export async function addMark(
	d: Device,
	caseId: string,
	comment: string,
	options: {
		url?: string;
		title?: string;
		number?: number;
		element?: boolean;
	} = {},
): Promise<Mark> {
	const c = await d.store.getCase(caseId);
	const number =
		options.number ??
		Math.max(0, c?.lastNumber ?? 0, ...(c?.marks.map((a) => a.number) ?? [])) +
			1;
	const url = options.url ?? CART;
	const id = `p_${d.name}_${++shots}`;
	d.clock.now = new Date(d.clock.now.getTime() + 1000);
	const at = d.clock.now.toISOString();
	await d.store.putImage(caseId, pendingImage(id), {
		blob: webp(`shot ${id} by ${d.name}`, 2560, 1600),
		width: 2560,
		height: 1600,
	});
	const draft: MarkDraft = {
		id: `m${number}`,
		number,
		shot: id,
		comment,
		author: "user",
		shape: {
			kind: "box",
			rect: { x: 10 + shots, y: 10, width: 100, height: 40 },
		},
		element: options.element
			? {
					tag: "button",
					classes: ["Button_primary"],
					attributes: {},
					ancestors: ["form"],
					rect: { x: 10, y: 10, width: 100, height: 40 },
					page: { width: 1280, height: 2000 },
					selector: "form > button",
				}
			: null,
		cropRect: { x: 0, y: 0, width: 140, height: 80 },
	};
	const saved = await saveCase(
		d.store,
		{
			caseId,
			isNew: false,
			title: "",
			page: page(url, options.title ?? "Your cart"),
			shots: [
				{
					id,
					image: pendingImage(id),
					scrollX: 0,
					scrollY: 0,
					viewport: { width: 1280, height: 800, dpr: 2 },
					capturedAt: at,
					url,
				},
			],
			marks: [draft],
		},
		crop,
		new Date(at),
	);
	return saved.marks.find((a) => a.number === number) as Mark;
}

/** Change the case on the device, as the panel does: one transaction. */
export async function change(
	d: Device,
	caseId: string,
	how: (c: Case, now: string) => Case | { value: Case; images: string[] },
): Promise<Case> {
	d.clock.now = new Date(d.clock.now.getTime() + 1000);
	const now = d.clock.now.toISOString();
	return d.store.updateCase(caseId, (current) => {
		const next = how(current as Case, now);
		return "value" in next
			? { value: next.value, deleteImages: next.images }
			: { value: next };
	});
}

/** What a case is, apart from what differs between devices (ids of screenshots, times). */
export function look(c: Case | undefined) {
	if (c === undefined) return undefined;
	return {
		title: c.title,
		link: c.link ?? null,
		summary: c.verdict,
		pages: (c.pages ?? []).map((p) => p.url),
		marks: [...c.marks]
			.sort((a, b) => a.number - b.number)
			.map((a) => ({
				number: a.number,
				id: a.id,
				crop: a.crop,
				comment: a.comment,
				author: a.author,
				status: markStatus(a),
				note: a.resolution?.note ?? null,
				by: a.resolution?.user?.name ?? null,
				reopens: (a.reopens ?? []).map((r) => r.note ?? ""),
				page: markUrl(c, a),
				shape: a.shape,
			})),
	};
}

/** The images of a case on a device, as text: `path → content`. */
export async function images(
	d: Device,
	caseId: string,
): Promise<Record<string, string>> {
	const c = await d.store.getCase(caseId);
	const out: Record<string, string> = {};
	for (const a of c?.marks ?? []) {
		const cropped = await d.store.getImage(caseId, a.crop);
		out[`crop ${a.number}`] = cropped ? await tagOf(cropped.blob) : "MISSING";
		const shot = c?.shots.find((s) => s.id === a.shot);
		const shown = shot ? await d.store.getImage(caseId, shot.image) : undefined;
		out[`shot of ${a.number}`] = shown ? await tagOf(shown.blob) : "MISSING";
	}
	return out;
}

/** Every image key the device stores for the case. */
export const keys = (d: Device, caseId: string) =>
	[...d.store.images.keys()].filter((k) => k.startsWith(`${caseId}/`)).sort();

export const status = (d: Device) =>
	d.kv.data.get(KEYS.status) as CloudStatus | undefined;

/** Delete a case as the panel and an AI app's tool do: the store's delete, which records it. */
export async function removeCase(d: Device, caseId: string): Promise<void> {
	await d.store.deleteCase(caseId);
}
