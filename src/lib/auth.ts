import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSession } from "./session";

export type AuthContext = {
  user: { id: number; name: string; email: string };
  workspace: { id: number; name: string; plan: string };
  role: string;
};

/** Current user + active workspace, or null. Cached per request. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const session = await getSession();
  if (!session.userId) return null;

  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) return null;

  const memberships = await db
    .select({ workspace: schema.workspaces, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, user.id));
  if (memberships.length === 0) return null;

  const active = memberships.find((m) => m.workspace.id === user.currentWorkspaceId) ?? memberships[0];
  return {
    user: { id: user.id, name: user.name, email: user.email },
    workspace: { id: active.workspace.id, name: active.workspace.name, plan: active.workspace.plan },
    role: active.role,
  };
});

/** Use in every dashboard page and server action. Redirects to login if needed. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** Client reviewers can approve and comment, but not change settings. */
export async function requireEditor(): Promise<AuthContext> {
  const auth = await requireAuth();
  if (auth.role === "client") redirect("/dashboard");
  return auth;
}

export async function isMember(userId: number, workspaceId: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)));
  return Boolean(row);
}
