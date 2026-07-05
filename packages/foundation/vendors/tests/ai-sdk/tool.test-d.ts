import type { ToolGovernance } from "@euroclaw/contracts";
import { jsonSchema } from "ai";
import { describe, expectTypeOf, it } from "vitest";
import { tool } from "../../src/ai-sdk/index";

const idSchema = jsonSchema<{ id: string }>({
	type: "object",
	properties: { id: { type: "string" } },
	required: ["id"],
});

describe("tool() type inference", () => {
	it("infers execute args from the inputSchema (the AI-SDK linkage survives the stamp)", () => {
		tool({
			description: "refund",
			inputSchema: jsonSchema<{ amount: number; to: string }>({
				type: "object",
				properties: { amount: { type: "number" }, to: { type: "string" } },
				required: ["amount", "to"],
			}),
			execute: async (args) => {
				expectTypeOf(args).toEqualTypeOf<{ amount: number; to: string }>();
				return { ok: true };
			},
			access: "write",
		});
	});

	it("the return carries a typed stamp; the facts are closed unions", () => {
		const t = tool({
			description: "read",
			inputSchema: idSchema,
			execute: async () => 0,
			access: "read",
		});
		expectTypeOf(t.euroclaw).toEqualTypeOf<ToolGovernance>();
		// the facts are closed unions on the contract — a typo'd access cannot compile
		expectTypeOf<ToolGovernance["access"]>().toEqualTypeOf<
			"read" | "write" | undefined
		>();
	});
});

describe("standardSchema type inference", () => {
	it("tool() infers execute args from an arktype schema through the bridge", async () => {
		const { standardSchema } = await import("../../src/ai-sdk/index");
		const { type } = await import("arktype");
		tool({
			description: "refund",
			inputSchema: standardSchema(type({ amount: "number", to: "string" })),
			execute: async (args) => {
				expectTypeOf(args).toEqualTypeOf<{ amount: number; to: string }>();
				return { ok: true };
			},
			access: "write",
		});
	});
});

describe("direct arktype inputSchema inference", () => {
	it("tool() infers execute args from a bare arktype Type", async () => {
		const { type } = await import("arktype");
		tool({
			description: "refund",
			inputSchema: type({ amount: "number", to: "string" }),
			execute: async (args) => {
				expectTypeOf(args).toEqualTypeOf<{ amount: number; to: string }>();
				return { ok: true };
			},
			access: "write",
		});
	});
});

describe("AuthoredTool assignability", () => {
	it("what tool() returns drops into an AI-SDK ToolSet", async () => {
		const { jsonSchema } = await import("ai");
		const t = tool({
			description: "read",
			inputSchema: jsonSchema<{ id: string }>({ type: "object" }),
			execute: async () => 0,
			access: "read",
		});
		expectTypeOf(t).toExtend<import("ai").Tool>();
	});
});
