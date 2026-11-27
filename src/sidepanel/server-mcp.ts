/**
 * The way to the service's own MCP server, for an AI app that only needs the
 * cases: the AI app card connects one to the extension in this browser, the
 * web app's page "Connect your AI app" (`/t/<slug>/ai`) to the server.
 * Without a team's address (not signed in, or a server before slugs) the
 * public help says how.
 */

import { hostOf, teamOf } from "./cloud-view.ts";
import { byId, h } from "./dom.ts";
import type { PanelState } from "./state.ts";

type Cloud = PanelState["cloud"];

/** The public help's part on the MCP server. */
export const SERVER_HELP = "https://sitegloss.dev/help/#server";

/** The team's page in the web app on connecting an AI app to the server. */
export function aiGuideAddress(server: string, slug: string): string {
	return new URL(`/t/${encodeURIComponent(slug)}/ai`, server).href;
}

/** The team's guide, with the server it is on; none without a team's slug. */
export function teamGuide(
	cloud: Cloud,
): { href: string; host: string } | undefined {
	const account = cloud.account;
	const slug = teamOf(cloud)?.slug;
	if (account === undefined || slug === undefined) return undefined;
	return {
		href: aiGuideAddress(account.server, slug),
		host: hostOf(account.server),
	};
}

/** What the card says of the server, and where its link leads. */
export function serverPointer(cloud: Cloud): { text: string; href: string } {
	const lead =
		"This card connects an AI app to the extension in this browser. If it only needs the cases, connect it to the MCP server";
	const guide = teamGuide(cloud);
	return guide === undefined
		? {
				text: `${lead} instead; that needs a Sitegloss account: `,
				href: SERVER_HELP,
			}
		: { text: `${lead} at ${guide.host} instead: `, href: guide.href };
}

/** The paragraph in the AI app card, drawn again only when it changed. */
export function renderServerPointer({ cloud }: PanelState): void {
	const p = byId<HTMLElement>("ai-server");
	const { text, href } = serverPointer(cloud);
	const key = `${text}\n${href}`;
	if (p.dataset["key"] === key) return;
	p.dataset["key"] = key;
	p.replaceChildren(
		text,
		h(
			"a",
			{
				id: "ai-server-link",
				href,
				target: "_blank",
				rel: "noopener noreferrer",
			},
			"How to connect it",
		),
	);
}
