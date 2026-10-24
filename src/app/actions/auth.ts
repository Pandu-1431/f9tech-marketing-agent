"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/session";
import { freePlan } from "@/lib/config";

export type FormState = { error?: string } | undefined;

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  business: z.string().trim().min(2, "Enter your business or agency name"),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { name, business, email, password } = parsed.data;

  const db = await getDb();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) return { error: "An account with this email already exists. Please log in." };

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ name, email, passwordHash }).returning();
    const trialEndsAt = new Date(Date.now() + freePlan().trialDays * 86400000);
    const [ws] = await tx.insert(schema.workspaces).values({ name: business, ownerId: user.id, trialEndsAt }).returning();
    await tx.insert(schema.memberships).values({ workspaceId: ws.id, userId: user.id, role: "owner" });
    await tx.update(schema.users).set({ currentWorkspaceId: ws.id }).where(eq(schema.users.id, user.id));
    return user.id;
  });

  const session = await getSession();
  session.userId = userId;
  await session.save();
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password" };

  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return { error: "Wrong email or password" };
  }

  const session = await getSession();
  session.userId = user.id;
  await session.save();
  redirect("/dashboard");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
