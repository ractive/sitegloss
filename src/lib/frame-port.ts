/**
 * A page of the extension's own in a frame on a web page (DEC-064): the
 * comment field of the page's dialogs and the picture viewer. What a person
 * types, pastes or drops in it, and the pictures it shows, stay in the
 * extension's frame: the page's scripts see none of its events and cannot
 * reach into it (a closed shadow root holds the frame; the frame is of
 * another origin). The content script and the frame talk over a
 * MessageChannel handed to the frame once: a message to a frame's window is
 * not seen by the page, and nothing is ever posted to the page's window.
 */

export const FRAME_HELLO = "sitegloss:frame";

interface Hello<T> {
	type: typeof FRAME_HELLO;
	init: T;
}

/** In the frame: the port and what to show, handed over by the content script, once. */
export function framePort<T>(): Promise<{ port: MessagePort; init: T }> {
	return new Promise((resolve) => {
		const on = (e: MessageEvent) => {
			const data = e.data as Partial<Hello<T>> | undefined;
			const [port] = e.ports;
			if (
				e.source !== window.parent ||
				port === undefined ||
				data?.type !== FRAME_HELLO
			)
				return;
			removeEventListener("message", on);
			resolve({ port, init: data.init as T });
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
export function handPort<T>(frame: HTMLIFrameElement, init: T): MessagePort {
	const channel = new MessageChannel();
	frame.contentWindow?.postMessage(
		{ type: FRAME_HELLO, init } satisfies Hello<T>,
		extensionOrigin(),
		[channel.port2],
	);
	return channel.port1;
}
