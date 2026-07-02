import { validationError } from "@euroclaw/errors";
import {
	type Adapter,
	schemaAdapter,
	type Where,
} from "@euroclaw/storage-core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
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

/**
 * The endpoint id IS the hash of its natural key, so (provider, tenantId, endpointKey) uniqueness
 * rides the primary key — concurrent upserts of the same key collide on the id instead of creating
 * twin rows — and every by-key operation is a primary-key access (engine-sql's idempotency-id
 * precedent).
 */
function channelEndpointId(key: ChannelEndpointLookup): string {
	return bytesToHex(
		sha256(
			utf8ToBytes(
				JSON.stringify({
					provider: key.provider,
					tenantId: key.tenantId,
					endpointKey: key.endpointKey,
				}),
			),
		),
	);
}

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
				...valid,
				id: channelEndpointId(valid),
				status: valid.status ?? "pending",
				createdAt: ts,
				updatedAt: ts,
			});
			await db.create({ model: "channel_endpoint", data: record });
			return record;
		},

		async upsert(input) {
			const valid = assertCreateChannelEndpointInput(input);
			const { provider, tenantId, endpointKey, ...patch } = valid;
			const lookup = { provider, tenantId, endpointKey };
			const existing = await this.getByKey(lookup);
			if (!existing) {
				try {
					return await this.create(valid);
				} catch (err) {
					// create raced another writer onto the same natural key — its id is the key's hash, so
					// the loser hits the primary-key conflict here; fall through to patching the winner's row.
					const raced = await this.updateByKey({ ...lookup, patch });
					if (raced) return raced;
					throw err;
				}
			}
			// schemaAdapter.update omits undefined fields, so the create's mutable fields patch only what
			// was provided — no per-field undefined guarding needed.
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
			return this.get(channelEndpointId(lookup));
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
				where: [{ field: "id", value: channelEndpointId(lookup) }],
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
