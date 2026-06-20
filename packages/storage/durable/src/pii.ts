import {
	type PiiMapping,
	type PiiMappingStore,
	piiMapping as piiMappingSchema,
} from "@euroclaw/core";
import { validationError } from "@euroclaw/errors";
import type { Adapter, Where } from "@euroclaw/storage-core";
import { type } from "arktype";

export type PiiMappingStoreOptions = {
	/** The table/model PII mappings live in. Default "pii_mapping". */
	model?: string;
};

function validateMapping(value: unknown): PiiMapping {
	const valid = piiMappingSchema(value) as PiiMapping | type.errors;
	if (valid instanceof type.errors) {
		throw validationError("PII mapping invalid", valid.summary);
	}
	return valid;
}

function mappingWhere(
	mapping: Pick<PiiMapping, "placeholder" | "memoryNamespace">,
): Where[] {
	const where: Where[] = [{ field: "placeholder", value: mapping.placeholder }];
	if (mapping.memoryNamespace !== undefined) {
		where.push({
			field: "memoryNamespace",
			value: mapping.memoryNamespace,
			connector: "AND",
		});
	}
	return where;
}

export function createPiiMappingStore(
	adapter: Adapter,
	options: PiiMappingStoreOptions = {},
): PiiMappingStore {
	const model = options.model ?? "pii_mapping";
	return {
		durable: true,

		async save(mapping) {
			const valid = validateMapping(mapping);
			const existing = (
				await adapter.findMany<PiiMapping>({
					model,
					where: [{ field: "placeholder", value: valid.placeholder }],
				})
			)
				.map(validateMapping)
				.find((row) => row.memoryNamespace === valid.memoryNamespace);
			if (existing) {
				await adapter.update({
					model,
					where: mappingWhere(valid),
					update: valid,
				});
				return;
			}
			await adapter.create({ model, data: valid });
		},

		async resolve(placeholder, ctx) {
			const row = (
				await adapter.findMany<PiiMapping>({
					model,
					where: [{ field: "placeholder", value: placeholder }],
				})
			)
				.map(validateMapping)
				.find((mapping) => mapping.memoryNamespace === ctx?.memoryNamespace);
			return row?.original ?? null;
		},

		async deleteForSubject(subjectId) {
			await adapter.deleteMany({
				model,
				where: [{ field: "subjectId", value: subjectId }],
			});
		},
	};
}
