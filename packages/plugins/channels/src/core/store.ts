import { validationError } from "@euroclaw/errors";
import {
	type Adapter,
	schemaAdapter,
	type Where,
} from "@euroclaw/storage-core";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { type } from "arktype";
import type {
	ChannelEndpointListFilter,
	ChannelEndpointLookup,
	ChannelEndpointRecord,
	ChannelEndpointStore,
	CreateChannelEndpointInput,
	UpdateChannelEndpointByKeyInput,
	UpdateChannelEndpointInput,
} from "./contracts";
import {
	channelEndpointLookupInput,
	channelEndpointRecord,
	channelsSchema,
	createChannelEndpointInput,
	updateChannelEndpointInput,
} from "./schema";

export type ChannelEndpointStoreOptions = {
	/** Time source for deterministic tests and host-controlled timestamps. */
	now?: () => string;
};

const newId = (): string => bytesToHex(randomBytes(16));

function assertCreateChannelEndpointInput(
	input: unknown,
): CreateChannelEndpointInput {
	const valid = createChannelEndpointInput(input);
	if (valid instanceof type.errors) {
		throw validationError(
			"create channel endpoint input invalid",
			valid.summary,
		);
	}
	return valid;
}

function assertChannelEndpointLookup(input: unknown): ChannelEndpointLookup {
	const valid = channelEndpointLookupInput(input);
	if (valid instanceof type.errors) {
		throw validationError("channel endpoint lookup invalid", valid.summary);
	}
	return valid;
}

function assertUpdateChannelEndpointInput(
	input: unknown,
): UpdateChannelEndpointInput {
	const valid = updateChannelEndpointInput(input);
	if (valid instanceof type.errors) {
		throw validationError(
			"update channel endpoint input invalid",
			valid.summary,
		);
	}
	return valid;
}

function assertChannelEndpointRecord(input: unknown): ChannelEndpointRecord {
	const valid = channelEndpointRecord(input);
	if (valid instanceof type.errors) {
		throw validationError("channel endpoint record invalid", valid.summary);
	}
	return valid;
}

function channelEndpointWhere(input: ChannelEndpointLookup): Where[] {
	return [
		{ field: "provider", value: input.provider },
		{ field: "tenantId", value: input.tenantId, connector: "AND" },
		{ field: "endpointKey", value: input.endpointKey, connector: "AND" },
	];
}

function channelEndpointListWhere(filter: ChannelEndpointListFilter): Where[] {
	const where: Where[] = [];
	const add = (fieldName: string, value: string): void => {
		where.push(
			where.length === 0
				? { field: fieldName, value }
				: { field: fieldName, value, connector: "AND" },
		);
	};
	if (filter.provider !== undefined) add("provider", filter.provider);
	if (filter.tenantId !== undefined) add("tenantId", filter.tenantId);
	if (filter.mode !== undefined) add("mode", filter.mode);
	if (filter.status !== undefined) add("status", filter.status);
	return where;
}

/**
 * The channel-endpoint store — transport state per (provider, tenant, endpointKey), persisted through
 * a schema-aware adapter. Extracted verbatim from the core claws store (its state model was already
 * channel-shaped) and given a `list` method the poll cron fans out over.
 */
export function createChannelEndpointsStore(
	adapter: Adapter,
	options: ChannelEndpointStoreOptions = {},
): ChannelEndpointStore {
	const now = options.now ?? (() => new Date().toISOString());
	const db = schemaAdapter(adapter, channelsSchema);

	return {
		async create(input) {
			const valid = assertCreateChannelEndpointInput(input);
			const ts = now();
			const record = assertChannelEndpointRecord({
				id: valid.id ?? newId(),
				provider: valid.provider,
				tenantId: valid.tenantId,
				endpointKey: valid.endpointKey,
				mode: valid.mode,
				status: valid.status ?? "pending",
				externalId: valid.externalId,
				url: valid.url,
				secret: valid.secret,
				cursor: valid.cursor,
				metadata: valid.metadata,
				lastError: valid.lastError,
				validatedAt: valid.validatedAt,
				provisionedAt: valid.provisionedAt,
				expiresAt: valid.expiresAt,
				lastReceivedAt: valid.lastReceivedAt,
				lastPolledAt: valid.lastPolledAt,
				createdAt: ts,
				updatedAt: ts,
			});
			await db.create({ model: "channel_endpoint", data: record });
			return record;
		},

		async upsert(input) {
			const valid = assertCreateChannelEndpointInput(input);
			const { id, provider, tenantId, endpointKey, ...patch } = valid;
			const lookup = { provider, tenantId, endpointKey };
			const existing = await this.getByKey(lookup);
			if (!existing) return this.create(valid);
			// schemaAdapter.update omits undefined fields, so the create's mutable fields patch only what
			// was provided — no per-field undefined guarding needed. `id` is destructured off (not updatable).
			return (await this.updateByKey({ ...lookup, patch })) ?? existing;
		},

		get(id) {
			return db.findOne<ChannelEndpointRecord>({
				model: "channel_endpoint",
				where: [{ field: "id", value: id }],
			});
		},

		getByKey(input) {
			const lookup = assertChannelEndpointLookup(input);
			return db.findOne<ChannelEndpointRecord>({
				model: "channel_endpoint",
				where: channelEndpointWhere(lookup),
			});
		},

		async updateByKey(input: UpdateChannelEndpointByKeyInput) {
			const lookup = assertChannelEndpointLookup({
				endpointKey: input.endpointKey,
				provider: input.provider,
				tenantId: input.tenantId,
			});
			const patch = assertUpdateChannelEndpointInput(input.patch);
			const row = await db.update<ChannelEndpointRecord>({
				model: "channel_endpoint",
				where: channelEndpointWhere(lookup),
				update: { ...patch, updatedAt: now() },
			});
			return row ? assertChannelEndpointRecord(row) : null;
		},

		list(filter = {}) {
			return db.findMany<ChannelEndpointRecord>({
				model: "channel_endpoint",
				where: channelEndpointListWhere(filter),
			});
		},
	};
}
