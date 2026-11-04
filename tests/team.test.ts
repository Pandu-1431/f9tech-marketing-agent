import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  acceptInvite,
  canEditContent,
  canManageTeam,
  createInvite,
  findOpenInvite,
  hashToken,
  listMembers,
  listMyWorkspaces,
  listOpenInvites,
  MAX_OPEN_INVITES,
  removeMember,
  revokeInvite,
  switchWorkspace,
  TeamError,
} from "@/lib/team";
import { freshDb, makeWorkspace } from "./helpers";

async function makeUser(name: string) {
  const db = await getDb();
  const [user] = await db.insert(schema.users).values({ name, email: `${name}-${Math.random().toString(36).slice(2)}@test.dev`, passwordHash: "x" }).returning();
  return user;
}

describe("team: roles and invite links", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("roles: only owner and editor change content; only the owner manages the team", () => {
    expect(canEditContent("owner")).toBe(true);
    expect(canEditContent("editor")).toBe(true);
    expect(canEditContent("client")).toBe(false);
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("editor")).toBe(false);
    expect(canManageTeam("client")).toBe(false);
  });

  it("stores only a hash of the token, and the link finds the invite", async () => {
    const { ws, user } = await makeWorkspace("Agency");
    const { invite, token } = await createInvite(ws.id, { role: "client", label: "Ravi", createdBy: user.id });
    expect(invite.tokenHash).toBe(hashToken(token));
    expect(invite.tokenHash).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(30);
    const found = await findOpenInvite(token);
    expect(found?.workspaceName).toBe("Agency");
    expect(await findOpenInvite("not-a-real-token-xxxxx")).toBeNull();
  });

  it("accepting adds a client membership, switches to that workspace, and works only once", async () => {
    const { ws, user: owner } = await makeWorkspace("Agency");
    const { token } = await createInvite(ws.id, { role: "client", createdBy: owner.id });
    const client = await makeUser("client");
    await acceptInvite(token, client.id);

    const members = await listMembers(ws.id);
    expect(members.find((m) => m.userId === client.id)?.role).toBe("client");
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, client.id));
    expect(u.currentWorkspaceId).toBe(ws.id);

    const other = await makeUser("other");
    await expect(acceptInvite(token, other.id)).rejects.toBeInstanceOf(TeamError);
    expect(await findOpenInvite(token)).toBeNull();
    expect((await listMembers(ws.id)).some((m) => m.userId === other.id)).toBe(false);
  });

  it("expired and cancelled invites cannot be used", async () => {
    const { ws, user } = await makeWorkspace("Agency");
    const expired = await createInvite(ws.id, { role: "client", createdBy: user.id });
    const db = await getDb();
    await db.update(schema.invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invites.id, expired.invite.id));
    const cancelled = await createInvite(ws.id, { role: "client", createdBy: user.id });
    await revokeInvite(ws.id, cancelled.invite.id);
    const someone = await makeUser("someone");
    await expect(acceptInvite(expired.token, someone.id)).rejects.toBeInstanceOf(TeamError);
    await expect(acceptInvite(cancelled.token, someone.id)).rejects.toBeInstanceOf(TeamError);
    expect(await listOpenInvites(ws.id)).toEqual([]);
  });

  it("an existing member is never downgraded by an invite", async () => {
    const { ws, user: owner } = await makeWorkspace("Agency");
    const { token } = await createInvite(ws.id, { role: "client", createdBy: owner.id });
    await acceptInvite(token, owner.id);
    expect((await listMembers(ws.id)).find((m) => m.userId === owner.id)?.role).toBe("owner");
  });

  it("another workspace cannot cancel an invite or remove a member", async () => {
    const { ws, user: owner } = await makeWorkspace("Agency");
    const { ws: otherWs } = await makeWorkspace("Other");
    const { invite, token } = await createInvite(ws.id, { role: "client", createdBy: owner.id });
    expect(await revokeInvite(otherWs.id, invite.id)).toBeNull();
    expect(await findOpenInvite(token)).not.toBeNull();

    const client = await makeUser("client");
    await acceptInvite(token, client.id);
    const membership = (await listMembers(ws.id)).find((m) => m.userId === client.id)!;
    expect(await removeMember(otherWs.id, membership.id)).toBeNull();
    expect((await listMembers(ws.id)).some((m) => m.userId === client.id)).toBe(true);
  });

  it("the owner cannot be removed; a removed member loses access and their current workspace", async () => {
    const { ws, user: owner } = await makeWorkspace("Agency");
    const ownerMembership = (await listMembers(ws.id)).find((m) => m.userId === owner.id)!;
    expect(await removeMember(ws.id, ownerMembership.id)).toBeNull();

    const { token } = await createInvite(ws.id, { role: "editor", createdBy: owner.id });
    const editor = await makeUser("editor");
    await acceptInvite(token, editor.id);
    const m = (await listMembers(ws.id)).find((x) => x.userId === editor.id)!;
    expect(await removeMember(ws.id, m.id)).not.toBeNull();
    expect(await listMyWorkspaces(editor.id)).toEqual([]);
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, editor.id));
    expect(u.currentWorkspaceId).toBeNull();
  });

  it("switching workspace works only for workspaces the user belongs to", async () => {
    const { ws: a, user } = await makeWorkspace("A");
    const { ws: b, user: bOwner } = await makeWorkspace("B");
    expect(await switchWorkspace(user.id, b.id)).toBe(false);
    const { token } = await createInvite(b.id, { role: "client", createdBy: bOwner.id });
    await acceptInvite(token, user.id);
    expect((await listMyWorkspaces(user.id)).map((w) => w.name)).toEqual(["A", "B"]);
    expect(await switchWorkspace(user.id, a.id)).toBe(true);
  });

  it("limits open invites per workspace", async () => {
    const { ws, user } = await makeWorkspace("Agency");
    for (let i = 0; i < MAX_OPEN_INVITES; i++) await createInvite(ws.id, { role: "client", createdBy: user.id });
    await expect(createInvite(ws.id, { role: "client", createdBy: user.id })).rejects.toBeInstanceOf(TeamError);
  });

  it("refuses an owner invite", async () => {
    const { ws, user } = await makeWorkspace("Agency");
    await expect(createInvite(ws.id, { role: "owner" as never, createdBy: user.id })).rejects.toBeInstanceOf(TeamError);
  });
});
