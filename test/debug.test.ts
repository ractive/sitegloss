import { expect, test } from "bun:test";
import { debugText } from "../src/lib/debug.ts";

test("a debug line carries no e-mail address and no token", () => {
	const text = debugText(
		new Error(
			"anna.muster@example.com: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc refused",
		),
	);
	expect(text).toBe("Error: <e-mail>: Bearer <…> refused");
});
