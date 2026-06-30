import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type KyselyDatabase, kyselyAdapter } from "../src/index";

type DB = Record<string, Record<string, unknown>>;
let sqlite: Database.Database;
let db: Kysely<DB>;

beforeEach(async () => {
	sqlite = new Database(":memory:");
	db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
	await db.schema
		.createTable("approval")
		.addColumn("id", "text", (c) => c.primaryKey())
		.addColumn("status", "text")
		.execute();
	await db.schema
		.createTable("audit")
		.addColumn("seq", "integer")
		.addColumn("name", "text")
		.addColumn("hash", "text")
		.execute();
	await db.schema
		.createTable("token")
		.addColumn("id", "text", (c) => c.primaryKey())
		.addColumn("digest", "text")
		.execute();
});

afterEach(() => sqlite.close());

describe("@euroclaw/storage-kysely — Kysely adapter (SQLite)", () => {
	it("create + findOne by a where clause", async () => {
		const a = kyselyAdapter(db);
		const created = await a.create<{ id: string; status: string }>({
			model: "approval",
			data: { id: "ap1", status: "pending" },
		});
		expect(created.id).toBe("ap1");
		const got = await a.findOne<{ status: string }>({
			model: "approval",
			where: [{ field: "id", value: "ap1" }],
		});
		expect(got?.status).toBe("pending");
		expect(
			await a.findOne({
				model: "approval",
				where: [{ field: "id", value: "nope" }],
			}),
		).toBeNull();
	});

	it("findMany with operators, sort, limit, offset", async () => {
		const a = kyselyAdapter(db);
		for (const seq of [2, 0, 3, 1])
			await a.create({
				model: "audit",
				data: { seq, name: `t${seq}`, hash: `h${seq}` },
			});
		const sorted = await a.findMany<{ seq: number }>({
			model: "audit",
			sortBy: { field: "seq", direction: "asc" },
		});
		expect(sorted.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
		const page = await a.findMany<{ seq: number }>({
			model: "audit",
			sortBy: { field: "seq", direction: "asc" },
			offset: 1,
			limit: 2,
		});
		expect(page.map((r) => r.seq)).toEqual([1, 2]);
		const gt = await a.findMany<{ seq: number }>({
			model: "audit",
			where: [{ field: "seq", operator: "gt", value: 1 }],
		});
		expect(gt.map((r) => r.seq).sort()).toEqual([2, 3]);
		const inSet = await a.findMany<{ seq: number }>({
			model: "audit",
			where: [{ field: "seq", operator: "in", value: [0, 3] }],
		});
		expect(inSet.map((r) => r.seq).sort()).toEqual([0, 3]);
	});

	it("handles null predicates with SQL null semantics", async () => {
		const a = kyselyAdapter(db);
		await a.create({ model: "approval", data: { id: "x", status: null } });
		await a.create({ model: "approval", data: { id: "y", status: "pending" } });

		expect(
			await a.findOne<{ id: string }>({
				model: "approval",
				where: [{ field: "status", value: null }],
			}),
		).toMatchObject({ id: "x" });
		expect(
			(
				await a.findMany<{ id: string }>({
					model: "approval",
					where: [{ field: "status", operator: "ne", value: null }],
				})
			).map((row) => row.id),
		).toEqual(["y"]);
	});

	it("update / updateMany / delete / count", async () => {
		const a = kyselyAdapter(db);
		await a.create({ model: "approval", data: { id: "x", status: "pending" } });
		await a.create({ model: "approval", data: { id: "y", status: "pending" } });
		await a.update({
			model: "approval",
			where: [{ field: "id", value: "x" }],
			update: { status: "approved" },
		});
		expect(
			(
				await a.findOne<{ status: string }>({
					model: "approval",
					where: [{ field: "id", value: "x" }],
				})
			)?.status,
		).toBe("approved");
		expect(
			await a.updateMany({
				model: "approval",
				where: [{ field: "status", value: "pending" }],
				update: { status: "expired" },
			}),
		).toBe(1);
		expect(await a.count({ model: "approval" })).toBe(2);
		await a.delete({ model: "approval", where: [{ field: "id", value: "y" }] });
		expect(await a.count({ model: "approval" })).toBe(1);
	});

	it("consumeOne is single-use and race-safe (one winner)", async () => {
		const a = kyselyAdapter(db);
		await a.create({ model: "token", data: { id: "t1", digest: "abc" } });
		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				a.consumeOne<{ id: string }>({
					model: "token",
					where: [{ field: "id", value: "t1" }],
				}),
			),
		);
		expect(results.filter((r) => r !== null)).toHaveLength(1);
		expect(await a.count({ model: "token" })).toBe(0);
	});
});

describe("@euroclaw/storage-kysely — accepts a raw driver/dialect, not just a Kysely instance", () => {
	// All four forms wrap the SAME in-memory sqlite that beforeEach created the tables on.
	it("a raw better-sqlite3 Database", async () => {
		const a = kyselyAdapter(sqlite);
		await a.create({
			model: "approval",
			data: { id: "r1", status: "pending" },
		});
		expect(
			(
				await a.findOne<{ status: string }>({
					model: "approval",
					where: [{ field: "id", value: "r1" }],
				})
			)?.status,
		).toBe("pending");
	});

	it("a raw Kysely Dialect", async () => {
		const a = kyselyAdapter(new SqliteDialect({ database: sqlite }));
		await a.create({
			model: "approval",
			data: { id: "r2", status: "pending" },
		});
		expect(await a.count({ model: "approval" })).toBe(1);
	});

	it("an explicit { dialect, type } object", async () => {
		const a = kyselyAdapter({
			dialect: new SqliteDialect({ database: sqlite }),
			type: "sqlite",
		});
		await a.create({
			model: "approval",
			data: { id: "r3", status: "pending" },
		});
		expect(await a.count({ model: "approval" })).toBe(1);
	});

	it("an explicit { db, type } object", async () => {
		const a = kyselyAdapter({ db, type: "sqlite" });
		await a.create({
			model: "approval",
			data: { id: "r4", status: "pending" },
		});
		expect(await a.count({ model: "approval" })).toBe(1);
	});

	it("rejects MySQL up front (create/update use RETURNING)", () => {
		// via the object form's explicit type…
		expect(() =>
			kyselyAdapter({
				dialect: new SqliteDialect({ database: sqlite }),
				type: "mysql",
			}),
		).toThrow(/mysql/i);
		// …and via a duck-typed mysql2 pool (has `getConnection`).
		expect(() =>
			kyselyAdapter({ getConnection() {} } as unknown as KyselyDatabase),
		).toThrow(/mysql/i);
	});

	it("rejects an unrecognized input", () => {
		expect(() =>
			kyselyAdapter({ nope: true } as unknown as KyselyDatabase),
		).toThrow(/unrecognized/);
	});
});
