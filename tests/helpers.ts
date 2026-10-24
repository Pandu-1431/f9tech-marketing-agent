import { getDb, resetDbForTests, schema } from "@/db";

export async function freshDb() {
  await resetDbForTests();
  return getDb();
}

export async function makeWorkspace(name = "Acme") {
  const db = await getDb();
  const [user] = await db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}@test.dev`, passwordHash: "x" })
    .returning();
  const [ws] = await db.insert(schema.workspaces).values({ name, ownerId: user.id }).returning();
  await db.insert(schema.memberships).values({ workspaceId: ws.id, userId: user.id, role: "owner" });
  return { user, ws };
}
