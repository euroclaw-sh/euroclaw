import type { Claw } from "euroclaw";
import { describe, expect, it } from "vitest";
import {
	dispatchWebhook,
	type EndpointContext,
	type EndpointEvent,
} from "../src/index";
import { type TelegramClient, telegram } from "../src/telegram/index";

const endpoint: EndpointContext = {
	provider: "telegram",
	endpointKey: "default",
	mode: "webhook",
};

function fakeTelegramClient(): TelegramClient & {
	sent: Array<{
		chatId: string | number;
		text: string;
		replyToMessageId?: number;
	}>;
	updates: unknown[];
} {
	const sent: Array<{
		chatId: string | number;
		text: string;
		replyToMessageId?: number;
	}> = [];
	const client = {
		sent,
		updates: [] as unknown[],
		getUpdates: async () => client.updates,
		sendMessage: async (input: {
			chatId: string | number;
			text: string;
			replyToMessageId?: number;
		}) => {
			sent.push(input);
			return {};
		},
	};
	return client;
}

function update(overrides: Record<string, unknown> = {}) {
	return {
		update_id: 10,
		message: { message_id: 1, text: "hello", chat: { id: 123 }, ...overrides },
	};
}

describe("telegram channel", () => {
	it("parses a text update into a normalized inbound message", () => {
		const channel = telegram({ client: fakeTelegramClient() });
		const messages = channel.parseInbound({
			request: {
				headers: { get: () => null },
				rawBody: JSON.stringify(update()),
			},
			endpoint,
		});
		expect(messages).toEqual([
			{
				externalConversationId: "123",
				externalActorId: undefined,
				text: "hello",
				conversationTitle: undefined,
				replyContext: { messageId: 1 },
			},
		]);
	});

	it("ignores updates without a text message", () => {
		const channel = telegram({ client: fakeTelegramClient() });
		const noText = channel.parseInbound({
			request: {
				headers: { get: () => null },
				rawBody: JSON.stringify({
					update_id: 11,
					message: { chat: { id: 1 } },
				}),
			},
			endpoint,
		});
		expect(noText).toEqual([]);
	});

	it("rejects a non-JSON webhook body as a validation error, not a crash", () => {
		const channel = telegram({ client: fakeTelegramClient() });
		expect(() =>
			channel.parseInbound({
				request: { headers: { get: () => null }, rawBody: "not-json{" },
				endpoint,
			}),
		).toThrow(/invalid JSON/);
	});

	it("enforces the secret-token header when a code secret is set", () => {
		const channel = telegram({
			client: fakeTelegramClient(),
			webhook: { secret: "s3cret" },
		});
		const headers = (value: string | null) => ({
			request: { headers: { get: () => value }, rawBody: "{}" },
			endpoint,
		});
		expect(channel.verify?.(headers("s3cret"))).toBe(true);
		expect(channel.verify?.(headers("wrong"))).toBe(false);
	});

	it("verifies a registered connection against its webhookSecret", () => {
		// bare transport — no code webhook secret; the connection row carries the inbound credential
		const channel = telegram();
		const connection: EndpointContext = {
			provider: "telegram",
			endpointKey: "acme-bot",
			mode: "webhook",
			webhookSecret: "row-secret",
		};
		const headers = (value: string | null) => ({
			request: { headers: { get: () => value }, rawBody: "{}" },
			endpoint: connection,
		});
		expect(channel.verify?.(headers("row-secret"))).toBe(true);
		expect(channel.verify?.(headers("wrong"))).toBe(false);
	});

	it("fails closed when no webhook secret is configured anywhere", () => {
		const channel = telegram({ client: fakeTelegramClient() });
		expect(() =>
			channel.verify?.({
				request: { headers: { get: () => null }, rawBody: "{}" },
				endpoint,
			}),
		).toThrow(/no secret/);
	});

	it("sends a reply through the client with the reply-to message id", async () => {
		const client = fakeTelegramClient();
		const channel = telegram({ client });
		await channel.send({
			message: {
				externalConversationId: "123",
				text: "hi back",
				replyContext: { messageId: 7 },
			},
			endpoint,
		});
		expect(client.sent).toEqual([
			{ chatId: "123", text: "hi back", replyToMessageId: 7 },
		]);
	});

	it("polls updates and advances the cursor past the highest update id", async () => {
		const client = fakeTelegramClient();
		client.updates = [
			update({ text: "one" }),
			{ update_id: 12, message: { text: "two", chat: { id: 9 } } },
		];
		const channel = telegram({ mode: "poll", client });
		const result = await channel.poll?.({
			endpoint: { ...endpoint, mode: "poll" },
			cursor: { offset: 5 },
		});
		expect(result?.messages.map((m) => m.text)).toEqual(["one", "two"]);
		expect(result?.cursor).toEqual({ offset: 13 });
	});

	it("errors clearly on an endpoint with neither a code client nor a stored secret", async () => {
		const channel = telegram({ client: fakeTelegramClient() });
		// a key the code client doesn't cover, and no row credential to fall back on
		const unknown: EndpointContext = {
			provider: "telegram",
			endpointKey: "other-bot",
			mode: "poll",
		};
		await expect(
			channel.poll?.({ endpoint: unknown, cursor: undefined }),
		).rejects.toThrow(/no credentials/);
	});

	it("relays a telegram webhook end to end and replies through the client", async () => {
		const client = fakeTelegramClient();
		// verify fails closed, so even the happy path carries the secret-token handshake
		const channel = telegram({ client, webhook: { secret: "hook-secret" } });
		const events: EndpointEvent[] = [];
		const claw = {
			api: {
				bindConversation: async () => ({
					binding: { id: "b" },
					claw: { id: "claw-1" },
					thread: { id: "thread-1" },
					created: true,
				}),
				sendMessage: async () => ({
					result: { status: "completed", text: "pong" },
					userMessage: { id: "m" },
				}),
			},
		} as unknown as Claw;

		const result = await dispatchWebhook({
			claw,
			channel,
			endpoint,
			request: {
				headers: {
					get: (name) =>
						name === "x-telegram-bot-api-secret-token" ? "hook-secret" : null,
				},
				rawBody: JSON.stringify(update({ text: "ping", message_id: 4 })),
			},
			persist: async (event) => {
				events.push(event);
			},
		});

		expect(result.status).toBe(200);
		expect(client.sent).toEqual([
			{ chatId: "123", text: "pong", replyToMessageId: 4 },
		]);
		expect(events).toEqual([{ kind: "received" }]);
	});
});
