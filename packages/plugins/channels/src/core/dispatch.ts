import { errorMessage } from "@euroclaw/errors";
import type { Claw } from "euroclaw";
import type {
	Channel,
	ChannelEndpointMode,
	ChannelEndpointStore,
	EndpointContext,
	InboundMessage,
	InboundRequest,
	UpdateChannelEndpointInput,
} from "./contracts";
import { resolveEndpoint } from "./resolve";

export type ChannelDispatchResult = {
	status: number;
	body: unknown;
};

/**
 * Persist post-dispatch endpoint state. An existing row gets a plain patch — never `mode`, so inbound
 * traffic can't flip a registered endpoint's transport (a webhook POST to a poll-registered endpoint
 * would otherwise silently drop it from the poll fan-out). Only first contact creates the row, with
 * the mode of the transport that just ran.
 */
function persistEndpointState(input: {
	store: ChannelEndpointStore;
	endpoint: EndpointContext;
	mode: ChannelEndpointMode;
	patch: UpdateChannelEndpointInput;
}): Promise<unknown> {
	const { store, endpoint, patch } = input;
	const key = {
		provider: endpoint.provider,
		tenantId: endpoint.tenantId,
		endpointKey: endpoint.endpointKey,
	};
	return endpoint.record
		? store.updateByKey({ ...key, patch })
		: store.upsert({ ...key, mode: input.mode, ...patch });
}

/**
 * The shared half every provider reuses: bind the external conversation to a claw/thread (core), relay
 * the message to the claw, and — if the run produced text — reply through the channel. A channel only
 * supplies parse/send; this owns the round-trip.
 */
async function handleInbound(input: {
	claw: Claw;
	channel: Channel;
	endpoint: EndpointContext;
	message: InboundMessage;
}): Promise<void> {
	const { claw, channel, endpoint, message } = input;
	const binding = await claw.api.bindConversation({
		provider: endpoint.provider,
		tenantId: endpoint.tenantId,
		externalConversationId: message.externalConversationId,
		externalActorId: message.externalActorId,
		claw: channel.bind?.claw,
		thread: {
			...channel.bind?.thread,
			title: channel.bind?.thread?.title ?? message.conversationTitle,
		},
	});
	const sent = await claw.api.sendMessage({
		clawId: binding.claw.id,
		threadId: binding.thread.id,
		message: message.text,
	});
	if (sent.result.status === "completed" && sent.result.text) {
		await channel.send({
			endpoint,
			message: {
				externalConversationId: message.externalConversationId,
				text: sent.result.text,
				replyContext: message.replyContext,
			},
		});
	}
}

/**
 * Handle one inbound webhook: resolve the endpoint, authenticate before trusting the body, parse, relay
 * each message, and mark the endpoint received. The channel's `identify` may override the route key
 * (fan-in providers that share one URL).
 */
export async function dispatchWebhook(input: {
	claw: Claw;
	channel: Channel;
	store: ChannelEndpointStore;
	endpointKey: string;
	request: InboundRequest;
	now: () => string;
}): Promise<ChannelDispatchResult> {
	const { claw, channel, store, request } = input;
	const endpointKey = channel.identify?.(request) ?? input.endpointKey;
	const endpoint = await resolveEndpoint({ channel, endpointKey, store });
	if (!endpoint) {
		return { status: 404, body: { ok: false, error: "unknown endpoint" } };
	}
	if (channel.verify) {
		const ok = await channel.verify({ request, endpoint });
		if (!ok) return { status: 401, body: { ok: false, error: "unauthorized" } };
	}
	const messages = await channel.parseInbound({ request, endpoint });
	for (const message of messages) {
		await handleInbound({ claw, channel, endpoint, message });
	}
	await persistEndpointState({
		store,
		endpoint,
		mode: "webhook",
		patch: {
			status: "validated",
			lastError: null,
			lastReceivedAt: input.now(),
		},
	});
	return {
		status: 200,
		body: { ok: true, data: { processed: messages.length } },
	};
}

/**
 * Poll one endpoint: read its cursor, ask the channel for new messages, relay them, and advance the
 * cursor. On failure the endpoint is marked `error` with the message, and the error is rethrown so the
 * cron surfaces it.
 */
export async function pollEndpoint(input: {
	claw: Claw;
	channel: Channel;
	store: ChannelEndpointStore;
	endpoint: EndpointContext;
	now: () => string;
	limit?: number;
}): Promise<{ processed: number }> {
	const { claw, channel, store, endpoint } = input;
	if (!channel.poll) return { processed: 0 };
	try {
		const result = await channel.poll({
			endpoint,
			cursor: endpoint.record?.cursor,
			limit: input.limit,
		});
		let processed = 0;
		for (const message of result.messages) {
			await handleInbound({ claw, channel, endpoint, message });
			processed += 1;
		}
		await persistEndpointState({
			store,
			endpoint,
			mode: "poll",
			patch: {
				status: "validated",
				cursor: result.cursor,
				lastError: null,
				lastPolledAt: input.now(),
			},
		});
		return { processed };
	} catch (error) {
		await persistEndpointState({
			store,
			endpoint,
			mode: "poll",
			patch: {
				status: "error",
				lastError: { message: errorMessage(error) },
				lastPolledAt: input.now(),
			},
		});
		throw error;
	}
}

/**
 * Run the poll cron for one channel over every poll endpoint — code-declared (credentials in-memory)
 * and database-registered (credential stored in the row), deduped by key. A poller whose endpoint has
 * no credentials surfaces its error on that endpoint while the others continue.
 */
export async function pollChannel(input: {
	claw: Claw;
	channel: Channel;
	store: ChannelEndpointStore;
	now: () => string;
	limit?: number;
}): Promise<{ processed: number }> {
	const { claw, channel, store } = input;
	if (!channel.poll) return { processed: 0 };
	const codeKeys = channel.codeEndpoints
		.filter((entry) => entry.mode === "poll")
		.map((entry) => entry.key);
	const dbKeys = (
		await store.list({
			provider: channel.provider,
			tenantId: channel.tenantId,
			mode: "poll",
		})
	).map((record) => record.endpointKey);
	const keys = [...new Set([...codeKeys, ...dbKeys])];
	let processed = 0;
	for (const key of keys) {
		const endpoint = await resolveEndpoint({
			channel,
			endpointKey: key,
			store,
		});
		if (!endpoint) continue;
		const result = await pollEndpoint({
			claw,
			channel,
			store,
			endpoint,
			now: input.now,
			limit: input.limit,
		});
		processed += result.processed;
	}
	return { processed };
}
