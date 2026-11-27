import { describe, expect, test } from "bun:test";
import { SERVER_HELP, serverPointer } from "../src/sidepanel/server-mcp.ts";
import { initialState, type PanelState } from "../src/sidepanel/state.ts";

type Cloud = PanelState["cloud"];

const signedIn = (slug?: string): Cloud => ({
	...initialState().cloud,
	account: {
		name: "Tess",
		email: "tess@example.com",
		userId: "u_tess",
		server: "https://app.sitegloss.dev",
		teams: [
			{
				id: "t_1",
				name: "Pedal & Pine",
				...(slug === undefined ? {} : { slug }),
				permissions: [],
			},
		],
		teamId: "t_1",
		expired: false,
	},
});

describe("the pointer to the server's MCP", () => {
	test("a team with a slug: its guide on its server", () => {
		const p = serverPointer(signedIn("pedal pine"));
		expect(p.href).toBe("https://app.sitegloss.dev/t/pedal%20pine/ai");
		expect(p.text).toContain("the MCP server at app.sitegloss.dev instead: ");
	});

	test("not signed in, or no slug known: the public help", () => {
		for (const cloud of [initialState().cloud, signedIn()]) {
			const p = serverPointer(cloud);
			expect(p.href).toBe(SERVER_HELP);
			expect(p.text).toEndWith("instead; that needs a Sitegloss account: ");
		}
	});
});
