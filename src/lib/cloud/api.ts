/**
 * The sitegloss.dev API, version 1, as the extension uses it (DEC-039): its
 * types by their names here, and a client in plain `fetch`. The types are
 * generated (`api.gen.ts`); the contract's rule is that version 1 only
 * grows, so nothing here fails on a field, an error code or a kind of removed
 * thing it does not know: it is left out, or treated as the nearest thing
 * known.
 */

import type { components } from "./api.gen.ts";
import { AuthError, OfflineError } from "./auth.ts";
import { MAX_SMALL_BYTES, readBody, readJson, TooLarge } from "./body.ts";

type Schemas = components["schemas"];

export type WireCase = Schemas["Case"];
export type WireShot = Schemas["Shot"];
export type WireMark = Schemas["Mark"];
export type WirePage = Schemas["Page"];
export type WireResolution = Schemas["Resolution"];
export type WireReopen = Schemas["Reopen"];
export type WireElement = Schemas["ElementDetails"];
export type ImageRef = Schemas["ImageRef"];
export type UserRef = Schemas["UserRef"];
export type WireComment = Schemas["CaseComment"];
export type WireStamp = Schemas["Stamp"];
export type AppRef = Schemas["AppRef"];
export type Op = Schemas["Op"];
export type OpType = Op["type"];
export type OpOf<T extends OpType> = Extract<Op, { type: T }>;
export type OpResult = Schemas["OpResult"];
export type OpsResponse = Schemas["OpsResponse"];
export type Changes = Schemas["Changes"];
/** One case with its screenshots and marks: the whole of it, as the server has it. */
export type CaseDetail = Schemas["CaseDetail"];
export type Removed = Schemas["Removed"];
export type Me = Schemas["Me"];
export type Team = Schemas["TeamMembership"];
/** A member of a team, as far as a case is assigned to them (DEC-071): id and name. */
export type Member = Schemas["TeamMember"];

/** The most operations in one request, and about how much text. */
export const MAX_OPS = 100;
export const MAX_OPS_BYTES = 2_000_000;

/** The largest image the API holds (its `LIMITS.imageBytes`): a larger answer is not one. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/**
 * The largest JSON answer that is read. A page of `changes` is the largest
 * honest one: 500 things by default, each a few to some tens of kilobytes (a
 * mark with its element's details), so some megabytes. 64 MiB holds a
 * default page of marks of 128 KB each. A page over it is asked for again
 * with `limit=SMALL_PAGE`: 20 things, or what one request changed when that
 * is more (the server never splits a revision, and a request holds at most
 * 200 operations in 8 MiB), which 64 MiB holds at 320 KB a thing. A mark at
 * every limit at once (comment, notes, 20 reopens, an older server's 20
 * findings, which are not read, in four-byte
 * characters) is about 2.5 MB; only a request that changed 26 or more such
 * marks at once makes a page that is not read, and that is said as the
 * server's trouble.
 */
export const MAX_JSON_BYTES = 64 * 1024 * 1024;
export const SMALL_PAGE = 20;

/** What an answer larger than it may be is refused with (`ApiFailure.code`). */
export const TOO_LARGE = "answer_too_large";

/** What a call to the server came to when it did not answer with what was asked. */
export class ApiFailure extends Error {
	override name = "ApiFailure";
	constructor(
		/**
		 * `offline`: no answer at all. `unauthorized`: the sign-in is over.
		 * `refused`: the server's no to this request (its `code` says why).
		 * `server`: it failed, or is busy; later may work.
		 */
		readonly kind: "offline" | "unauthorized" | "refused" | "server",
		message: string,
		readonly status?: number,
		readonly code?: string,
	) {
		super(message);
	}
}

