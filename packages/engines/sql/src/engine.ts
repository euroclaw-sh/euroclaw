import type { EuroclawPlugin } from "@euroclaw/contracts";
import type {
	ClawEngineFactory,
	ClawEngineHandle,
	ClawEngineInstance,
	EngineContinueRunInput,
	EngineRunHandle,
	EngineStartRunInput,
} from "@euroclaw/engine-core";
import { drainWork as drainEngineWork } from "@euroclaw/engine-core";
import type { Runtime } from "@euroclaw/runtime";
import type { SqlEngineStore } from "./store";
import type {
	SqlEngineWorkerConfig,
	WorkerTickOptions,
	WorkerTickResult,
} from "./worker";
import {
	createSqlEngineWorker,
	RUNTIME_CONTINUE_RUN_TASK,
	RUNTIME_RUN_TASK,
} from "./worker";

export type SqlEngineConfig = {
	store: SqlEngineStore;
	workerId?: string;
	leaseTtlMs?: number;
	/**
	 * Invocation soft deadline for cron-driven work, in ms (e.g. 240_000 of Vercel's 300s budget).
	 * Computed ONCE per cron invocation: the drain stops claiming past it, and an in-flight run
	 * parks a yield checkpoint + continuation task instead of being killed by the platform.
	 * Unset = never yield (daemon/no-timeout hosts).
	 */
	softDeadlineMs?: number;
	/** Time source — for deterministic deadlines in tests. */
	now?: () => string;
	cron?: false | { limit?: number };
};

type SqlEngineCronFlag<Config extends SqlEngineConfig> = Config extends {
	cron: false;
}
	? "no-cron"
	: "has-cron";

export type SqlEngineHandle = ClawEngineHandle<WorkerTickResult> & {
	kind: "sql";
	work: (options?: WorkerTickOptions) => Promise<WorkerTickResult>;
};

function createSqlEngineHandle(input: {
	config: SqlEngineConfig;
	runtime: Runtime;
}): SqlEngineHandle {
	const worker = createSqlEngineWorker({
		leaseTtlMs: input.config.leaseTtlMs,
		...(input.config.now !== undefined ? { now: input.config.now } : {}),
		runtime: input.runtime,
		store: input.config.store,
		workerId: input.config.workerId ?? "euroclaw-worker",
	} satisfies SqlEngineWorkerConfig);
	return {
		kind: "sql",
		async startRun(startInput: EngineStartRunInput): Promise<EngineRunHandle> {
			const run = await input.config.store.transaction(async (store) => {
				const run = await store.createRun({
					...startInput.run,
					input: { prompt: startInput.prompt, ctx: startInput.ctx ?? {} },
				});
				await store.enqueueTask({
					kind: RUNTIME_RUN_TASK,
					payload: {
						prompt: startInput.prompt,
						...(startInput.ctx ? { ctx: startInput.ctx } : {}),
					},
					runId: run.id,
				});
				return run;
			});
			return { id: run.id };
		},
		async continueRun(
			continueInput: EngineContinueRunInput,
		): Promise<EngineRunHandle> {
			const run = await input.config.store.transaction(async (store) => {
				const run = await store.createRun({
					...continueInput.run,
					input: {
						approvalId: continueInput.approvalId,
						ctx: continueInput.ctx ?? {},
					},
				});
				await store.enqueueTask({
					kind: RUNTIME_CONTINUE_RUN_TASK,
					payload: {
						approvalId: continueInput.approvalId,
						...(continueInput.ctx ? { ctx: continueInput.ctx } : {}),
					},
					runId: run.id,
				});
				return run;
			});
			return { id: run.id };
		},
		work: (options?: WorkerTickOptions) => worker.tick(options),
	};
}

function addMs(iso: string, ms: number): string {
	return new Date(Date.parse(iso) + ms).toISOString();
}

function sqlCronPlugin<const Config extends SqlEngineConfig>(
	config: Config,
	engine: SqlEngineHandle,
): EuroclawPlugin<SqlEngineCronFlag<Config>> {
	const now = config.now ?? (() => new Date().toISOString());
	return {
		id: "engine-sql",
		cron:
			config.cron === false
				? []
				: [
						{
							id: "engine-sql:work",
							handler: ({ limit }) => {
								// Invocation-scoped, computed ONCE per cron firing: a warm drain that keeps
								// claiming must not grant each task a fresh budget past the platform's wall.
								const deadlineAt =
									config.softDeadlineMs !== undefined
										? addMs(now(), config.softDeadlineMs)
										: undefined;
								return drainEngineWork({
									limit:
										limit ??
										(config.cron === false ? undefined : config.cron?.limit),
									work: () =>
										engine.work(
											deadlineAt !== undefined ? { deadlineAt } : undefined,
										),
								});
							},
						},
					],
	};
}

export function sqlEngine<const Config extends SqlEngineConfig>(
	config: Config,
): ClawEngineFactory<Runtime, SqlEngineHandle, SqlEngineCronFlag<Config>> {
	return {
		kind: "sql",
		create: (
			runtime,
		): ClawEngineInstance<SqlEngineHandle, SqlEngineCronFlag<Config>> => {
			const engine = createSqlEngineHandle({ config, runtime });
			return {
				engine,
				plugins: [sqlCronPlugin(config, engine)],
				runs: {
					get: (id) => config.store.getRun(id),
					events: (runId) => config.store.events(runId),
				},
			};
		},
	};
}
