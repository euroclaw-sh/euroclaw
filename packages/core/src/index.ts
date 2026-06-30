// @euroclaw/core — the governance & privacy KERNEL: the redactor (privacy enforcement), the
// hash-chained audit, the approval gate, and createGovernance (the non-bypassable pipeline).
// The protocol everyone speaks — boundary/plugin/entity contracts, ports, schemas — is
// @euroclaw/contracts; import it directly. Core does NOT re-export it.
export { approvalGate } from "./approval";
export {
	auditGate,
	createMemoryAudit,
	headOf,
	verifyAuditChain,
} from "./audit";
export type { Context, Governance, GovernanceConfig } from "./governance";
export { createGovernance } from "./governance";
export {
	createMemoryPiiMappingStore,
	createMemoryRedactor,
	createStoredRedactor,
	noopDetector,
	type StoredRedactorOptions,
} from "./redact";
