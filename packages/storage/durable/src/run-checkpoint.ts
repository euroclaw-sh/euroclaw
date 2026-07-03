// createRunCheckpointStore — the RunCheckpointStore port, backed by any @euroclaw/storage-core
// Adapter. The single-use guarantee rides on an atomic pending→consumed transition, so a yielded
// run resumes exactly once even under concurrent continuation claims. The metadata JSON column is
// (de)serialized by `schemaAdapter` from the entity schema — the store never hand-rolls row mapping.

import {
	type NewRunCheckpoint,
	newRunCheckpoint as newRunCheckpointSchema,
	type RunCheckpointRecord,
	type RunCheckpointStore,
	runCheckpointRecord as runCheckpointRecordSchema,
	runCheckpointSchema,
} from "@euroclaw/contracts";
import { validationError } from "@euroclaw/errors";
import {
	type Adapter,
	schemaAdapter,
	type Where,
} from "@euroclaw/storage-core";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { type } from "arktype";

export type RunCheckpointStoreOptions = {
	/** Time source — for deterministic consumedAt in tests. */
	now?: () => string;
};

const MODEL = "run_checkpoint";
const newId = (): string => bytesToHex(randomBytes(16));

// Reads are untrusted boundary data (rows from any adapter); every read is PARSED through the
// record schema, never cast.
function validateRecord(record: unknown): RunCheckpointRecord {
	const valid = runCheckpointRecordSchema(record);
	if (valid instanceof type.errors) {
		throw validationError("run checkpoint record invalid", valid.summary);
	}
	return valid;
}

function validateNewCheckpoint(input: unknown): NewRunCheckpoint {
	const valid = newRunCheckpointSchema(input) as NewRunCheckpoint | type.errors;
	if (valid instanceof type.errors) {
		throw validationError("new run checkpoint invalid", valid.summary);
	}
	return valid;
}

/** Back the RunCheckpointStore port with a storage Adapter. */
export function createRunCheckpointStore(
	adapter: Adapter,
	options: RunCheckpointStoreOptions = {},
): RunCheckpointStore {
	const now = options.now ?? (() => new Date().toISOString());
	const db = schemaAdapter(adapter, runCheckpointSchema);

	const wherePending = (id: string): Where[] => [
		{ field: "id", value: id },
		{ field: "status", value: "pending", connector: "AND" },
	];

	return {
		async create(input) {
			const valid = validateNewCheckpoint(input);
			const record: RunCheckpointRecord = {
				id: valid.id ?? newId(),
				status: "pending",
				...(valid.runId !== undefined ? { runId: valid.runId } : {}),
				metadata: valid.metadata,
				createdAt: valid.createdAt,
			};
			await db.create({ model: MODEL, data: validateRecord(record) });
			return record;
		},

		async get(id) {
			const row = await db.findOne<RunCheckpointRecord>({
				model: MODEL,
				where: [{ field: "id", value: id }],
			});
			return row ? validateRecord(row) : null;
		},

		async consume(id) {
			// Atomic transition of the pending row by id — race-safe single use while preserving the
			// resume metadata for the winning continuation.
			const row = await db.update<RunCheckpointRecord>({
				model: MODEL,
				where: wherePending(id),
				update: { status: "consumed", consumedAt: now() },
			});
			return row ? validateRecord(row) : null;
		},
	};
}
