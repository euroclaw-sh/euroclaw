import { type EntityField, entity, field } from "@euroclaw/contracts";
import type { SchemaDeclaration } from "@euroclaw/storage-core";

// A channel endpoint is one addressable ingress/egress target — a bot, a webhook, a poller. Its
// transport state (mode/cursor/secret/status lifecycle) is pure channel concern, so the table is
// owned by this plugin and declared via the plugin `schema` slot (see channelsModels), not by core.
// The identity mapping an inbound message produces (external conversation -> claw) stays core, in
// conversation_binding — this table has no claw/thread foreign keys.
export const channelEndpointModeValues = ["webhook", "poll"] as const;
export const channelEndpointStatusValues = [
	"pending",
	"provisioned",
	"validated",
	"disabled",
	"expired",
	"error",
] as const;

export const channelEndpointFields = {
	// The (provider, tenantId, endpointKey) natural key + id are the immutable identity — immutable:true
	// so an update can never change them (enforced at the storage layer) and they drop out of the
	// derived update input.
	id: field.string({ required: true, unique: true, immutable: true }),
	provider: field.string({ required: true, index: true, immutable: true }),
	tenantId: field.string({ required: true, index: true, immutable: true }),
	endpointKey: field.string({ required: true, index: true, immutable: true }),
	mode: field.enum(channelEndpointModeValues, { required: true, index: true }),
	status: field.enum(channelEndpointStatusValues, {
		required: true,
		index: true,
	}),
	externalId: field.string({ index: true }),
	url: field.string(),
	// The provider credential for a database-registered endpoint (e.g. a bot token), stored in the row
	// and read back at use time — the sso `oidcConfig` model. `redacted` keeps it out of audit/exports;
	// at-rest protection is the host's database concern. Code endpoints keep their client in memory and
	// leave this empty.
	secret: field.string({ pii: "redacted" }),
	cursor: field.jsonValue({ pii: "possible" }),
	metadata: field.jsonObject(),
	lastError: field.jsonValue({ pii: "redacted" }),
	validatedAt: field.string({ index: true }),
	provisionedAt: field.string({ index: true }),
	expiresAt: field.string({ index: true }),
	lastReceivedAt: field.string({ index: true }),
	lastPolledAt: field.string({ index: true }),
	createdAt: field.string({ required: true, immutable: true }),
	// Written by the store on every update, but never caller-provided — input:false keeps it out of the
	// create/update inputs while leaving the store free to set it.
	updatedAt: field.string({ required: true, input: false }),
} as const;

export const channelEndpointEntity = entity(
	"channel_endpoint",
	channelEndpointFields,
);

export const channelEndpointRecord = channelEndpointEntity.record;

export const createChannelEndpointInputOptions = {
	omit: ["createdAt", "updatedAt"],
	optional: ["id", "status"],
} as const;
export const createChannelEndpointInput = channelEndpointEntity.schema(
	createChannelEndpointInputOptions,
);

export const channelEndpointLookupInputOptions = {
	pick: ["provider", "tenantId", "endpointKey"],
} as const;
export const channelEndpointLookupInput = channelEndpointEntity.schema(
	channelEndpointLookupInputOptions,
);

// The update patch derives straight from the fields — every mutable, caller-facing column, all optional
// (the immutable identity + server-managed updatedAt drop out via their field flags). No hand-kept list.
export const updateChannelEndpointInput = channelEndpointEntity.updateSchema();

// One list drives both the plugin `schema` slot (collected into migrations by getEuroclawTables) and
// the storage schema the endpoint store persists through — so the two can't drift (skills precedent).
const channelsEntities = [channelEndpointEntity] as const;

/** The models this plugin registers via `plugin.schema` — collected into the migration schema. */
export const channelsModels: Record<
	string,
	{ fields: Record<string, EntityField> }
> = Object.fromEntries(
	channelsEntities.map((entity) => [entity.name, { fields: entity.fields }]),
);

/** The tables the endpoint store persists — the storage view of the same {@link channelsModels}. */
export const channelsSchema: SchemaDeclaration = {};
for (const entity of channelsEntities) {
	Object.assign(channelsSchema, entity.storage);
}
