// createApprovalStore — the ApprovalStore port, backed by any @euroclaw/storage-core Adapter
// (memory / kysely / drizzle / prisma / mongo). The single-use guarantee rides on an atomic
// approved→consumed transition, so a granted approval resumes exactly once even under concurrent
// retries. JSON columns (args, metadata) are (de)serialized by `schemaAdapter` from the entity
// schema — the store never hand-rolls row mapping.

import {
	type ApprovalRecord,
	type ApprovalStore,
	approvalRecord as approvalRecordSchema,
	approvalSchema,
	type NewApproval,
	newApproval as newApprovalSchema,
} from "@euroclaw/contracts";
import { validationError } from "@euroclaw/errors";
import {
	type Adapter,
	schemaAdapter,
	type Where,
} from "@euroclaw/storage-core";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { type } from "arktype";

export type ApprovalStoreOptions = {
	/** Time source — for deterministic expiry in tests. */
	now?: () => string;
};

const MODEL = "approval";
const newId = (): string => bytesToHex(randomBytes(16));

// Reads are untrusted boundary data (rows from any adapter); every read is PARSED through the
// record schema, never cast.
function validateRecord(record: unknown): ApprovalRecord {
	const valid = approvalRecordSchema(record);
	if (valid instanceof type.errors) {
		throw validationError("approval record invalid", valid.summary);
	}
	return valid;
}

function validateNewApproval(input: unknown): NewApproval {
	const valid = newApprovalSchema(input) as NewApproval | type.errors;
	if (valid instanceof type.errors) {
		throw validationError("new approval invalid", valid.summary);
	}
	return valid;
}

/** Back the ApprovalStore port with a storage Adapter. */
export function createApprovalStore(
	adapter: Adapter,
	options: ApprovalStoreOptions = {},
): ApprovalStore {
	const now = options.now ?? (() => new Date().toISOString());
	const db = schemaAdapter(adapter, approvalSchema);

	// Only a still-pending row can be granted/denied — guards against deciding a consumed approval.
	const wherePending = (id: string): Where[] => [
		{ field: "id", value: id },
		{ field: "status", value: "pending", connector: "AND" },
	];
	const whereApproved = (id: string): Where[] => [
		{ field: "id", value: id },
		{ field: "status", value: "approved", connector: "AND" },
	];

	return {
		async create(input) {
			const valid = validateNewApproval(input);
			const record: ApprovalRecord = {
				id: newId(),
				status: "pending",
				...valid,
			};
			await db.create({ model: MODEL, data: validateRecord(record) });
			return record;
		},

		async get(id) {
			const row = await db.findOne<ApprovalRecord>({
				model: MODEL,
				where: [{ field: "id", value: id }],
			});
			return row ? validateRecord(row) : null;
		},

		async grant(id, by) {
			const row = await db.update<ApprovalRecord>({
				model: MODEL,
				where: wherePending(id),
				update: { status: "approved", decidedBy: by },
			});
			return row ? validateRecord(row) : null;
		},

		async deny(id, by, reason) {
			const update: Record<string, unknown> = {
				status: "denied",
				decidedBy: by,
			};
			if (reason !== undefined) update.reason = reason;
			const row = await db.update<ApprovalRecord>({
				model: MODEL,
				where: wherePending(id),
				update,
			});
			return row ? validateRecord(row) : null;
		},

		async consume(id) {
			const existingRow = await db.findOne<ApprovalRecord>({
				model: MODEL,
				where: whereApproved(id),
			});
			if (!existingRow) return null;
			const existing = validateRecord(existingRow);
			if (existing.expiresAt != null && existing.expiresAt < now()) return null;

			// Atomic transition of the approved row by id — race-safe single use while preserving
			// checkpoint metadata for crash recovery.
			const row = await db.update<ApprovalRecord>({
				model: MODEL,
				where: whereApproved(id),
				update: { status: "consumed" },
			});
			return row ? validateRecord(row) : null;
		},

		async list(filter) {
			const where: Where[] = [];
			if (filter?.status !== undefined)
				where.push({ field: "status", value: filter.status });
			if (filter?.actor !== undefined)
				where.push({ field: "actor", value: filter.actor, connector: "AND" });
			const rows = await db.findMany<ApprovalRecord>({ model: MODEL, where });
			return rows.map(validateRecord);
		},
	};
}
