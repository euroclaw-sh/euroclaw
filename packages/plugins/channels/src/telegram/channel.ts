import {
	configurationError,
	errorMessage,
	validationError,
} from "@euroclaw/errors";
import { type } from "arktype";
import type {
	BindConversationClawInput,
	BindConversationThreadInput,
} from "euroclaw";
import type {
	Channel,
	ChannelEndpointMode,
	EndpointContext,
	InboundMessage,
} from "../core/contracts";
import { createTelegramClient, type TelegramClient } from "./client";

// ── Telegram wire format (the untrusted-boundary schemas the adapter parses into normalized messages) ─
const telegramId = type("string | number");
const telegramUser = type({
	id: telegramId,
	"is_bot?": "boolean | undefined",
	"first_name?": "string | undefined",
	"username?": "string | undefined",
});
const telegramChat = type({
	id: telegramId,
	"type?": "string | undefined",
	"title?": "string | undefined",
	"username?": "string | undefined",
});
const telegramMessage = type({
	"message_id?": "number | undefined",
	"text?": "string | undefined",
	chat: telegramChat,
	"from?": telegramUser.or("undefined"),
});
const telegramUpdate = type({
	update_id: "number",
	"message?": telegramMessage.or("undefined"),
});
const telegramUpdates = telegramUpdate.array();
const telegramCursor = type({ "offset?": "number | undefined" });

type TelegramUpdate = typeof telegramUpdate.infer;

export type TelegramConfig = {
	/** Bot token for the app's own bot; defaults to the TELEGRAM_BOT_TOKEN environment variable. */
	token?: string;
	/** Transport for the app's own bot; defaults to webhook (poll is opt-in and contributes the cron). */
	mode?: ChannelEndpointMode;
	/** Code endpoint key; defaults to "default". Distinguishes multiple bots of the same provider. */
	endpointKey?: string;
	/** Escape hatch — inject a client for tests or a self-hosted Bot API server. */
	client?: TelegramClient;
	/** Bind defaults for conversations on the app's own bot — the tenant rides `claw.tenantId`. */
	claw?: BindConversationClawInput;
	thread?: BindConversationThreadInput;
	webhook?: { secret?: string; headerName?: string };
	poll?: { limit?: number; timeoutSeconds?: number };
};

function envToken(): string | undefined {
	const env = (globalThis as { process?: { env?: Record<string, string> } })
		.process?.env;
	return env?.TELEGRAM_BOT_TOKEN;
}

function parseUpdate(input: unknown): TelegramUpdate {
	const valid = telegramUpdate(input);
	if (valid instanceof type.errors) {
		throw validationError("telegram update invalid", valid.summary);
	}
	return valid;
}

function parseUpdates(input: unknown): TelegramUpdate[] {
	const valid = telegramUpdates(input);
	if (valid instanceof type.errors) {
		throw validationError("telegram updates invalid", valid.summary);
	}
	return valid;
}

function cursorOffset(cursor: unknown): number | undefined {
	if (cursor === undefined) return undefined;
	const valid = telegramCursor(cursor);
	return valid instanceof type.errors ? undefined : valid.offset;
}

// A telegram update → a normalized inbound message, or null when there's nothing to relay.
function inboundFrom(update: TelegramUpdate): InboundMessage | null {
	const message = update.message;
	if (!message?.text) return null;
	return {
		externalConversationId: String(message.chat.id),
		externalActorId:
			message.from?.id !== undefined ? String(message.from.id) : undefined,
		text: message.text,
		conversationTitle: message.chat.title ?? message.chat.username,
		replyContext:
			message.message_id !== undefined
				? { messageId: message.message_id }
				: undefined,
	};
}

function replyMessageId(replyContext: unknown): number | undefined {
	if (replyContext === null || typeof replyContext !== "object")
		return undefined;
	const id = (replyContext as { messageId?: unknown }).messageId;
	return typeof id === "number" ? id : undefined;
}

/** Compile-time poll flag: a channel contributes cron only when it declares a poll endpoint. */
type TelegramPoll<Config> = Config extends { mode: "poll" } ? true : false;

