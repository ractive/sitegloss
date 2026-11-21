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

/** A value made only of these, 40 characters or more, is a long opaque value. */
const OPAQUE = /^[A-Za-z0-9_\-.~+/=]{40,}$/;
/** A JWT: `eyJ` (a JSON header in base64url), then two dots. */
const JWT = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\./;

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
 * or a digit, between an upper-case run and an upper-case letter followed by
 * a lower-case one, then at every character that is no ASCII letter or
 * digit; lowercased.
 */
export function nameWords(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word !== "")
		.map((word) => word.toLowerCase());
}

const saysSecret = (name: string): boolean => {
	const words = nameWords(name);
	return words.some((word) => WORDS.has(word)) || NAMES.has(words.join(""));
};

/** An e-mail address, a JWT, a long opaque value. */
const looksSecret = (text: string): boolean =>
	text.includes("@") || JWT.test(text) || OPAQUE.test(text);

/** Whether a piece `name=value` of a query is kept. */
function keptPiece(piece: string): boolean {
	// A raw `#` would end the query when the address is opened.
	if (piece.includes("#")) return false;
	const at = piece.indexOf("=");
	const name = decoded(at < 0 ? piece : piece.slice(0, at));
	const value = at < 0 ? "" : decoded(piece.slice(at + 1));
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
 * short opens another page than the one marked. Never throws.
 */
export function keptQuery(search: string): string {
	try {
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
 * (`https://app.example/?tab=2#/list`). An address with a query already
 * stays as it is.
 */
export function withQuery(plain: string, query: string | undefined): string {
	if (query === undefined || query === "") return plain;
	const hash = plain.indexOf("#");
	const base = hash < 0 ? plain : plain.slice(0, hash);
	if (base.includes("?")) return plain;
	return `${base}?${query}${hash < 0 ? "" : plain.slice(hash)}`;
}
