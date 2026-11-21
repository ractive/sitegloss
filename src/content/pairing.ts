/**
 * The relay's pairing page (DEC-044): put in by the worker
 * (`scripting.executeScript`, top frame only) when a tab finished loading
 * the relay's `/authorize` while "Fill in the code for me" is on and AI
 * access is connected. The library's content script (tab-mcp's DEC-206)
 * reads the form's hooks, tells the worker who asks over a port of its own,
 * and fills in only the code the worker sends back with this page load's
 * nonce, after the user's yes. Once per document.
 */

import {
	PAIRING_PORT,
	runPairingPage,
} from "@ractive-ch/tab-mcp-client/extension";
import { APP_ID } from "../worker/protocol.ts";

runPairingPage({
	app: APP_ID,
	connect: () => chrome.runtime.connect({ name: PAIRING_PORT }),
});
