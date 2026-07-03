import {
	type EventSink,
	jsonObject,
	jsonValue,
	RESERVED_CONTEXT_PREFIX,
	validationError,
} from "@euroclaw/contracts";
import { type as ark } from "arktype";

export const RUNTIME_RECORDING_CONTEXT_KEY = `${RESERVED_CONTEXT_PREFIX}recording`;
export const RUNTIME_RECORDING_OPTION: unique symbol = Symbol(
	"euroclaw.runtime.recording",
);

export const runtimeRecordingContext = ark({
	clawId: "string",
	threadId: "string",
	"runId?": "string | undefined",
	"userMessageId?": "string | undefined",
});
export type RuntimeRecordingContext = typeof runtimeRecordingContext.infer;

const runtimeEventBaseShape = {
	id: "string",
	createdAt: "string",
	"runId?": "string | undefined",
	"recording?": runtimeRecordingContext.or("undefined"),
} as const;

export const runStartedEvent = ark({
	...runtimeEventBaseShape,
	type: "'run.started'",
	prompt: "string",
});

export const runCompletedEvent = ark({
	...runtimeEventBaseShape,
	type: "'run.completed'",
	text: "string",
	steps: "number",
});

export const runWaitingApprovalEvent = ark({
	...runtimeEventBaseShape,
	type: "'run.waiting_approval'",
	text: "string",
	steps: "number",
	"approvalIds?": ark("string").array().or("undefined"),
});

export const runYieldedEvent = ark({
	...runtimeEventBaseShape,
	type: "'run.yielded'",
	steps: "number",
	checkpointId: "string",
});

export const runDeniedEvent = ark({
	...runtimeEventBaseShape,
	type: "'run.denied'",
	text: "string",
	steps: "number",
	approvalId: "string",
	"decidedBy?": "string | undefined",
	"reasonCode?": "string | undefined",
});

export const toolCalledEvent = ark({
	...runtimeEventBaseShape,
	type: "'tool.called'",
	step: "number",
	toolCallId: "string",
	toolName: "string",
	args: jsonObject,
});

export const toolCompletedEvent = ark({
	...runtimeEventBaseShape,
	type: "'tool.completed'",
	step: "number",
	toolCallId: "string",
	toolName: "string",
	"effectId?": "string | undefined",
	"output?": jsonValue.or("undefined"),
});

export const toolWaitingApprovalEvent = ark({
	...runtimeEventBaseShape,
	type: "'tool.waiting_approval'",
	step: "number",
	toolCallId: "string",
	toolName: "string",
	approvalIds: ark("string").array(),
});

export const toolDeniedEvent = ark({
	...runtimeEventBaseShape,
	type: "'tool.denied'",
	step: "number",
	toolCallId: "string",
	toolName: "string",
	reason: "string",
	"decidedBy?": "string | undefined",
	"reasonCode?": "string | undefined",
});

export const toolFailedEvent = ark({
	...runtimeEventBaseShape,
	type: "'tool.failed'",
	step: "number",
	toolCallId: "string",
	toolName: "string",
	error: jsonObject,
});

export const runtimeEvent = runStartedEvent
	.or(runCompletedEvent)
	.or(runWaitingApprovalEvent)
	.or(runYieldedEvent)
	.or(runDeniedEvent)
	.or(toolCalledEvent)
	.or(toolCompletedEvent)
	.or(toolWaitingApprovalEvent)
	.or(toolDeniedEvent)
	.or(toolFailedEvent);

export type RuntimeEvent = typeof runtimeEvent.infer;

export type RuntimeEventBase = Pick<
	RuntimeEvent,
	"createdAt" | "id" | "recording" | "runId"
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, Extract<keyof T, K>>
	: never;

export type RuntimeEventPayload = DistributiveOmit<
	RuntimeEvent,
	"createdAt" | "id" | "recording" | "runId"
>;

export type RuntimeEventPayloadInput = { type: RuntimeEvent["type"] } & Record<
	string,
	unknown
>;

// The runtime's event sink is the core `EventSink` port specialised to the concrete RuntimeEvent
// union — `RuntimeEvent` carries `type: string`, so it satisfies the base `event` shape core owns.
export type RuntimeEventSink = EventSink<RuntimeEvent>;

export function createRuntimeEvent(input: {
	createdAt: string;
	id: string;
	payload: RuntimeEventPayloadInput;
	recording?: RuntimeRecordingContext;
	runId?: string;
}): RuntimeEvent {
	const candidate = {
		createdAt: input.createdAt,
		id: input.id,
		recording: input.recording,
		runId: input.runId ?? input.recording?.runId,
		...input.payload,
	};
	const valid = runtimeEvent(candidate);
	if (valid instanceof ark.errors) {
		throw validationError("runtime event invalid", valid.summary);
	}
	return valid;
}

export function eventSinksFrom(
	input: RuntimeEventSink | readonly RuntimeEventSink[] | undefined,
): readonly RuntimeEventSink[] {
	if (!input) return [];
	return "emit" in input ? [input] : input;
}

export function runtimeRecordingContextFrom(
	ctx: Record<string, unknown> | undefined,
): RuntimeRecordingContext | undefined {
	const value = ctx?.[RUNTIME_RECORDING_CONTEXT_KEY];
	if (value === undefined) return undefined;
	const valid = runtimeRecordingContext(value);
	if (valid instanceof ark.errors) {
		throw validationError("runtime recording context invalid", valid.summary);
	}
	return valid;
}

/**
 * Adapt the runtime's operational event sinks to the neutral `EventSink` port handed to plugins
 * via `EuroclawPluginConfigureContext.events`. Plugin-emitted events share the runtime's single
 * operational stream; each sink reads `type` and ignores events it doesn't recognise (e.g. the
 * durable sink early-returns), so a plugin event simply lands wherever a sink knows what to do
 * with it. The cast is the documented seam: plugin events are base `event`s today and become part
 * of the `RuntimeEvent` union as concrete schemas (skill.*, channel.*) are added in later tasks.
 */
export function pluginEventSink(sinks: readonly RuntimeEventSink[]): EventSink {
	return {
		async emit(event) {
			for (const sink of sinks) await sink.emit(event as RuntimeEvent);
		},
	};
}

export async function emitRuntimeEvent(
	sinks: readonly RuntimeEventSink[],
	event: RuntimeEvent,
): Promise<void> {
	const valid = runtimeEvent(event);
	if (valid instanceof ark.errors) {
		throw validationError("runtime event invalid", valid.summary);
	}
	for (const sink of sinks) await sink.emit(valid);
}
