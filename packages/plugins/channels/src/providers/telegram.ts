import {
	configurationError,
	stateError,
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

export type TelegramFetchResponse = {
	ok: boolean;
	status?: number;
	json: () => Promise<unknown>;
};
export type TelegramFetch = (
	input: string,
	init?: { body?: string; headers?: Record<string, string>; method?: string },
) => Promise<TelegramFetchResponse>;

export type TelegramClient = {
	getUpdates: (input: {
		offset?: number;
		limit?: number;
		timeoutSeconds?: number;
	}) => Promise<unknown>;
	sendMessage: (input: {
		chatId: string | number;
		text: string;
		replyToMessageId?: number;
	}) => Promise<unknown>;
};

export type TelegramConfig = {
	tenantId: string;
	/** Bot token; defaults to the TELEGRAM_BOT_TOKEN environment variable. */
	token?: string;
	/** Transport for this bot; defaults to webhook (poll is opt-in and contributes the cron task). */
	mode?: ChannelEndpointMode;
	/** Endpoint key; defaults to "default". Distinguishes multiple bots of the same provider. */
	endpointKey?: string;
	/** Escape hatch — inject a client for tests or a self-hosted Bot API server. */
	client?: TelegramClient;
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
 * The Telegram channel. Faithful port of the standalone telegram package onto the `Channel` contract:
 * the shared engine now owns bind/relay/reply, so this supplies only wire parsing, the secret-token
 * check, sending, and long-poll. The default transport is webhook (poll is opt-in). The `$poll` marker
 * lets `channels()` derive the cron requirement at compile time (see the old package's TelegramHasCron).
 */
export function telegram<const Config extends TelegramConfig>(
	config: Config,
): Channel & { readonly $poll: TelegramPoll<Config> } {
	const mode: ChannelEndpointMode = config.mode ?? "webhook";
	const endpointKey = config.endpointKey ?? "default";
	// Build the code client only if credentials are provided here. Construction never throws for a
	// missing token — a database-registered endpoint resolves its client from `endpoint.secret` instead.
	const codeClient = config.client ?? tokenClient(config.token ?? envToken());

	// The client for one endpoint: the in-memory code client for the declared key, otherwise one built
	// from the token stored on the endpoint row (the sso model — read the credential back). No
	// credentials → a clear error.
	const clientFor = (endpoint: EndpointContext): TelegramClient => {
		if (codeClient && endpoint.endpointKey === endpointKey) return codeClient;
		const token = endpoint.record?.secret;
		if (token) return createTelegramClient({ token });
		throw configurationError("telegram endpoint has no credentials", {
			endpointKey: endpoint.endpointKey,
			reason:
				"pass token/client in code, or register the endpoint with a stored secret",
		});
	};

	return {
		provider: "telegram",
		tenantId: config.tenantId,
		supports: { webhook: true, poll: true },
		codeEndpoints: [{ key: endpointKey, mode }],
		bind: { claw: config.claw, thread: config.thread },
		// Phantom-ish marker read by channels() at the type level; its runtime value tracks the mode.
		$poll: (mode === "poll") as TelegramPoll<Config>,

		verify({ request }) {
			const secret = config.webhook?.secret;
			if (!secret) return true;
			const headerName =
				config.webhook?.headerName ?? "x-telegram-bot-api-secret-token";
			return request.headers.get(headerName) === secret;
		},

		parseInbound({ request }) {
			const update = parseUpdate(JSON.parse(request.rawBody));
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

export function createTelegramClient(input: {
	token: string;
	fetch?: TelegramFetch;
	apiBaseUrl?: string;
}): TelegramClient {
	const globalFetch = (globalThis as { fetch?: TelegramFetch }).fetch;
	const resolvedFetch = input.fetch ?? globalFetch?.bind(globalThis);
	if (!resolvedFetch) {
		throw configurationError("Telegram fetch implementation is unavailable", {
			reason: "pass fetch or run in an environment with global fetch",
		});
	}
	const fetcher: TelegramFetch = resolvedFetch;
	const baseUrl = input.apiBaseUrl ?? "https://api.telegram.org";
	async function call(method: string, body: Record<string, unknown>) {
		const response = await fetcher(`${baseUrl}/bot${input.token}/${method}`, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const data = (await response.json()) as { ok?: boolean; result?: unknown };
		if (!response.ok || data.ok === false) {
			throw stateError("Telegram API request failed", {
				method,
				status: response.status,
				telegramOk: data.ok,
			});
		}
		return data.result;
	}
	return {
		getUpdates: ({ offset, limit, timeoutSeconds }) =>
			call("getUpdates", { offset, limit, timeout: timeoutSeconds }),
		sendMessage: ({ chatId, text, replyToMessageId }) =>
			call("sendMessage", {
				chat_id: chatId,
				text,
				reply_to_message_id: replyToMessageId,
			}),
	};
}
