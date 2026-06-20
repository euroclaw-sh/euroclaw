import type { Adapter } from "@euroclaw/storage-core";
import { type KyselyDatabase, kyselyAdapter } from "@euroclaw/storage-kysely";

/** Durable substrate accepted by runtime. Raw Kysely inputs are wrapped; storage Adapters pass through. */
export type RuntimeDatabase = Adapter | KyselyDatabase;

function isAdapter(db: RuntimeDatabase): db is Adapter {
	const x = db as Partial<Adapter>;
	return (
		typeof x.id === "string" &&
		typeof x.create === "function" &&
		typeof x.consumeOne === "function"
	);
}

export function resolveDatabase(db: RuntimeDatabase): Adapter {
	return isAdapter(db) ? db : kyselyAdapter(db);
}
