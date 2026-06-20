import { describe, expect, it } from "vitest";
import { createClaw } from "../src/index";
import { durableRedactor, textModel } from "./fixtures";

describe("createClaw channel endpoints", () => {
	it("stores channel endpoint status and cursor through the public API", async () => {
		const { db, redactor } = durableRedactor();
		const claw = createClaw({
			database: db,
			model: textModel("done"),
			redactor,
		});

		const endpoint = await claw.api.upsertChannelEndpoint({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "default",
			mode: "poll",
			cursor: { offset: 100 },
		});
		const updated = await claw.api.updateChannelEndpoint({
			provider: "telegram",
			tenantId: "tenant-1",
			endpointKey: "default",
			patch: {
				status: "validated",
				cursor: { offset: 101 },
				lastPolledAt: "2026-01-01T00:01:00.000Z",
			},
		});

		expect(endpoint).toMatchObject({
			mode: "poll",
			status: "pending",
			cursor: { offset: 100 },
		});
		expect(updated).toMatchObject({
			id: endpoint.id,
			status: "validated",
			cursor: { offset: 101 },
		});
		await expect(
			claw.api.getChannelEndpoint({
				provider: "telegram",
				tenantId: "tenant-1",
				endpointKey: "default",
			}),
		).resolves.toEqual(updated);
	});
});
