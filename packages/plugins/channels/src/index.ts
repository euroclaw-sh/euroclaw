// @euroclaw/channels — the self-contained channels plugin. Register channel types (adapters) in code;
// endpoints resolve from code declarations ∪ database rows (the sso plugin's model). One webhook route
// dispatches by provider/endpoint, one poll cron fans over poll-capable channels, and `channel_endpoint`
// is owned here (declared via the plugin `schema` slot), not in core.
export type {
	Channel,
	ChannelEndpointListFilter,
	ChannelEndpointLookup,
	ChannelEndpointMode,
	ChannelEndpointRecord,
	ChannelEndpointStatus,
	ChannelEndpointStore,
	CodeEndpoint,
	CreateChannelEndpointInput,
	EndpointContext,
	InboundMessage,
	InboundRequest,
	OutboundMessage,
	UpdateChannelEndpointByKeyInput,
	UpdateChannelEndpointInput,
} from "./core/contracts";
export {
	dispatchWebhook,
	pollChannel,
	pollEndpoint,
} from "./core/dispatch";
export {
	type ChannelEndpointsApi,
	type ChannelsApi,
	type ChannelsPlugin,
	type ChannelsPluginOptions,
	channels,
} from "./core/plugin";
export { resolveEndpoint } from "./core/resolve";
export {
	channelEndpointModeValues,
	channelEndpointStatusValues,
	channelsModels,
	channelsSchema,
} from "./core/schema";
export {
	type ChannelEndpointStoreOptions,
	createChannelEndpointsStore,
} from "./core/store";
export {
	createTelegramClient,
	type TelegramClient,
	type TelegramConfig,
	type TelegramFetch,
	type TelegramFetchResponse,
	telegram,
} from "./providers";
