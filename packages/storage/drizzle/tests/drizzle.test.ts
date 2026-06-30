import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DrizzleSchema, drizzleAdapter } from "../src/index";

const approval = sqliteTable("approval", {
	id: text("id").primaryKey(),
	status: text("status"),
});
const audit = sqliteTable("audit", {
	seq: integer("seq"),
	name: text("name"),
	hash: text("hash"),
});
const token = sqliteTable("token", {
	id: text("id").primaryKey(),
	digest: text("digest"),
});
const schema: DrizzleSchema = { approval, audit, token };

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
	sqlite = new Database(":memory:");
	sqlite.exec(
		"create table approval (id text primary key, status text); create table audit (seq integer, name text, hash text); create table token (id text primary key, digest text);",
	);
	db = drizzle(sqlite);
});

afterEach(() => sqlite.close());

describe("@euroclaw/storage-drizzle — Drizzle adapter (SQLite)", () => {
	it("create + findOne by a where clause", async () => {
		const a = drizzleAdapter(db, { provider: "sqlite", schema });
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
		const a = drizzleAdapter(db, schema);
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
		const a = drizzleAdapter(db, schema);
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

	it("rejects unknown where fields instead of broadening the query", async () => {
		const a = drizzleAdapter(db, schema);
		await a.create({ model: "approval", data: { id: "x", status: "pending" } });

		await expect(
			a.update({
				model: "approval",
				where: [{ field: "missing", value: "x" }],
				update: { status: "approved" },
			}),
		).rejects.toThrow(/unknown field "missing"/);
		expect(
			await a.findOne({
				model: "approval",
				where: [{ field: "id", value: "x" }],
			}),
		).toMatchObject({ status: "pending" });
	});

	it("update / updateMany / delete / count", async () => {
		const a = drizzleAdapter(db, schema);
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
		const a = drizzleAdapter(db, schema);
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
