import { type } from "arktype";
import { describe, expect, it } from "vitest";
import { event } from "../src/events";

describe("event base contract", () => {
	it("accepts any object carrying a string type, preserving extra fields", () => {
		const valid = event({ type: "skill.created", skillId: "s1", count: 3 });
		expect(valid).not.toBeInstanceOf(type.errors);
		expect(valid).toMatchObject({
			type: "skill.created",
			skillId: "s1",
			count: 3,
		});
	});

	it("rejects an event with no type", () => {
		const result = event({ skillId: "s1" });
		expect(result).toBeInstanceOf(type.errors);
	});

	it("rejects a non-string type", () => {
		const result = event({ type: 42 });
		expect(result).toBeInstanceOf(type.errors);
	});
});
