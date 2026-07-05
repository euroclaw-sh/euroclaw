// createRegistryStores — the three tool-registry ports (SpecRegistrationStore /
// RegisteredToolStore / FactsOverlayStore), backed by any @euroclaw/storage-core Adapter. JSON
// columns (specBlob, report, inputSchema, governance, binding, groups) are (de)serialized by
// `schemaAdapter` from the entity schema — the stores never hand-roll row mapping. Every READ is
// parsed through the record schema (untrusted boundary: a hostile row must fail loud, not cast).
//
// Replace semantics: spec_registration replaces in place per (organizationId, source) — all its
// mutable columns are re-set, id/createdAt preserved. facts_overlay replaces per (organizationId,
// actionId) by delete-then-create, because a replace must CLEAR optional facts an earlier override
// set (a partial update can only add, and a nulled JSON column would fail the record schema on
// read-back) — a fresh row is the honest "the override was replaced".

import type { Adapter, Where } from "@euroclaw/contracts";
import {
	type FactsOverlayRecord,
	type FactsOverlayStore,
	type FactsOverlayUpsert,
	factsOverlayRecord as factsOverlayRecordSchema,
	factsOverlaySchema,
	factsOverlayUpsert as factsOverlayUpsertSchema,
	type RegisteredToolCreate,
	type RegisteredToolPatch,
	type RegisteredToolRecord,
	type RegisteredToolStore,
	registeredToolCreate as registeredToolCreateSchema,
	registeredToolRecord as registeredToolRecordSchema,
	registeredToolSchema,
	type SpecRegistrationRecord,
	type SpecRegistrationStore,
	type SpecRegistrationUpsert,
	specRegistrationRecord as specRegistrationRecordSchema,
	specRegistrationSchema,
	specRegistrationUpsert as specRegistrationUpsertSchema,
	stateError,
	validationError,
} from "@euroclaw/contracts";
import { schemaAdapter } from "@euroclaw/storage-core";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { type } from "arktype";

export type RegistryStoresOptions = {
	/** Time source — for deterministic createdAt/updatedAt in tests. */
	now?: () => string;
};

/** The three registry ports over one adapter (they share the `now`/id sources). */
export type RegistryStores = {
	specRegistrations: SpecRegistrationStore;
	registeredTools: RegisteredToolStore;
	factsOverlay: FactsOverlayStore;
};

const SPEC_MODEL = "spec_registration";
const TOOL_MODEL = "registered_tool";
const OVERLAY_MODEL = "facts_overlay";
const newId = (): string => bytesToHex(randomBytes(16));

const whereEq = (field: string, value: string): Where => ({ field, value });
const andEq = (field: string, value: string): Where => ({
	field,
	value,
	connector: "AND",
});

