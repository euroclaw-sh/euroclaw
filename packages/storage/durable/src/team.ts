// createTeamStore — invite-based team membership over the @euroclaw/storage-core Adapter. The sibling
// of createApprovalStore: `invite` opens a pending invite, `accept` consumes it (single-use, via the
// atomic consumeOne primitive) and creates a member. `roleOf` is what a claw's
// `roleMembership({ roleOf })` calls to resolve the actor's role on a team → which authz then reads.

import type { Adapter, Where } from "@euroclaw/storage-core";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

export type TeamMember = {
	id: string;
	team: string;
	userId: string;
	role: string;
	joinedAt: string;
};
export type TeamInvite = {
	id: string;
	team: string;
	email: string;
	role: string;
	createdAt: string;
};

export type TeamStore = {
	/** Open a pending invite to a team, with a role. */
	invite: (input: {
		team: string;
		email: string;
		role: string;
	}) => Promise<TeamInvite>;
	/** Accept an invite (single-use) → become a member. Returns the membership, or null if it's gone. */
	accept: (inviteId: string, userId: string) => Promise<TeamMember | null>;
	/** List a team's members. */
	members: (team: string) => Promise<TeamMember[]>;
	/** The actor's role on a team, or null if not a member — what `roleMembership({ roleOf })` calls. */
	roleOf: (team: string, userId: string) => Promise<string | null>;
	/** Revoke a member's access to a team. */
	remove: (team: string, userId: string) => Promise<void>;
};

export type TeamStoreOptions = { now?: () => string };

const newId = (): string => bytesToHex(randomBytes(16));

export function createTeamStore(
	adapter: Adapter,
	options: TeamStoreOptions = {},
): TeamStore {
	const now = options.now ?? (() => new Date().toISOString());
	const memberWhere = (team: string, userId: string): Where[] => [
		{ field: "team", value: team },
		{ field: "userId", value: userId, connector: "AND" },
	];

	return {
		async invite({ team, email, role }) {
			const invite: TeamInvite = {
				id: newId(),
				team,
				email,
				role,
				createdAt: now(),
			};
			await adapter.create({ model: "team_invite", data: invite });
			return invite;
		},

		async accept(inviteId, userId) {
			// Single-use: atomically consume the invite, then create the membership.
			const invite = await adapter.consumeOne<TeamInvite>({
				model: "team_invite",
				where: [{ field: "id", value: inviteId }],
			});
			if (!invite) return null;
			const member: TeamMember = {
				id: newId(),
				team: invite.team,
				userId,
				role: invite.role,
				joinedAt: now(),
			};
			await adapter.create({ model: "team_member", data: member });
			return member;
		},

		async members(team) {
			return adapter.findMany<TeamMember>({
				model: "team_member",
				where: [{ field: "team", value: team }],
			});
		},

		async roleOf(team, userId) {
			const member = await adapter.findOne<TeamMember>({
				model: "team_member",
				where: memberWhere(team, userId),
			});
			return member?.role ?? null;
		},

		async remove(team, userId) {
			await adapter.delete({
				model: "team_member",
				where: memberWhere(team, userId),
			});
		},
	};
}
