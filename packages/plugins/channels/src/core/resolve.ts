import type {
	Channel,
	ChannelEndpointStore,
	EndpointContext,
} from "./contracts";

/**
 * Resolve the endpoint a request or poll targets. A code-declared endpoint (credentials in-memory on
 * the channel) and a database row (credential + transport state stored in the row, the sso model) are
 * the same to everything downstream — only the source of live cursor/status differs. When a key exists
 * in both, the DB row carries the state and the code declaration supplies the fallback mode. Returns
 * null for an unknown endpoint.
 */
export async function resolveEndpoint(input: {
	channel: Channel;
	endpointKey: string;
	store: ChannelEndpointStore;
}): Promise<EndpointContext | null> {
	const { channel, endpointKey, store } = input;
	const code = channel.codeEndpoints.find((entry) => entry.key === endpointKey);
	const record = await store.getByKey({
		provider: channel.provider,
		tenantId: channel.tenantId,
		endpointKey,
	});
	if (!code && !record) return null;
	return {
		provider: channel.provider,
		tenantId: channel.tenantId,
		endpointKey,
		mode: record?.mode ?? code?.mode ?? "webhook",
		record: record ?? null,
	};
}
