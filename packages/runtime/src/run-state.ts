// Per-run, per-step loop state — mutated across the model loop (runtime, ai-sdk-loop,
// model-middleware). It lives here, not under tools/, because it is LOOP state, not tool
// machinery: keeping it in the tools barrel forced tools/ to reach upward into ../events and
// ../runtime and mixed loop concerns into the tool subsystem's public surface.

import { stateError } from "@euroclaw/contracts";
import type { ModelMessage } from "ai";
import type { RuntimeRecordingContext } from "./events";
import type { RuntimeAbortSignal } from "./runtime";

export type RunState = {
	currentToolCallId: string;
	currentToolName: string;
	currentToolInput: unknown;
	currentMessages: ModelMessage[];
	currentStep: number;
	currentApprovalWaitId?: string;
	currentEffectId?: string;
	runInstanceId?: string;
	/** Durable run identity (engine run id) — stable across attempts and yield slices. */
	runId?: string;
	currentModelRunner?: () => unknown | Promise<unknown>;
	recording?: RuntimeRecordingContext;
	abortSignal?: RuntimeAbortSignal;
};

export function createRunState(): RunState {
	return {
		currentToolCallId: "",
		currentToolName: "",
		currentToolInput: undefined,
		currentMessages: [],
		currentStep: 0,
	};
}

/** Throw if the run was aborted — checked at each loop/tool boundary. */
export function abortIfNeeded(signal: RuntimeAbortSignal | undefined): void {
	if (signal?.aborted) throw stateError("runtime aborted");
}
