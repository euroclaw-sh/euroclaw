import {
	configurationError,
	type EuroclawCronFlag,
	type EuroclawPlugin,
	type EuroclawPluginConfigureContext,
	type EuroclawRoute,
	type EuroclawRouteContext,
} from "@euroclaw/contracts";
import type { Adapter } from "@euroclaw/storage-core";
import type { Claw } from "euroclaw";
import type {
	Channel,
	ChannelEndpointListFilter,
	ChannelEndpointLookup,
	ChannelEndpointRecord,
	ChannelEndpointStore,
	CreateChannelEndpointInput,
	UpdateChannelEndpointByKeyInput,
} from "./contracts";
import { dispatchWebhook, pollChannel } from "./dispatch";
import { channelsModels } from "./schema";
import { createChannelEndpointsStore } from "./store";

/** The endpoints namespace the plugin exposes on `claw.api.channels.endpoints` — DB registration. */
export type ChannelEndpointsApi = {
	upsert: (input: CreateChannelEndpointInput) => Promise<ChannelEndpointRecord>;
	get: (input: { id: string }) => Promise<ChannelEndpointRecord | null>;
	getByKey: (
		input: ChannelEndpointLookup,
	) => Promise<ChannelEndpointRecord | null>;
	update: (
		input: UpdateChannelEndpointByKeyInput,
	) => Promise<ChannelEndpointRecord | null>;
	list: (
		filter?: ChannelEndpointListFilter,
	) => Promise<ChannelEndpointRecord[]>;
};

export type ChannelsApi = { readonly endpoints: ChannelEndpointsApi };

export type ChannelsPluginOptions = {
	/** Plugin id override (default "euroclaw.channels"). */
	id?: string;
	/** Time source for deterministic tests and host-controlled timestamps. */
	now?: () => string;
};

export type ChannelsPlugin<
	HasCron extends EuroclawCronFlag = EuroclawCronFlag,
> = EuroclawPlugin<
	HasCron,
	readonly string[],
	{ readonly channels: ChannelsApi }
> & {
	readonly $Api: { readonly channels: ChannelsApi };
};

/** A channel that may carry a compile-time poll marker (providers like telegram set it). */
type PollAware = Channel & { readonly $poll?: boolean };

/**
 * Does any channel in the list declare a poll endpoint at the type level? If so the plugin contributes
 * the poll cron, and `createClaw`'s RequireCronHandler demands a cronHandler at compile time. Channels
 * without a `$poll` marker fall back to runtime cron enforcement (assertCronHandler).
 */
type AnyPoll<List extends readonly PollAware[]> = [
	Extract<List[number]["$poll"], true>,
] extends [never]
	? false
	: true;

type ChannelsCronFlag<List extends readonly PollAware[]> =
	AnyPoll<List> extends true ? "has-cron" : "no-cron";

// The one webhook mount for every channel — dispatch is by `:provider`, then the channel's identify()
// (header/payload) picks the endpoint, defaulting to "default". Telegram routes by URL + secret-token
// header, so a single bot needs no per-endpoint path; fan-in providers read the key from the payload.
const WEBHOOK_PATH = "/channels/:provider/webhook";

/** Narrow the resolved adapter the assembly passes through the configure context's index signature. */
function contextAdapter(context: unknown): Adapter | undefined {
	if (context === null || typeof context !== "object") return undefined;
	const value = (context as { adapter?: unknown }).adapter;
	if (value === null || typeof value !== "object") return undefined;
	return value as Adapter;
}

function assertUniqueEndpoints(channels: readonly Channel[]): void {
	const seen = new Set<string>();
	for (const channel of channels) {
		for (const endpoint of channel.codeEndpoints) {
			const key = `${channel.provider}:${endpoint.key}`;
			if (seen.has(key)) {
				throw configurationError("duplicate channel endpoint", {
					provider: channel.provider,
					endpointKey: endpoint.key,
				});
			}
			seen.add(key);
		}
	}
}

