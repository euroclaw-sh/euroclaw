import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type PrismaLike, prismaAdapter, toWhere } from "./index";

describe("@euroclaw/storage-prisma — Where → Prisma where", () => {
	it("eq, ne, operators, in, contains", () => {
		expect(toWhere([{ field: "id", value: "x" }])).toEqual({ id: "x" });
		expect(toWhere([{ field: "x", operator: "ne", value: 1 }])).toEqual({
			x: { not: 1 },
		});
		expect(toWhere([{ field: "seq", operator: "gte", value: 1 }])).toEqual({
			seq: { gte: 1 },
		});
		expect(toWhere([{ field: "seq", operator: "in", value: [0, 3] }])).toEqual({
			seq: { in: [0, 3] },
		});
		expect(
			toWhere([{ field: "name", operator: "contains", value: "ab" }]),
		).toEqual({ name: { contains: "ab" } });
	});

	it("left-folds AND / OR by connector", () => {
		expect(
			toWhere([
				{ field: "a", value: 1 },
				{ field: "b", value: 2 },
			]),
		).toEqual({ AND: [{ a: 1 }, { b: 2 }] });
		expect(
			toWhere([
				{ field: "a", value: 1 },
				{ field: "b", value: 2, connector: "OR" },
			]),
		).toEqual({
			OR: [{ a: 1 }, { b: 2 }],
		});
		expect(toWhere([])).toEqual({});
	});
});

// Real behavioral coverage against a generated Prisma client + SQLite (prisma generate + db push).
let prisma: PrismaClient;

beforeAll(() => {
	prisma = new PrismaClient();
});

afterAll(async () => {
	await prisma.$disconnect();
});

afterEach(async () => {
	await prisma.token.deleteMany();
	await prisma.audit.deleteMany();
	await prisma.approval.deleteMany();
});

describe("@euroclaw/storage-prisma — adapter against real Prisma (SQLite)", () => {
	const a = () => prismaAdapter(prisma as unknown as PrismaLike);

	it("create + findOne by a where clause", async () => {
		await a().create({
			model: "approval",
			data: { id: "ap1", status: "pending" },
		});
		const got = await a().findOne<{ status: string }>({
			model: "approval",
			where: [{ field: "id", value: "ap1" }],
		});
		expect(got?.status).toBe("pending");
		expect(
			await a().findOne({
				model: "approval",
				where: [{ field: "id", value: "nope" }],
			}),
		).toBeNull();
	});

	it("findMany with operators, sort, limit, offset", async () => {
		for (const seq of [2, 0, 3, 1])
			await a().create({ model: "audit", data: { seq, name: `t${seq}` } });
		const sorted = await a().findMany<{ seq: number }>({
			model: "audit",
			sortBy: { field: "seq", direction: "asc" },
		});
		expect(sorted.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
		const page = await a().findMany<{ seq: number }>({
			model: "audit",
			sortBy: { field: "seq", direction: "asc" },
			offset: 1,
			limit: 2,
		});
		expect(page.map((r) => r.seq)).toEqual([1, 2]);
		const gt = await a().findMany<{ seq: number }>({
			model: "audit",
			where: [{ field: "seq", operator: "gt", value: 1 }],
		});
		expect(gt.map((r) => r.seq).sort()).toEqual([2, 3]);
		const inSet = await a().findMany<{ seq: number }>({
			model: "audit",
			where: [{ field: "seq", operator: "in", value: [0, 3] }],
		});
		expect(inSet.map((r) => r.seq).sort()).toEqual([0, 3]);
	});

	it("update / updateMany / delete / count", async () => {
		await a().create({
			model: "approval",
			data: { id: "x", status: "pending" },
		});
		await a().create({
			model: "approval",
			data: { id: "y", status: "pending" },
		});
		const updated = await a().update<{ status: string }>({
			model: "approval",
			where: [{ field: "id", value: "x" }],
			update: { status: "approved" },
		});
		expect(updated?.status).toBe("approved");

		const transitioned = await a().update<{ status: string }>({
			model: "approval",
			where: [
				{ field: "id", value: "x" },
				{ field: "status", value: "approved", connector: "AND" },
			],
			update: { status: "consumed" },
		});
		expect(transitioned?.status).toBe("consumed");

		expect(
			(
				await a().findOne<{ status: string }>({
					model: "approval",
					where: [{ field: "id", value: "x" }],
				})
			)?.status,
		).toBe("consumed");
		expect(
			await a().updateMany({
				model: "approval",
				where: [{ field: "status", value: "pending" }],
				update: { status: "expired" },
			}),
		).toBe(1);
		expect(await a().count({ model: "approval" })).toBe(2);
		await a().delete({
			model: "approval",
			where: [{ field: "id", value: "y" }],
		});
		expect(await a().count({ model: "approval" })).toBe(1);
	});

	it("consumeOne is single-use and race-safe (deleteMany count-check in a transaction)", async () => {
		await a().create({ model: "token", data: { id: "t1", digest: "abc" } });
		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				a().consumeOne<{ id: string }>({
					model: "token",
					where: [{ field: "id", value: "t1" }],
				}),
			),
		);
		expect(results.filter((r) => r !== null)).toHaveLength(1);
		expect(await a().count({ model: "token" })).toBe(0);
	});
});
