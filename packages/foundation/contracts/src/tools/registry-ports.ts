// The tool-registry STORE PORTS — the behavioural protocol (verbs) the durable stores satisfy,
// kept apart from the entity/schema declarations in ./registry. Ports are types only; the impls
// live in @euroclaw/storage-durable (createRegistryStores).

import type {
	FactsOverlayRecord,
	FactsOverlayUpsert,
	RegisteredToolCreate,
	RegisteredToolPatch,
	RegisteredToolRecord,
	SpecRegistrationRecord,
	SpecRegistrationUpsert,
} from "./registry";

/** Persists the raw registration per (organizationId, source); re-registration replaces the row. */
export type SpecRegistrationStore = {
	/** Replace-by-(organizationId, source): update the existing row or create a fresh one. */
	upsert: (input: SpecRegistrationUpsert) => Promise<SpecRegistrationRecord>;
	get: (
		organizationId: string,
		source: string,
	) => Promise<SpecRegistrationRecord | null>;
	listByOrganization: (
		organizationId: string,
	) => Promise<SpecRegistrationRecord[]>;
};

/** The extracted operation rows; the registration diff creates/updates/deletes by address. */
export type RegisteredToolStore = {
	listBySource: (
		organizationId: string,
		source: string,
	) => Promise<RegisteredToolRecord[]>;
	listByOrganization: (
		organizationId: string,
	) => Promise<RegisteredToolRecord[]>;
	create: (input: RegisteredToolCreate) => Promise<RegisteredToolRecord>;
	update: (
		id: string,
		patch: RegisteredToolPatch,
	) => Promise<RegisteredToolRecord | null>;
	deleteById: (id: string) => Promise<void>;
};

/** The customer facts overlay; replace-by-(organizationId, actionId). */
export type FactsOverlayStore = {
	listByOrganization: (organizationId: string) => Promise<FactsOverlayRecord[]>;
	upsert: (input: FactsOverlayUpsert) => Promise<FactsOverlayRecord>;
	deleteById: (id: string) => Promise<void>;
};