function makeEndpointsApi(store: ChannelEndpointStore): ChannelEndpointsApi {
	return {
		upsert: (input) => store.upsert(input),
		get: ({ id }) => store.get(id),
		getByKey: (input) => store.getByKey(input),
		update: (input) => store.updateByKey(input),
		list: (filter) => store.list(filter),
	};
}

/**
 * The channels plugin: one webhook route dispatched by provider/endpoint, one poll cron over every
 * poll-capable channel, the `channel_endpoint` table (declared via the schema slot), and the endpoint
 * registration api. The endpoint store is built from the assembly's adapter at configure time (skills
 * precedent) — channels persist state, so a database is required.
 */
export function channels<const List extends readonly PollAware[]>(
	list: List,
	options: ChannelsPluginOptions = {},
): ChannelsPlugin<ChannelsCronFlag<List>> {
	// buildChannelsPlugin sets $HasCron at runtime from the same poll-endpoint check AnyPoll folds at
	// the type level, so this narrowing cast is sound — the one seam between runtime and the typed flag.
	return buildChannelsPlugin(list, options, undefined) as ChannelsPlugin<
		ChannelsCronFlag<List>
	>;
}

function buildChannelsPlugin(
	list: readonly Channel[],
	options: ChannelsPluginOptions,
	store: ChannelEndpointStore | undefined,
): ChannelsPlugin {
	assertUniqueEndpoints(list);
	const now = options.now ?? (() => new Date().toISOString());
	const byProvider = new Map(
		list.map((channel) => [channel.provider, channel]),
	);
	const hasWebhook = list.some((channel) => channel.supports.webhook);
	const hasPoll = list.some(
		(channel) =>
			channel.supports.poll &&
			channel.codeEndpoints.some((endpoint) => endpoint.mode === "poll"),
	);

	const requireStore = (): ChannelEndpointStore => {
		if (!store) {
			throw configurationError("channels requires a database adapter", {
				reason:
					"pass a database to createClaw so channels can persist endpoints",
			});
		}
		return store;
	};

	const configure = (
		context: EuroclawPluginConfigureContext,
	): ChannelsPlugin | undefined => {
		if (store) return undefined;
		const adapter = contextAdapter(context);
		if (!adapter) return undefined;
		return buildChannelsPlugin(
			list,
			options,
			createChannelEndpointsStore(adapter, { now }),
		);
	};

	const webhookRoute: EuroclawRoute = {
		id: "channels:webhook",
		method: "POST",
		path: WEBHOOK_PATH,
		handler: async ({ claw, params, request }: EuroclawRouteContext) => {
			const channel = byProvider.get(params.provider ?? "");
			if (!channel) {
				return { status: 404, body: { ok: false, error: "unknown provider" } };
			}
			const rawBody = await request.text();
			// dispatchWebhook applies channel.identify() over this fallback, so a single-endpoint
			// channel needs no key in the URL — it resolves to "default".
			const result = await dispatchWebhook({
				claw: claw as Claw,
				channel,
				store: requireStore(),
				endpointKey: "default",
				request: { headers: request.headers, rawBody },
				now,
			});
			return { status: result.status, body: result.body };
		},
	};

	const pollTask = {
		id: "channels:poll",
		handler: async ({ claw, limit }: { claw: unknown; limit?: number }) => {
			let processed = 0;
			for (const channel of list) {
				const result = await pollChannel({
					claw: claw as Claw,
					channel,
					store: requireStore(),
					now,
					limit,
				});
				processed += result.processed;
			}
			return {
				processed,
				status: processed > 0 ? ("processed" as const) : ("idle" as const),
			};
		},
	};

	return {
		id: options.id ?? "euroclaw.channels",
		$HasCron: hasPoll ? "has-cron" : "no-cron",
		$Api: {} as { readonly channels: ChannelsApi },
		schema: channelsModels,
		configure,
		routes: hasWebhook ? [webhookRoute] : [],
		cron: hasPoll ? [pollTask] : [],
		api: () => ({ channels: { endpoints: makeEndpointsApi(requireStore()) } }),
	};
}
