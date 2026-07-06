// The runtime's egress binding. The pure network floor lives in @euroclaw/egress (foundation,
// Node-free — SSRF range guard, https-only, DNS pinning); this thin shim binds Node's DNS resolver
// as the default `lookup`, so every runtime caller keeps resolving via node:dns unless it injects
// its own resolver. All range logic and pinning are in @euroclaw/egress — this file adds only the
// node:dns default (the one place node:dns is bound for egress) and re-exports the surface, so
// provider.ts / the runtime barrels are untouched.

import { lookup as dnsLookup } from "node:dns/promises";
import {
	assertEgressAllowed as assertEgressAllowedFloor,
	type EgressDecision,
	type EgressLookup,
	type EgressOptions,
} from "@euroclaw/egress";

export { blockedAddressReason } from "@euroclaw/egress";
export type {
	EgressDecision,
	EgressLookup,
	EgressOptions,
	ResolvedAddress,
} from "@euroclaw/egress";

/** The runtime's default resolver — the one place node:dns is bound for egress. */
const nodeLookup: EgressLookup = async (hostname) => {
	const results = await dnsLookup(hostname, { all: true });
	return results.map((entry) => ({
		address: entry.address,
		family: entry.family,
	}));
};

/** Assert an egress target is allowed, defaulting DNS resolution to node:dns. Callers may still
 *  inject their own `lookup` (a caching / pinning resolver, or a test fake). */
export async function assertEgressAllowed(
	url: string,
	options: EgressOptions = {},
): Promise<EgressDecision> {
	return assertEgressAllowedFloor(url, {
		...options,
		lookup: options.lookup ?? nodeLookup,
	});
}
