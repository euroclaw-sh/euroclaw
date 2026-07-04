import type { HandleResult } from "@euroclaw/contracts";

/** Governed nested tool invocation, handed to invoker-stamped tools' execute.
 *  Full pipeline (redact → gates → execute → audit); NO effect claim; a
 *  needs-approval outcome is converted to a denied value (see the runtime wiring). */
export type SubInvoke = (
	name: string,
	args: Record<string, unknown>,
	ctx?: Record<string, unknown>,
) => Promise<HandleResult>;

/** An invoker-stamped tool cannot itself be reached through a nested call — fail closed. */
export const NESTED_INVOKER_TOOL = "NESTED_INVOKER_TOOL";
/** A nested call that a gate wants to park has no durable home — fail closed as a value. */
export const NESTED_APPROVAL_UNSUPPORTED = "NESTED_APPROVAL_UNSUPPORTED";