/** The calls the extension makes. The engine gets this; tests give it a fake. */
export interface Api {
	me(): Promise<Me>;
	/**
	 * Everything after `since`; without it, the whole state. `limit`: at most
	 * so many things in this answer (the server's own number without it).
	 */
	changes(
		teamId: string,
		since: number | undefined,
		limit?: number,
	): Promise<Changes>;
	/** One case, whole, as the server has it now; none: the team has no such case. */
	getCase(teamId: string, caseId: string): Promise<CaseDetail | undefined>;
	/**
	 * The team's members, to assign a case to (DEC-071); none: the server
	 * does not offer them (one from before assignees).
	 */
	members(teamId: string): Promise<Member[] | undefined>;
	ops(teamId: string, ops: readonly Op[]): Promise<OpsResponse>;
	hasBlob(teamId: string, sha256: string): Promise<boolean>;
	putBlob(teamId: string, sha256: string, image: Blob): Promise<void>;
	getBlob(teamId: string, sha256: string): Promise<Blob>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpApiOptions {
	/** The server's origin. */
	server: string;
	/** An access token; `fresh`: a new one, the server refused the last. */
	token: (fresh: boolean) => Promise<string>;
	fetch?: Fetch;
}

const team = (id: string) => `/api/v1/teams/${encodeURIComponent(id)}`;

/** The address of a team's events stream (sse.ts listens to it). */
export const eventsUrl = (server: string, teamId: string) =>
	`${server}${team(teamId)}/events`;

/** The server's error body, as far as it has the known shape. */
async function refusal(response: Response): Promise<ApiFailure> {
	let code: string | undefined;
	let message: string | undefined;
	try {
		// An error is a few words: read as such, not whatever comes.
		const body = ((await readJson(response, MAX_SMALL_BYTES)) ?? {}) as {
			error?: { code?: unknown; message?: unknown };
		};
		if (typeof body.error?.code === "string") code = body.error.code;
		if (typeof body.error?.message === "string")
			message = body.error.message.slice(0, 500);
	} catch {
		// No JSON: the status says what there is to say.
	}
	const said = message ?? `The server answered ${response.status}.`;
	if (response.status === 401)
		return new ApiFailure("unauthorized", said, 401, code);
	// The team's storage is full (507, `quota`): a no to this image, not a
	// server that is down. Asking again changes nothing.
	if (response.status === 507 || code === "quota")
		return new ApiFailure("refused", said, response.status, code ?? "quota");
	if (response.status >= 500 || response.status === 429)
		return new ApiFailure("server", said, response.status, code);
	return new ApiFailure("refused", said, response.status, code);
}

/** The API over HTTP. A 401 is tried once more with a fresh token. */
export function httpApi(options: HttpApiOptions): Api {
	const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init));

	async function send(
		path: string,
		init: RequestInit,
		fresh: boolean,
	): Promise<Response> {
		let token: string;
		try {
			token = await options.token(fresh);
		} catch (error) {
			if (error instanceof OfflineError)
				throw new ApiFailure("offline", error.message);
			if (error instanceof AuthError)
				throw new ApiFailure(
					error.signedOut ? "unauthorized" : "server",
					error.message,
				);
			throw error;
		}
		try {
			return await fetcher(`${options.server}${path}`, {
				...init,
				cache: "no-store",
				// The chosen server answers, nobody it points at: a redirect
				// would carry the token, or bring back another site's content.
				redirect: "error",
				// The token says who is calling; the browser's cookies for the
				// server (the user's session there) stay out of it.
				credentials: "omit",
				headers: { ...init.headers, authorization: `Bearer ${token}` },
			});
		} catch (error) {
			throw new ApiFailure(
				"offline",
				`The server could not be reached${error instanceof Error && error.message ? ` (${error.message})` : ""}.`,
			);
		}
	}

	async function call(
		path: string,
		init: RequestInit = {},
		/** Statuses that are an answer, not a failure. */
		also: readonly number[] = [],
	): Promise<Response> {
		let response = await send(path, init, false);
		if (response.status === 401) response = await send(path, init, true);
		if (response.ok || also.includes(response.status)) return response;
		throw await refusal(response);
	}

	const json = async <T>(response: Response): Promise<T> => {
		const bytes = await bodyOf(response, MAX_JSON_BYTES);
		try {
			return JSON.parse(new TextDecoder().decode(bytes)) as T;
		} catch {
			throw new ApiFailure("server", "The server's answer could not be read.");
		}
	};

	return {
		me: async () => json<Me>(await call("/api/v1/me")),
		changes: async (teamId, since, limit) => {
			const query = new URLSearchParams();
			if (since !== undefined) query.set("since", String(since));
			if (limit !== undefined) query.set("limit", String(limit));
			const asked = query.size > 0 ? `?${query}` : "";
			return json<Changes>(await call(`${team(teamId)}/changes${asked}`));
		},
		async getCase(teamId, caseId) {
			const response = await call(
				`${team(teamId)}/cases/${encodeURIComponent(caseId)}`,
				{},
				[404],
			);
			return response.status === 404 ? undefined : json<CaseDetail>(response);
		},
		async members(teamId) {
			const response = await call(`${team(teamId)}/members`, {}, [404]);
			if (response.status === 404) return undefined;
			const { members } = await json<{ members?: unknown }>(response);
			return membersIn(members);
		},
		ops: async (teamId, ops) =>
			json<OpsResponse>(
				await call(`${team(teamId)}/ops`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ops }),
				}),
			),
		hasBlob: async (teamId, sha256) =>
			(await call(`${team(teamId)}/blobs/${sha256}`, { method: "HEAD" }, [404]))
				.ok,
		async putBlob(teamId, sha256, image) {
			await call(`${team(teamId)}/blobs/${sha256}`, {
				method: "PUT",
				headers: { "content-type": "image/webp" },
				body: image,
			});
		},
		async getBlob(teamId, sha256) {
			const response = await call(`${team(teamId)}/blobs/${sha256}`);
			const type = (response.headers.get("content-type") ?? "")
				.split(";")[0]
				?.trim()
				.toLowerCase();
			const bytes = await bodyOf(response, MAX_IMAGE_BYTES);
			return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: type ?? "" });
		},
	};
}

/**
 * The members as the server listed them, each with an id and a name within
 * what a case keeps of a person; anything else is left out.
 */
export function membersIn(value: unknown): Member[] {
	if (!Array.isArray(value)) return [];
	const out: Member[] = [];
	for (const m of value.slice(0, MAX_MEMBERS)) {
		if (typeof m !== "object" || m === null) continue;
		const { id, name } = m as { id?: unknown; name?: unknown };
		if (typeof id !== "string" || typeof name !== "string") continue;
		if (id === "" || id.length > 64) continue;
		out.push({ id, name: name.slice(0, 200) });
	}
	return out;
}

/** The most members a list keeps: a team larger than this is not listed whole. */
export const MAX_MEMBERS = 500;

/** An answer's body, read up to `max` bytes (body.ts), with what went wrong said as the API's. */
async function bodyOf(response: Response, max: number): Promise<Uint8Array> {
	try {
		return await readBody(response, max);
	} catch (error) {
		if (error instanceof TooLarge)
			throw new ApiFailure("server", error.message, response.status, TOO_LARGE);
		throw new ApiFailure(
			"offline",
			error instanceof Error ? error.message : String(error),
		);
	}
}

/** The SHA-256 of an image's bytes, in lowercase hex: its name at the server. */
export async function sha256Of(image: Blob): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		await image.arrayBuffer(),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
