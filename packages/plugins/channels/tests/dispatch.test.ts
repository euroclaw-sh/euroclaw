import { memoryAdapter } from "@euroclaw/storage-core";
import type { Claw } from "euroclaw";
import { describe, expect, it } from "vitest";
import {
	type Channel,
	createChannelEndpointsStore,
	dispatchWebhook,
	pollChannel,
} from "../src/index";

// A fake claw whose api records what the engine relays and always replies with an echo. Enough to
// exercise the shared bind -> relay -> reply -> persist path without the full assembly.
function fakeClaw(relayed: string[]) {
	return {
		api: {
			bindConversation: async () => ({
				binding: { id: "binding-1" },
				claw: { id: "claw-1" },
				thread: { id: "thread-1" },
				created: true,
			}),
			sendMessage: async (input: { message: string }) => {
				relayed.push(input.message);
				return {
					result: { status: "completed", text: `echo:${input.message}` },
					userMessage: { id: "message-1" },
				};
			},
		},
	} as unknown as Claw;
}

function fakeChannel(overrides: Partial<Channel> = {}): Channel {
	return {
		provider: "fake",
		tenantId: "tenant-1",
		supports: { webhook: true, poll: true },
		codeEndpoints: [{ key: "default", mode: "webhook" }],
		parseInbound: ({ request }) => [
			{ externalConversationId: "chat-1", text: request.rawBody },
		],
		send: async () => {},
		...overrides,
	};
}

const now = () => "2026-01-01T00:00:00.000Z";

describe("dispatch engine", () => {
	it("dispatches a webhook: verify -> parse -> bind -> relay -> reply -> persist", async () => {
		const relayed: string[] = [];
		const replies: string[] = [];
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		const channel = fakeChannel({
			send: async ({ message }) => {
				replies.push(message.text);
			},
		});

		const result = await dispatchWebhook({
			claw: fakeClaw(relayed),
			channel,
			store,
			endpointKey: "default",
			request: { headers: { get: () => null }, rawBody: "hello" },
			now,
		});

		expect(result.status).toBe(200);
		expect(relayed).toEqual(["hello"]); // message reached the claw
		expect(replies).toEqual(["echo:hello"]); // the run's text was sent back
		// endpoint marked received
		const endpoint = await store.getByKey({
			provider: "fake",
			tenantId: "tenant-1",
			endpointKey: "default",
		});
		expect(endpoint).toMatchObject({ status: "validated", mode: "webhook" });
	});

	it("returns 401 and does not dispatch when verify fails", async () => {
		const relayed: string[] = [];
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		const channel = fakeChannel({ verify: () => false });

		const result = await dispatchWebhook({
			claw: fakeClaw(relayed),
			channel,
			store,
			endpointKey: "default",
			request: { headers: { get: () => null }, rawBody: "hello" },
			now,
		});

		expect(result.status).toBe(401);
		expect(relayed).toEqual([]);
	});

	it("never rewrites a registered endpoint's mode from dispatch bookkeeping", async () => {
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		// registered as a poll endpoint; a webhook POST must not flip it out of the poll fan-out
		await store.upsert({
			provider: "fake",
			tenantId: "tenant-1",
			endpointKey: "default",
			mode: "poll",
			status: "validated",
		});

		const result = await dispatchWebhook({
			claw: fakeClaw([]),
			channel: fakeChannel(),
			store,
			endpointKey: "default",
			request: { headers: { get: () => null }, rawBody: "hello" },
			now,
		});

		expect(result.status).toBe(200);
		const endpoint = await store.getByKey({
			provider: "fake",
			tenantId: "tenant-1",
			endpointKey: "default",
		});
		expect(endpoint?.mode).toBe("poll"); // bookkeeping patched state, not the transport
		expect(endpoint?.lastReceivedAt).toBe(now());
	});

	it("returns 404 for an endpoint that is neither declared in code nor in the database", async () => {
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		const result = await dispatchWebhook({
			claw: fakeClaw([]),
			channel: fakeChannel(),
			store,
			endpointKey: "nonexistent",
			request: { headers: { get: () => null }, rawBody: "hello" },
			now,
		});
		expect(result.status).toBe(404);
	});

	it("polls a code endpoint, relays messages, and advances the persisted cursor", async () => {
		const relayed: string[] = [];
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		let polls = 0;
		const channel = fakeChannel({
			codeEndpoints: [{ key: "poller", mode: "poll" }],
			poll: async ({ cursor }) => {
				polls += 1;
				const offset = (cursor as { offset?: number } | undefined)?.offset ?? 0;
				return {
					messages:
						offset === 0
							? [{ externalConversationId: "chat-1", text: "polled" }]
							: [],
					cursor: { offset: offset + 1 },
				};
			},
		});

		const first = await pollChannel({
			claw: fakeClaw(relayed),
			channel,
			store,
			now,
		});
		expect(first.processed).toBe(1);
		expect(relayed).toEqual(["polled"]);
		const endpoint = await store.getByKey({
			provider: "fake",
			tenantId: "tenant-1",
			endpointKey: "poller",
		});
		expect(endpoint).toMatchObject({
			status: "validated",
			cursor: { offset: 1 },
		});

		// second poll resumes from the persisted cursor -> no new messages
		const second = await pollChannel({
			claw: fakeClaw(relayed),
			channel,
			store,
			now,
		});
		expect(second.processed).toBe(0);
		expect(polls).toBe(2);
	});

	it("marks the endpoint errored and rethrows when a poll fails", async () => {
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		const channel = fakeChannel({
			codeEndpoints: [{ key: "poller", mode: "poll" }],
			poll: async () => {
				throw new Error("provider down");
			},
		});
		await expect(
			pollChannel({ claw: fakeClaw([]), channel, store, now }),
		).rejects.toThrow(/provider down/);
		const endpoint = await store.getByKey({
			provider: "fake",
			tenantId: "tenant-1",
			endpointKey: "poller",
		});
		expect(endpoint).toMatchObject({ status: "error" });
	});

	it("polls a database-registered endpoint, reading its credential from the row", async () => {
		const store = createChannelEndpointsStore(memoryAdapter(), { now });
		// register a poll endpoint at runtime with its credential in the row (the sso model) — no code
		// declaration for this key
		await store.upsert({
			provider: "fake",
			tenantId: "tenant-1",
			endpointKey: "db-bot",
			mode: "poll",
			status: "validated",
			secret: "bot-token-abc",
		});
		const seenSecrets: Array<string | undefined> = [];
		const relayed: string[] = [];
		const channel = fakeChannel({
			codeEndpoints: [], // purely database-driven
			poll: async ({ endpoint }) => {
				seenSecrets.push(endpoint.record?.secret);
				return {
					messages: [{ externalConversationId: "chat-1", text: "from-db" }],
					cursor: { offset: 1 },
				};
			},
		});

		const result = await pollChannel({
			claw: fakeClaw(relayed),
			channel,
			store,
			now,
		});

		expect(result.processed).toBe(1);
		expect(relayed).toEqual(["from-db"]);
		// the channel read the credential straight off the endpoint row
		expect(seenSecrets).toEqual(["bot-token-abc"]);
	});
});
