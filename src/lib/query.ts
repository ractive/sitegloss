/**
 * A screenshot's query (DEC-050): what is kept of an address's query string,
 * so that the page a mark was made on can be opened again as it was (a
 * result list, a filtered table). It takes no part in which page an address
 * is (`pageKey`, `pathKey`): that is the plain address alone.
 *
 * `keptQuery` is sitegloss.dev's function (`packages/api/src/v1/query.ts`,
 * its DEC-023), and has to stay it: the server runs it again on what comes
 * in, and `test/kept-query.json` is a copy of the server's vectors, its word
 * lists with them, that this one has to pass. The server's lists are the
 * reference.
 */

/** The longest query kept, in code points. A longer one is dropped whole, never cut. */
export const MAX_QUERY = 1024;

/**
 * The longest `search` looked at, in UTF-16 units: the most a whole address
 * may hold (`MAX_URL`). A longer one gives "" before anything is parsed.
 */
export const QUERY_INPUT_LIMIT = 8000;

/** How many times a value is percent-decoded for the tests on it: `%2540` is an `@` too. */
const DECODE_ROUNDS = 3;

/** A piece is dropped when one of its name's words is one of these. */
export const SECRET_WORDS: readonly string[] = [
	"token",
	"tokens",
	"secret",
	"password",
	"passwd",
	"passcode",
	"passphrase",
	"pwd",
	"pw",
	"pass",
	"session",
	"sid",
	"sessid",
	"signature",
	"sig",
	"key",
	"auth",
	"authorization",
	"bearer",
	"code",
	"otp",
	"nonce",
	"state",
	"jwt",
	"credential",
	"credentials",
	"ticket",
	"assertion",
	"saml",
	"hmac",
	"csrf",
	"xsrf",
	"verifier",
	"cookie",
	"email",
	"mail",
];

/** A piece is dropped when its name's words, joined, are one of these. */
export const SECRET_NAMES: readonly string[] = [
	"apikey",
	"accesstoken",
	"refreshtoken",
	"idtoken",
	"sessionid",
	"phpsessid",
	"jsessionid",
	"aspsessionid",
	"samlresponse",
	"samlrequest",
	"authtoken",
	"apitoken",
	"sessiontoken",
	"csrftoken",
	"xsrftoken",
	"csrfmiddlewaretoken",
	"authkey",
	"accesskey",
	"secretkey",
	"privatekey",
	"sessionkey",
	"clientsecret",
	"apisecret",
	"oauthtoken",
	"oauthverifier",
];

const WORDS = new Set(SECRET_WORDS);
const NAMES = new Set(SECRET_NAMES);

// Every expression here runs in linear time on any input: anchored, of a
// fixed width, or one class repeated with nothing after it to backtrack into.

/** A value made only of these, 40 characters or more, is a long opaque value. */
const OPAQUE = /^[A-Za-z0-9_\-.~+/=]{40,}$/;
/** The runs of characters a JWT is made of (base64url and its dots). */
const RUNS = /[A-Za-z0-9_.-]+/g;

/** The length of `text` in code points. */
function codePoints(text: string): number {
	let n = 0;
	for (const _ of text) n++;
	return n;
}

/** Percent-decoded with `+` a space; undefined for a malformed escape. */
function decoded(text: string): string | undefined {
	try {
		return decodeURIComponent(text.replaceAll("+", " "));
	} catch {
		return undefined;
	}
}

/**
 * A name's words: split before an upper-case letter after a lower-case one
 * or a digit, and after an upper-case letter followed by an upper-case and a
 * lower-case one (`APIKey`), then at every character that is no ASCII letter
 * or digit; lowercased.
 */
export function nameWords(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z])(?=[A-Z][a-z])/g, "$1 ")
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word !== "")
		.map((word) => word.toLowerCase());
}

const saysSecret = (name: string): boolean => {
	const words = nameWords(name);
	return words.some((word) => WORDS.has(word)) || NAMES.has(words.join(""));
};

/**
 * A JWT: `eyJ` (a JSON header in base64url), then two dots, within one run
 * of base64url characters and dots. Each run is looked at once, from its
 * first `eyJ`, which has the most after it.
 */
