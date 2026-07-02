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
	// mode is required on both sources, so no mode ⟺ neither declared in code nor registered in the DB.
	const mode = record?.mode ?? code?.mode;
	if (mode === undefined) return null;
	return {
		provider: channel.provider,
		tenantId: channel.tenantId,
		endpointKey,
		mode,
		record: record ?? null,
	};
}
