"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser, requireAuth, requireOwner } from "@/lib/auth";
import { acceptInvite, createInvite, INVITE_ROLES, removeMember, revokeInvite, switchWorkspace, TeamError, type InviteRole } from "@/lib/team";

export type InviteState = { error?: string; link?: string; role?: string; label?: string | null } | undefined;

/** Base URL for invite links: APP_URL when set (production), else the request's own host. */
async function baseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { workspace, user } = await requireOwner();
  const role = String(formData.get("role") ?? "client") as InviteRole;
  if (!INVITE_ROLES.includes(role)) return { error: "Pick a role" };
  const label = String(formData.get("label") ?? "").trim() || null;
  try {
    const { token } = await createInvite(workspace.id, { role, label, createdBy: user.id });
    revalidatePath("/settings/team");
    return { link: `${await baseUrl()}/invite/${token}`, role, label };
  } catch (err) {
    if (err instanceof TeamError) return { error: err.message };
    throw err;
  }
}

export async function revokeInviteAction(inviteId: number) {
  const { workspace } = await requireOwner();
  await revokeInvite(workspace.id, inviteId);
  revalidatePath("/settings/team");
}

export async function removeMemberAction(membershipId: number) {
  const { workspace } = await requireOwner();
  await removeMember(workspace.id, membershipId);
  revalidatePath("/settings/team");
}

/** "Join workspace" button on the invite page, for a user who is already logged in. */
export async function acceptInviteAction(token: string): Promise<{ error?: string } | undefined> {
  const user = await getSessionUser();
  if (!user) redirect(`/login`);
  try {
    await acceptInvite(token, user.id);
  } catch (err) {
    if (err instanceof TeamError) return { error: err.message };
    throw err;
  }
  redirect("/dashboard");
}

export async function switchWorkspaceAction(formData: FormData) {
  const { user } = await requireAuth();
  await switchWorkspace(user.id, Number(formData.get("workspaceId")));
  redirect("/dashboard");
}
