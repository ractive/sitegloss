/**
 * A page of the extension's own in a frame on a web page (DEC-064): the
 * comment field of the page's dialogs. What a person types, pastes or drops
 * in it stays in the extension's frame: the page's scripts see none of its
 * events and cannot reach into it (a closed shadow root holds the frame; the
 * frame is of another origin). The content script and the frame talk over a
 * MessageChannel handed to the frame once: a message to a frame's window is
 * not seen by the page, and nothing is ever posted to the page's window.
 *
 * The hello must come from the frame's parent window, carry one port, and
 * name the token the content script put in the frame's address fragment.
 * The page shares that parent window, so the source alone would not tell
 * them apart; the page cannot read the fragment (the frame is in a closed
 * shadow root, and another origin's address is not readable), so it cannot
 * name the token. One hello is taken; later ones are refused.
 */

export const FRAME_HELLO = "sitegloss:frame";

export interface Hello<T> {
	type: typeof FRAME_HELLO;
	token: string;
	init: T;
}

/** A random token for a frame's address fragment, and its first hello. */
export function frameToken(): string {
	return crypto.randomUUID();
}

/**
 * The port and the start of the content script's hello, when `e` is it:
 * from `parent`, with exactly one port, of this type, naming `token`.
 */
export function helloPort<T>(
	e: { source: unknown; ports: readonly MessagePort[]; data: unknown },
	parent: unknown,
	token: string,
): { port: MessagePort; init: T } | undefined {
	const data = e.data as Partial<Hello<T>> | undefined;
	const [port] = e.ports;
	if (
		token === "" ||
		e.source !== parent ||
		e.ports.length !== 1 ||
		port === undefined ||
		data?.type !== FRAME_HELLO ||
		data.token !== token
	)
		return undefined;
	return { port, init: data.init as T };
}

/** In the frame: the port and what to show, handed over by the content script, once. */
export function framePort<T>(): Promise<{ port: MessagePort; init: T }> {
	const token = location.hash.slice(1);
	return new Promise((resolve) => {
		const on = (e: MessageEvent) => {
			const hello = helloPort<T>(e, window.parent, token);
			if (hello === undefined) return;
			removeEventListener("message", on);
			resolve(hello);
		};
		addEventListener("message", on);
	});
}

/** The extension's own origin, which a frame's window is posted to and nothing else. */
export function extensionOrigin(): string {
	return new URL(chrome.runtime.getURL("")).origin;
}

/**
 * From the content script: hand a frame that loaded its port. Posted to the
 * frame's window and the extension's origin only: were the frame navigated
 * to anything else, nothing is delivered.
 */
export function handPort<T>(
	frame: HTMLIFrameElement,
	token: string,
	init: T,
): MessagePort {
	const channel = new MessageChannel();
	frame.contentWindow?.postMessage(
		{ type: FRAME_HELLO, token, init } satisfies Hello<T>,
		extensionOrigin(),
		[channel.port2],
	);
	return channel.port1;
}
