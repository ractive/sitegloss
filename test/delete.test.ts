import { expect, test } from "bun:test";
import {
	DELETE_ARMED_MS,
	DELETE_CLICK_GAP_MS,
	deleteClick,
} from "../src/sidepanel/delete.ts";

test("Delete asks twice: the first click arms it, a double click's second does nothing, a second click after that deletes", () => {
	expect(deleteClick(undefined, 5000)).toBe("arm");
	expect(deleteClick(5000, 5000 + 120)).toBe("nothing");
	expect(deleteClick(5000, 5000 + DELETE_CLICK_GAP_MS - 1)).toBe("nothing");
	expect(deleteClick(5000, 5000 + DELETE_CLICK_GAP_MS)).toBe("delete");
	expect(deleteClick(5000, 5000 + DELETE_ARMED_MS - 1)).toBe("delete");
});

test("Delete disarms by itself: a click much later only asks again", () => {
	expect(deleteClick(5000, 5000 + DELETE_ARMED_MS)).toBe("arm");
	expect(deleteClick(5000, 5000 + 60_000)).toBe("arm");
});
