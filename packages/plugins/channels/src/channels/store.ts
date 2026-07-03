import {
	type Adapter,
	type EntityRecord,
	type EntityUpdateInput,
	validationError,
} from "@euroclaw/contracts";
import { type } from "arktype";
import type { ChannelEndpointMode, EndpointEvent } from "../core/contracts";
import { endpointId } from "../core/id";
import {
	type channelEndpointFields,
	channelEndpointRecord,
	channelEndpointStatePatch,
} from "./schema";

export type ChannelEndpointStateRecord = EntityRecord<
	typeof channelEndpointFields
>;
export type ChannelEndpointStatePatch = EntityUpdateInput<
	typeof channelEndpointFields
>;

export type ChannelEndpointStateStore = {
	get: (key: {
		provider: string;
		endpointKey: string;
	}) => Promise<ChannelEndpointStateRecord | null>;
	/** Map a dispatch event onto the endpoint's state row (created on first contact). */
	record: (
		key: { provider: string; endpointKey: string; mode: ChannelEndpointMode },
		event: EndpointEvent,
	) => Promise<ChannelEndpointStateRecord>;
};

export type ChannelEndpointStateStoreOptions = {
	/** Time source for deterministic tests and host-controlled timestamps. */
	now?: () => string;
};

function assertStateRecord(input: unknown): ChannelEndpointStateRecord {
	const valid = channelEndpointRecord(input);
	if (valid instanceof type.errors) {
		throw validationError("channel endpoint state invalid", valid.summary);
	}
	return valid;
}

function assertStatePatch(input: unknown): ChannelEndpointStatePatch {
	const valid = channelEndpointStatePatch(input);
	if (valid instanceof type.errors) {
		throw validationError(
			"channel endpoint state patch invalid",
			valid.summary,
		);
	}
	return valid;
}

/** The state store for code-declared bots: one row per endpoint, keyed by hash(provider, key). */
export function createChannelEndpointStateStore(
	// The schema-aware adapter the assembly hands through the configure context (logical model/field
	// names, JSON encode/decode, immutable enforcement). Tests wrap manually: schemaAdapter(memoryAdapter(), channelsSchema).
	db: Adapter,
	options: ChannelEndpointStateStoreOptions = {},
): ChannelEndpointStateStore {
	const now = options.now ?? (() => new Date().toISOString());

	const eventPatch = (event: EndpointEvent): ChannelEndpointStatePatch => {
		switch (event.kind) {
			case "received":
				return { lastError: null, lastReceivedAt: now() };
			case "polled":
				return { cursor: event.cursor, lastError: null, lastPolledAt: now() };
			case "poll-error":
				return { lastError: event.error, lastPolledAt: now() };
		}
	};

	return {
		get(key) {
			return db.findOne<ChannelEndpointStateRecord>({
				model: "channel_endpoint",
				where: [{ field: "id", value: endpointId(key) }],
			});
		},

		async record(key, event) {
			const patch = assertStatePatch(eventPatch(event));
			const id = endpointId(key);
			const existing = await db.findOne<ChannelEndpointStateRecord>({
				model: "channel_endpoint",
				where: [{ field: "id", value: id }],
			});
			if (!existing) {
				const ts = now();
				const record = assertStateRecord({
					id,
					provider: key.provider,
					endpointKey: key.endpointKey,
					mode: key.mode,
					...patch,
					createdAt: ts,
					updatedAt: ts,
				});
				try {
					await db.create({ model: "channel_endpoint", data: record });
					return record;
				} catch (err) {
					// create raced another writer onto the same natural key (id is its hash) — fall through
					// to patching the winner's row.
					const raced = await db.update<ChannelEndpointStateRecord>({
						model: "channel_endpoint",
						where: [{ field: "id", value: id }],
						update: { ...patch, updatedAt: now() },
					});
					if (raced) return assertStateRecord(raced);
					throw err;
				}
			}
			const updated = await db.update<ChannelEndpointStateRecord>({
				model: "channel_endpoint",
				where: [{ field: "id", value: id }],
				update: { ...patch, updatedAt: now() },
			});
			return updated ? assertStateRecord(updated) : existing;
		},
	};
}
