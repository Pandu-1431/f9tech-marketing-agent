import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/*
 * Team members and invite links.
 * Roles: owner (one per workspace, everything) | editor (everything except the team) | client (view, approve, reject).
 * Invites are single-use links that expire. Only a hash of the token is stored.
 */

export type Role = "owner" | "editor" | "client";
export type InviteRole = "editor" | "client";
export const INVITE_ROLES: InviteRole[] = ["client", "editor"];
export const ROLE_LABELS: Record<string, string> = { owner: "Owner", editor: "Editor", client: "Client reviewer" };

export const INVITE_DAYS = 7;
export const MAX_OPEN_INVITES = 20;
export const MAX_MEMBERS = 15;

/** Who may change content (captions, posters, brands, campaigns, AI settings). */
export const canEditContent = (role: string) => role === "owner" || role === "editor";
/** Who may manage the team (invite, revoke, remove). */
export const canManageTeam = (role: string) => role === "owner";

export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates an invite and returns the raw token (shown to the owner once, never stored). */
export async function createInvite(workspaceId: number, input: { role: InviteRole; label?: string | null; createdBy: number }) {
  if (!INVITE_ROLES.includes(input.role)) throw new TeamError("Pick a role");
  const db = await getDb();
  const [open] = await db
    .select({ n: count() })
    .from(schema.invites)
    .where(and(eq(schema.invites.workspaceId, workspaceId), isNull(schema.invites.acceptedAt), isNull(schema.invites.revokedAt), gt(schema.invites.expiresAt, new Date())));
  if (Number(open?.n ?? 0) >= MAX_OPEN_INVITES) throw new TeamError(`You have ${MAX_OPEN_INVITES} open invites. Revoke some before making more.`);
  const [members] = await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.workspaceId, workspaceId));
  if (Number(members?.n ?? 0) >= MAX_MEMBERS) throw new TeamError(`A workspace can have up to ${MAX_MEMBERS} members.`);

  const token = randomBytes(24).toString("base64url");
  const [invite] = await db
    .insert(schema.invites)
    .values({
      workspaceId,
      role: input.role,
      label: input.label?.trim().slice(0, 120) || null,
      tokenHash: hashToken(token),
      createdBy: input.createdBy,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
    })
    .returning();
  return { invite, token };
}

/** The invite behind a link, with its workspace name, if it can still be used. */
export async function findOpenInvite(token: string) {
  if (!token || token.length > 100) return null;
  const db = await getDb();
  const [row] = await db
    .select({ invite: schema.invites, workspaceName: schema.workspaces.name })
    .from(schema.invites)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.invites.workspaceId))
    .where(eq(schema.invites.tokenHash, hashToken(token)));
  if (!row) return null;
  const { invite } = row;
  if (invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) return null;
  return row;
}

/**
 * Uses an invite: adds the user to the workspace with the invite's role and makes it their
 * current workspace. Single use (atomic). An existing member keeps their role (never downgraded).
 */
export async function acceptInvite(token: string, userId: number) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .update(schema.invites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(
        and(
          eq(schema.invites.tokenHash, hashToken(token)),
          isNull(schema.invites.acceptedAt),
          isNull(schema.invites.revokedAt),
          gt(schema.invites.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!invite) throw new TeamError("This invite link has expired or was already used. Ask for a new one.");
    await tx
      .insert(schema.memberships)
      .values({ workspaceId: invite.workspaceId, userId, role: invite.role })
      .onConflictDoNothing({ target: [schema.memberships.workspaceId, schema.memberships.userId] });
    await tx.update(schema.users).set({ currentWorkspaceId: invite.workspaceId }).where(eq(schema.users.id, userId));
    return invite;
  });
}

export async function revokeInvite(workspaceId: number, inviteId: number) {
  const db = await getDb();
  const [row] = await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invites.workspaceId, workspaceId), eq(schema.invites.id, inviteId), isNull(schema.invites.acceptedAt)))
    .returning();
  return row ?? null;
}

export async function listOpenInvites(workspaceId: number) {
  const db = await getDb();
  return db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.workspaceId, workspaceId), isNull(schema.invites.acceptedAt), isNull(schema.invites.revokedAt), gt(schema.invites.expiresAt, new Date())))
    .orderBy(asc(schema.invites.id));
}

export async function listMembers(workspaceId: number) {
  const db = await getDb();
  return db
    .select({ id: schema.memberships.id, userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, since: schema.memberships.createdAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, workspaceId))
    .orderBy(sql`CASE ${schema.memberships.role} WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END`, asc(schema.users.name));
}

/** Removes a member (never the owner). If it was their current workspace, they fall back to another one. */
export async function removeMember(workspaceId: number, membershipId: number) {
  const db = await getDb();
  const [row] = await db
    .delete(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.id, membershipId), ne(schema.memberships.role, "owner")))
    .returning();
  if (row) {
    await db
      .update(schema.users)
      .set({ currentWorkspaceId: null })
      .where(and(eq(schema.users.id, row.userId), eq(schema.users.currentWorkspaceId, workspaceId)));
  }
  return row ?? null;
}

/** All workspaces a user belongs to (for the workspace switcher). */
export async function listMyWorkspaces(userId: number) {
  const db = await getDb();
  return db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.workspaces.name));
}

/** Switch the active workspace; only to one the user is a member of. */
export async function switchWorkspace(userId: number, workspaceId: number) {
  const db = await getDb();
  const [m] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)));
  if (!m) return false;
  await db.update(schema.users).set({ currentWorkspaceId: workspaceId }).where(eq(schema.users.id, userId));
  return true;
}
