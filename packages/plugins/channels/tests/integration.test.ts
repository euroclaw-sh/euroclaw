import { field } from "@euroclaw/contracts";
import { createStoredRedactor, noopDetector } from "@euroclaw/core";
import { memoryAdapter } from "@euroclaw/storage-core";
import { createPiiMappingStore } from "@euroclaw/storage-durable";
import type { wrapLanguageModel } from "ai";
import { createClaw, getEuroclawTables } from "euroclaw";
import { describe, expect, it } from "vitest";
import { channels, telegram } from "../src/index";

type V2Model = Parameters<typeof wrapLanguageModel>[0]["model"];

function textModel(text: string): V2Model {
	return {
		specificationVersion: "v2",
		provider: "mock",
		modelId: "mock",
		supportedUrls: {},
		doGenerate: async () => ({
			content: [{ type: "text", text }],
			finishReason: "stop",
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			warnings: [],
		}),
		doStream: async () => {
			throw new Error("stream not used");
		},
	};
}

function telegramChannels() {
	return channels([telegram({ tenantId: "tenant-1", client: fakeClient() })]);
}

function fakeClient() {
	return {
		getUpdates: async () => [],
		sendMessage: async () => ({}),
	};
}

describe("channels ↔ euroclaw integration", () => {
	it("collects the plugin's channel_endpoint table via getEuroclawTables", () => {
		const withPlugin = getEuroclawTables({ plugins: [telegramChannels()] });
		expect(withPlugin.channel_endpoint).toBeDefined();
		expect(withPlugin.channel_endpoint?.fields.cursor).toBeDefined();
		// conversation_binding stayed core (the `account` analog); claw is core too
		expect(withPlugin.conversation_binding).toBeDefined();
		expect(withPlugin.claw).toBeDefined();
	});

	it("does not put channel_endpoint in core — only the plugin brings it", () => {
		const core = getEuroclawTables({});
		expect(core.channel_endpoint).toBeUndefined();
		// the identity-mapping table remains core even with no channels plugin
		expect(core.conversation_binding).toBeDefined();
	});

	it("wires into createClaw without a core-column collision and exposes the endpoints api", async () => {
		const db = memoryAdapter();
		const claw = createClaw({
			database: db,
			model: textModel("done"),
			redactor: createStoredRedactor({
				detector: noopDetector,
				mappings: createPiiMappingStore(db),
			}),
			plugins: [telegramChannels()],
		});
		// the plugin api namespace is present (no getEuroclawTables collision at construction)
		expect(claw.api.channels.endpoints).toBeDefined();

		// register an endpoint at runtime through the public api, read it back
		const created = await claw.api.channels.endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "default",
			mode: "webhook",
		});
		expect(created).toMatchObject({ provider: "telegram", mode: "webhook" });
		expect(
			await claw.api.channels.endpoints.getByKey({
				provider: "telegram",
				tenantId: "tenant-1",
				endpointKey: "default",
			}),
		).toMatchObject({ id: created.id });
	});

	it("rejects two channels for the same provider — webhook dispatch is by provider", () => {
		expect(() =>
			channels([
				telegram({ tenantId: "tenant-a", client: fakeClient() }),
				// distinct endpointKey so the per-endpoint dedup can't fire first — this exercises the
				// provider-level guard (the second channel could never receive a webhook)
				telegram({
					tenantId: "tenant-b",
					endpointKey: "other",
					client: fakeClient(),
				}),
			]),
		).toThrow(/duplicate channel provider/);
	});

	it("rejects a plugin schema that redefines a core claw column at createClaw", () => {
		// sanity that the collision guard still fires for genuine core-column clashes
		expect(() =>
			createClaw({
				model: textModel("done"),
				plugins: [
					{
						id: "evil",
						schema: { claw: { fields: { status: field.string() } } },
					} as never,
				],
			}),
		).toThrow(/redefines core column/);
	});
});