/**
 * The Telegram channel. With config it is the app's own bot (channels plugin: code credentials, code
 * endpoint, bind defaults). Bare `telegram()` is the pure transport for channelConnections — every
 * endpoint-specific value (token, webhook secret, tenant, defaults) resolves from the connection row
 * via the EndpointContext. The `$poll` marker lets `channels()` derive its cron requirement at
 * compile time; the overloads keep it a literal without a cast.
 */
export function telegram(): Channel & { readonly $poll: false };
export function telegram<const Config extends TelegramConfig>(
	config: Config,
): Channel & { readonly $poll: TelegramPoll<Config> };
export function telegram(
	config: TelegramConfig = {},
): Channel & { readonly $poll: boolean } {
	const mode: ChannelEndpointMode = config.mode ?? "webhook";
	const endpointKey = config.endpointKey ?? "default";
	// Build the code client only if credentials are provided here. Construction never throws for a
	// missing token — a registered connection resolves its client from `endpoint.secret` instead.
	const codeClient = config.client ?? tokenClient(config.token ?? envToken());

	// The client for one endpoint: the in-memory code client for the declared key, otherwise one built
	// from the token stored on the connection row (the sso model — read the credential back). No
	// credentials → a clear error.
	const clientFor = (endpoint: EndpointContext): TelegramClient => {
		if (codeClient && endpoint.endpointKey === endpointKey) return codeClient;
		if (endpoint.secret)
			return createTelegramClient({ token: endpoint.secret });
		throw configurationError("telegram endpoint has no credentials", {
			endpointKey: endpoint.endpointKey,
			reason:
				"pass token/client in code, or register the connection with a stored secret",
		});
	};

	return {
		provider: "telegram",
		supports: { webhook: true, poll: true },
		codeEndpoints: [{ key: endpointKey, mode }],
		bind: { claw: config.claw, thread: config.thread },
		// Phantom-ish marker read by channels() at the type level; its runtime value tracks the mode.
		$poll: mode === "poll",

		verify({ request, endpoint }) {
			// Per-endpoint secret (a registered connection's webhookSecret) wins over the channel-level
			// code config. No secret at all fails CLOSED — an open webhook would relay attacker text
			// straight into a model run — and loudly: a missing secret is a setup gap, not a bad credential.
			const secret = endpoint.webhookSecret ?? config.webhook?.secret;
			if (!secret) {
				throw configurationError("telegram webhook endpoint has no secret", {
					endpointKey: endpoint.endpointKey,
					reason:
						"set webhook.secret in code or webhookSecret on the connection (Bot API secret_token)",
				});
			}
			const headerName =
				config.webhook?.headerName ?? "x-telegram-bot-api-secret-token";
			return request.headers.get(headerName) === secret;
		},

		parseInbound({ request }) {
			let body: unknown;
			try {
				body = JSON.parse(request.rawBody);
			} catch (err) {
				// a validation error, not a raw SyntaxError — junk bytes are the caller's fault, not a crash
				throw validationError(
					"telegram webhook body invalid JSON",
					errorMessage(err),
				);
			}
			const update = parseUpdate(body);
			const message = inboundFrom(update);
			return message ? [message] : [];
		},

		async send({ message, endpoint }) {
			await clientFor(endpoint).sendMessage({
				chatId: message.externalConversationId,
				text: message.text,
				replyToMessageId: replyMessageId(message.replyContext),
			});
		},

		async poll({ endpoint, cursor, limit }) {
			const offset = cursorOffset(cursor);
			const updates = parseUpdates(
				await clientFor(endpoint).getUpdates({
					offset,
					limit: limit ?? config.poll?.limit,
					timeoutSeconds: config.poll?.timeoutSeconds,
				}),
			);
			let nextOffset = offset;
			const messages: InboundMessage[] = [];
			for (const update of updates) {
				nextOffset = Math.max(nextOffset ?? 0, update.update_id + 1);
				const message = inboundFrom(update);
				if (message) messages.push(message);
			}
			return {
				messages,
				cursor: nextOffset === undefined ? undefined : { offset: nextOffset },
			};
		},
	};
}

function tokenClient(token: string | undefined): TelegramClient | undefined {
	return token ? createTelegramClient({ token }) : undefined;
}
