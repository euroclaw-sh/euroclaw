import type { ToolGovernance } from "@euroclaw/contracts";
import type { Governance } from "@euroclaw/core";
import type { ModelMessage, ToolSet } from "ai";
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

export function registerToolGates(core: Governance, tools: ToolSet): void {
	for (const [name, tool] of Object.entries(tools)) {
		const gate = (tool as { euroclaw?: ToolGovernance }).euroclaw?.gate;
		if (gate) {
			core.registerGate({
				id: `tool:${name}`,
				matcher: (call) => call.name === name,
				handler: gate,
			});
		}
	}
}

export function modelFacingTools(tools: ToolSet): ToolSet {
	return Object.fromEntries(
		Object.entries(tools).map(([name, tool]) => {
			const {
				euroclaw: _euroclaw,
				execute: _execute,
				...rest
			} = tool as Record<string, unknown>;
			return [name, rest];
		}),
	) as ToolSet;
}
