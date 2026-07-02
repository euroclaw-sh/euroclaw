import { RESERVED_CONTEXT_PREFIX } from "@euroclaw/contracts";

/**
 * The reserved tool-name namespace. Just as `euroclaw__` context keys are governance-owned —
 * stripped from caller input, written only by trusted resolution — `euroclaw__` tool names are
 * host-installed governance/selection machinery: the model-facing meta-tools a tool layer uses to
 * discover, read, or activate capabilities. They are not user/capability tools that a skill governs,
 * so the skills allowed-tools gate treats them specially:
 *
 *  - EXEMPTS them (plugin.ts): a meta-tool must stay callable even when no skill is active, because
 *    calling one is how an agent gets a skill active in the first place.
 *  - REJECTS them in `allowedTools` (manifest.ts): a skill declaring a reserved name would be a
 *    no-op (the gate exempts it anyway) and a spoofing vector.
 *
 * Only the trusted host registers tools under this prefix; the model cannot inject tool names, so
 * reserving the namespace can't be used to bypass the skills gate.
 */
export const RESERVED_TOOL_PREFIX = RESERVED_CONTEXT_PREFIX;

export function isReservedToolName(name: string): boolean {
	return name.startsWith(RESERVED_TOOL_PREFIX);
}