/** Back the three registry ports with a storage Adapter. */
export function createRegistryStores(
	adapter: Adapter,
	options: RegistryStoresOptions = {},
): RegistryStores {
	const now = options.now ?? (() => new Date().toISOString());
	const specDb = schemaAdapter(adapter, specRegistrationSchema);
	const toolDb = schemaAdapter(adapter, registeredToolSchema);
	const overlayDb = schemaAdapter(adapter, factsOverlaySchema);

	function validateSpec(record: unknown): SpecRegistrationRecord {
		const valid = specRegistrationRecordSchema(record);
		if (valid instanceof type.errors) {
			throw validationError("spec registration record invalid", valid.summary);
		}
		return valid;
	}
	function validateSpecInput(input: unknown): SpecRegistrationUpsert {
		const valid = specRegistrationUpsertSchema(input);
		if (valid instanceof type.errors) {
			throw validationError("spec registration input invalid", valid.summary);
		}
		return valid;
	}
	function validateTool(record: unknown): RegisteredToolRecord {
		const valid = registeredToolRecordSchema(record);
		if (valid instanceof type.errors) {
			throw validationError("registered tool record invalid", valid.summary);
		}
		return valid;
	}
	function validateToolInput(input: unknown): RegisteredToolCreate {
		const valid = registeredToolCreateSchema(input);
		if (valid instanceof type.errors) {
			throw validationError("registered tool input invalid", valid.summary);
		}
		return valid;
	}
	function validateOverlay(record: unknown): FactsOverlayRecord {
		const valid = factsOverlayRecordSchema(record);
		if (valid instanceof type.errors) {
			throw validationError("facts overlay record invalid", valid.summary);
		}
		return valid;
	}
	function validateOverlayInput(input: unknown): FactsOverlayUpsert {
		const valid = factsOverlayUpsertSchema(input);
		if (valid instanceof type.errors) {
			throw validationError("facts overlay input invalid", valid.summary);
		}
		return valid;
	}

	const specRegistrations: SpecRegistrationStore = {
		async upsert(input) {
			const valid = validateSpecInput(input);
			const existing = await specDb.findOne<SpecRegistrationRecord>({
				model: SPEC_MODEL,
				where: [
					whereEq("organizationId", valid.organizationId),
					andEq("source", valid.source),
				],
			});
			const stamp = now();
			if (existing) {
				const prev = validateSpec(existing);
				const updated = await specDb.update<SpecRegistrationRecord>({
					model: SPEC_MODEL,
					where: [whereEq("id", prev.id)],
					update: {
						specBlob: valid.specBlob,
						contentVersion: valid.contentVersion,
						report: valid.report,
						registeredBy: valid.registeredBy,
						updatedAt: stamp,
					},
				});
				if (!updated) {
					throw stateError("spec registration vanished mid-upsert", {
						id: prev.id,
					});
				}
				return validateSpec(updated);
			}
			const record: SpecRegistrationRecord = {
				id: newId(),
				organizationId: valid.organizationId,
				source: valid.source,
				specBlob: valid.specBlob,
				contentVersion: valid.contentVersion,
				report: valid.report,
				registeredBy: valid.registeredBy,
				createdAt: stamp,
				updatedAt: stamp,
			};
			await specDb.create({ model: SPEC_MODEL, data: validateSpec(record) });
			return record;
		},

		async get(organizationId, source) {
			const row = await specDb.findOne<SpecRegistrationRecord>({
				model: SPEC_MODEL,
				where: [
					whereEq("organizationId", organizationId),
					andEq("source", source),
				],
			});
			return row ? validateSpec(row) : null;
		},

		async listByOrganization(organizationId) {
			const rows = await specDb.findMany<SpecRegistrationRecord>({
				model: SPEC_MODEL,
				where: [whereEq("organizationId", organizationId)],
			});
			return rows.map(validateSpec);
		},
	};

	const registeredTools: RegisteredToolStore = {
		async listBySource(organizationId, source) {
			const rows = await toolDb.findMany<RegisteredToolRecord>({
				model: TOOL_MODEL,
				where: [
					whereEq("organizationId", organizationId),
					andEq("source", source),
				],
			});
			return rows.map(validateTool);
		},

		async listByOrganization(organizationId) {
			const rows = await toolDb.findMany<RegisteredToolRecord>({
				model: TOOL_MODEL,
				where: [whereEq("organizationId", organizationId)],
			});
			return rows.map(validateTool);
		},

		async create(input) {
			const valid = validateToolInput(input);
			const stamp = now();
			const record: RegisteredToolRecord = {
				id: newId(),
				organizationId: valid.organizationId,
				source: valid.source,
				name: valid.name,
				address: valid.address,
				...(valid.description !== undefined
					? { description: valid.description }
					: {}),
				inputSchema: valid.inputSchema,
				governance: valid.governance,
				binding: valid.binding,
				contentVersion: valid.contentVersion,
				createdAt: stamp,
				updatedAt: stamp,
			};
			await toolDb.create({ model: TOOL_MODEL, data: validateTool(record) });
			return record;
		},

		async update(id, patch: RegisteredToolPatch) {
			const update: Record<string, unknown> = { updatedAt: now() };
			if (patch.name !== undefined) update.name = patch.name;
			if (patch.address !== undefined) update.address = patch.address;
			if (patch.description !== undefined)
				update.description = patch.description;
			if (patch.inputSchema !== undefined)
				update.inputSchema = patch.inputSchema;
			if (patch.governance !== undefined) update.governance = patch.governance;
			if (patch.binding !== undefined) update.binding = patch.binding;
			if (patch.contentVersion !== undefined)
				update.contentVersion = patch.contentVersion;
			const row = await toolDb.update<RegisteredToolRecord>({
				model: TOOL_MODEL,
				where: [whereEq("id", id)],
				update,
			});
			return row ? validateTool(row) : null;
		},

		async deleteById(id) {
			await toolDb.delete({ model: TOOL_MODEL, where: [whereEq("id", id)] });
		},
	};

	const factsOverlay: FactsOverlayStore = {
		async listByOrganization(organizationId) {
			const rows = await overlayDb.findMany<FactsOverlayRecord>({
				model: OVERLAY_MODEL,
				where: [whereEq("organizationId", organizationId)],
			});
			return rows.map(validateOverlay);
		},

		async upsert(input) {
			const valid = validateOverlayInput(input);
			// Replace: drop any prior override for this (org, actionId), then write the new one whole.
			await overlayDb.delete({
				model: OVERLAY_MODEL,
				where: [
					whereEq("organizationId", valid.organizationId),
					andEq("actionId", valid.actionId),
				],
			});
			const stamp = now();
			const record: FactsOverlayRecord = {
				id: newId(),
				organizationId: valid.organizationId,
				actionId: valid.actionId,
				...(valid.access !== undefined ? { access: valid.access } : {}),
				...(valid.groups !== undefined ? { groups: valid.groups } : {}),
				...(valid.resource !== undefined ? { resource: valid.resource } : {}),
				...(valid.audit !== undefined ? { audit: valid.audit } : {}),
				updatedBy: valid.updatedBy,
				createdAt: stamp,
				updatedAt: stamp,
			};
			await overlayDb.create({
				model: OVERLAY_MODEL,
				data: validateOverlay(record),
			});
			return record;
		},

		async deleteById(id) {
			await overlayDb.delete({
				model: OVERLAY_MODEL,
				where: [whereEq("id", id)],
			});
		},
	};

	return { specRegistrations, registeredTools, factsOverlay };
}
