import type {
	EntityRecord,
	EntitySchemaInput,
	EntityUpdateInput,
	JsonValue,
} from "@euroclaw/contracts";
import type {
	BindConversationClawInput,
	BindConversationThreadInput,
} from "euroclaw";
import type {
	channelEndpointFields,
	channelEndpointLookupInputOptions,
	channelEndpointModeValues,
	channelEndpointStatusValues,
	createChannelEndpointInputOptions,
} from "./schema";

export type ChannelEndpointMode = (typeof channelEndpointModeValues)[number];
export type ChannelEndpointStatus =
	(typeof channelEndpointStatusValues)[number];

export type ChannelEndpointRecord = EntityRecord<typeof channelEndpointFields>;

export type CreateChannelEndpointInput = EntitySchemaInput<
	typeof channelEndpointFields,
	typeof createChannelEndpointInputOptions
>;
export type ChannelEndpointLookup = EntitySchemaInput<
	typeof channelEndpointFields,
	typeof channelEndpointLookupInputOptions
>;
export type UpdateChannelEndpointInput = EntityUpdateInput<
	typeof channelEndpointFields
>;
export type UpdateChannelEndpointByKeyInput = ChannelEndpointLookup & {
	patch: UpdateChannelEndpointInput;
};

/** Filter for the poll loop's fan-out over endpoints (e.g. every poll-mode endpoint of a provider). */
export type ChannelEndpointListFilter = {
	provider?: string;
	tenantId?: string;
	mode?: ChannelEndpointMode;
	status?: ChannelEndpointStatus;
};

/**
 * The endpoint store — the sso `ssoProvider` analog: transport state persisted per (provider, tenant,
 * endpointKey). `list` is the addition over the core store this was extracted from; the poll cron
 * fans out over it.
 */
export type ChannelEndpointStore = {
	create: (input: CreateChannelEndpointInput) => Promise<ChannelEndpointRecord>;
	upsert: (input: CreateChannelEndpointInput) => Promise<ChannelEndpointRecord>;
	get: (id: string) => Promise<ChannelEndpointRecord | null>;
	getByKey: (
		input: ChannelEndpointLookup,
	) => Promise<ChannelEndpointRecord | null>;
	updateByKey: (
		input: UpdateChannelEndpointByKeyInput,
	) => Promise<ChannelEndpointRecord | null>;
	list: (
		filter?: ChannelEndpointListFilter,
	) => Promise<ChannelEndpointRecord[]>;
};

// ── The Channel adapter contract (the OAuthProvider analog) ───────────────────────────────────────

/**
 * A raw inbound request, narrowed to what a channel needs. The dispatch engine reads the body once and
 * hands the bytes to both `verify` (header- or signature-based) and `parseInbound`, so a channel never
 * has to worry about the single-read body.
 */
export type InboundRequest = {
	headers: { get: (name: string) => string | null };
	rawBody: string;
};

/** One normalized inbound message — the parse target every provider produces from its wire format. */
export type InboundMessage = {
	externalConversationId: string;
	externalActorId?: string;
	text: string;
	conversationTitle?: string;
	/** Opaque token the channel round-trips to `send` to thread the reply (e.g. a message id). */
	replyContext?: JsonValue;
	raw?: JsonValue;
};

/** A normalized reply the dispatch engine hands back to a channel to deliver. */
export type OutboundMessage = {
	externalConversationId: string;
	text: string;
	replyContext?: JsonValue;
};

/** The endpoint a channel operates on for one request/poll cycle — key, mode, and DB state (if any). */
export type EndpointContext = {
	provider: string;
	tenantId: string;
	endpointKey: string;
	mode: ChannelEndpointMode;
	record: ChannelEndpointRecord | null;
};

/** An endpoint a channel declares in code — credentials live in-memory on the channel, not the DB. */
export type CodeEndpoint = {
	key: string;
	mode: ChannelEndpointMode;
};

/**
 * The behavioral contract every channel implements — the OAuthProvider analog, but bidirectional
 * (channels send). The shared engine owns bind/relay/reply/persist; a channel supplies only the
 * provider-specific verify/parse/send/poll. Credential resolution (code client vs stored secret) is the
 * channel's private concern.
 */
export interface Channel {
	readonly provider: string;
	readonly tenantId: string;
	readonly supports: { readonly webhook: boolean; readonly poll: boolean };
	/** Endpoints declared in code — each a (key, mode); their clients live on the channel. */
	readonly codeEndpoints: readonly CodeEndpoint[];
	/** Bind defaults merged into every conversation this channel opens. */
	readonly bind?: {
		readonly claw?: BindConversationClawInput;
		readonly thread?: BindConversationThreadInput;
	};
	/** Extract the endpoint key from a request (default: the route `:endpointKey`). Fan-in overrides. */
	identify?: (request: InboundRequest) => string | undefined;
	/**
	 * Authenticate an inbound request against the endpoint BEFORE its body is trusted. Prefer failing
	 * closed — an unverified webhook relays attacker input straight into a model run (telegram checks
	 * the row's webhookSecret, then code config, and refuses when neither is set).
	 */
	verify?: (input: {
		request: InboundRequest;
		endpoint: EndpointContext;
	}) => boolean | Promise<boolean>;
	/** Parse a raw request into normalized inbound messages. */
	parseInbound: (input: {
		request: InboundRequest;
		endpoint: EndpointContext;
	}) => InboundMessage[] | Promise<InboundMessage[]>;
	/** Deliver a reply through the provider. */
	send: (input: {
		message: OutboundMessage;
		endpoint: EndpointContext;
	}) => Promise<void>;
	/** Poll for new messages — present only when `supports.poll`. */
	poll?: (input: {
		endpoint: EndpointContext;
		cursor: JsonValue | undefined;
		limit?: number;
	}) => Promise<{ messages: InboundMessage[]; cursor: JsonValue | undefined }>;
}
