import { memoryAdapter } from "@euroclaw/storage-core";
import { describe, expect, it } from "vitest";
import { createChannelEndpointsStore } from "../src/index";

function store(now = () => "2026-01-01T00:00:00.000Z") {
	return createChannelEndpointsStore(memoryAdapter(), { now });
}

describe("createChannelEndpointsStore", () => {
	it("upserts, reads back, and updates channel endpoint state", async () => {
		const endpoints = store();
		const endpoint = await endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "default",
			mode: "poll",
			cursor: { offset: 10 },
		});

		expect(endpoint).toMatchObject({
			provider: "telegram",
			mode: "poll",
			status: "pending",
			cursor: { offset: 10 },
		});
		await expect(
			endpoints.getByKey({
				provider: "telegram",
				tenantId: "tenant-1",
				endpointKey: "default",
			}),
		).resolves.toEqual(endpoint);

		const updated = await endpoints.updateByKey({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "default",
			patch: { status: "validated", cursor: { offset: 12 } },
		});
		expect(updated).toMatchObject({
			status: "validated",
			cursor: { offset: 12 },
		});
		// upsert on an existing key updates in place, not a second row
		expect(await endpoints.get(endpoint.id)).toMatchObject({
			status: "validated",
		});
	});

	it("persists the credentials and cursor as real columns (queryable, not a JSON blob)", async () => {
		const adapter = memoryAdapter();
		const endpoints = createChannelEndpointsStore(adapter, {
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const created = await endpoints.create({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "main",
			mode: "webhook",
			secret: "bot-token-123",
			webhookSecret: "inbound-456",
		});
		const raw = await adapter.findOne<Record<string, unknown>>({
			model: "channel_endpoint",
			where: [{ field: "id", value: created.id }],
		});
		// both credentials round-trip as real columns (sso model — stored in the row, read back)
		expect(raw?.secret).toBe("bot-token-123");
		expect(raw?.webhookSecret).toBe("inbound-456");
		expect(raw?.mode).toBe("webhook");
	});

	it("derives the id from the natural key — upserts of the same key converge on one row", async () => {
		const endpoints = store();
		const first = await endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "bot-a",
			mode: "poll",
		});
		const second = await endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "bot-a",
			mode: "poll",
			status: "validated",
		});
		// same natural key -> same primary key -> one row, updated in place
		expect(second.id).toBe(first.id);
		expect(await endpoints.list()).toHaveLength(1);

		// a different key member -> a different id
		const other = await endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-2",
			endpointKey: "bot-a",
			mode: "poll",
		});
		expect(other.id).not.toBe(first.id);
	});

	it("lists endpoints by filter — the poll cron's fan-out", async () => {
		const endpoints = store();
		await endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "poller",
			mode: "poll",
			status: "validated",
		});
		await endpoints.upsert({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "hooker",
			mode: "webhook",
			status: "validated",
		});
		await endpoints.upsert({
			provider: "slack",
			tenantId: "tenant-1",
			endpointKey: "poller",
			mode: "poll",
			status: "validated",
		});

		const telegramPollers = await endpoints.list({
			provider: "telegram",
			mode: "poll",
		});
		expect(telegramPollers.map((e) => e.endpointKey)).toEqual(["poller"]);

		const allPollers = await endpoints.list({ mode: "poll" });
		expect(allPollers.length).toBe(2);

		expect((await endpoints.list()).length).toBe(3);
	});

	it("rejects malformed create input at the write boundary", async () => {
		const endpoints = store();
		await expect(
			// missing required provider/tenantId/endpointKey/mode
			endpoints.create({ endpointKey: "x" } as never),
		).rejects.toThrow(/create channel endpoint input invalid/);
	});
});