function holdsJwt(text: string): boolean {
	for (const run of text.match(RUNS) ?? []) {
		const at = run.indexOf("eyJ");
		if (at < 0) continue;
		let dots = 0;
		for (let i = at + 3; i < run.length && dots < 2; i++)
			if (run[i] === ".") dots++;
		if (dots >= 2) return true;
	}
	return false;
}

/** An e-mail address, a JWT, a long opaque value. */
const looksSecretOnce = (text: string): boolean =>
	text.includes("@") || holdsJwt(text) || OPAQUE.test(text);

/**
 * The tests on a decoded text, and on it decoded again, up to
 * `DECODE_ROUNDS` in all: a round that changes nothing, or fails, ends them.
 */
function looksSecret(once: string): boolean {
	let text = once;
	for (let round = 1; round <= DECODE_ROUNDS; round++) {
		if (looksSecretOnce(text)) return true;
		if (round === DECODE_ROUNDS) break;
		const next = decoded(text);
		if (next === undefined || next === text) break;
		text = next;
	}
	return false;
}

/** Whether a piece `name=value` of a query is kept. */
function keptPiece(piece: string): boolean {
	// A raw `#` would end the query when the address is opened.
	if (piece.includes("#")) return false;
	const at = piece.indexOf("=");
	const name = decoded(at < 0 ? piece : piece.slice(0, at));
	const value = at < 0 ? "" : decoded(piece.slice(at + 1));
	// Malformed only when the first decoding fails; later rounds just end.
	if (name === undefined || value === undefined) return false;
	// A piece without `=` is a name alone, which can be a token itself.
	return !saysSecret(name) && !looksSecret(name) && !looksSecret(value);
}

/**
 * What is kept of a query: `search` without its leading `?`s, the pieces
 * whose name says secret (`token`, `apiKey`, `countryCode`: the word
 * `code`) or whose name or value looks like one (an `@`, a JWT, a long
 * opaque value) dropped, and those with a malformed escape; the rest as
 * they are, byte for byte, in their order. Empty when nothing is kept, and
 * when what is kept is longer than `MAX_QUERY` code points: a query cut
 * short opens another page than the one marked. A `search` longer than
 * `QUERY_INPUT_LIMIT` gives "" at once. Linear in its length; never throws.
 */
export function keptQuery(search: string): string {
	try {
		if (search.length > QUERY_INPUT_LIMIT) return "";
		const kept = search
			.replace(/^\?+/, "")
			.split("&")
			.filter((piece) => piece !== "" && keptPiece(piece))
			.join("&");
		return codePoints(kept) > MAX_QUERY ? "" : kept;
	} catch {
		return "";
	}
}

/**
 * What a screenshot keeps of a query it is given (a file's, the server's):
 * `keptQuery` of it again; none when that is empty, or it is no text.
 */
export function storedQuery(query: unknown): string | undefined {
	if (typeof query !== "string") return undefined;
	const kept = keptQuery(query);
	return kept === "" ? undefined : kept;
}

/** What a screenshot of the page at `href` keeps of its query (`storedQuery`). */
export function queryOf(href: string): string | undefined {
	let search: string;
	try {
		search = new URL(href).search;
	} catch {
		return undefined;
	}
	return storedQuery(search);
}

/**
 * A plain address (`plainUrl`) with a kept query, to open the page as it
 * was: `https://shop.example/search?q=shoes`, before a hash route
 * (`https://app.example/?tab=2#/list`). As the server's `withQuery`: an
 * address with a query of its own gets the kept one after it, with `&`.
 */
export function withQuery(plain: string, query: string | undefined): string {
	if (query === undefined || query === "") return plain;
	const hash = plain.indexOf("#");
	const base = hash < 0 ? plain : plain.slice(0, hash);
	const rest = hash < 0 ? "" : plain.slice(hash);
	if (base.endsWith("?") || base.endsWith("&")) return `${base}${query}${rest}`;
	return `${base}${base.includes("?") ? "&" : "?"}${query}${rest}`;
}
