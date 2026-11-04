"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/session";
import { freePlan } from "@/lib/config";
import { acceptInvite, findOpenInvite, TeamError } from "@/lib/team";
import { clientIpFrom, FAILED_MESSAGE, lockedMessage, lockedUntil, recordFailure, recordSuccess, throttleKeys } from "@/lib/login-throttle";

export type FormState = { error?: string } | undefined;

const baseRegister = {
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.email("Enter a valid email").max(200).transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
};
const registerSchema = z.object({ ...baseRegister, business: z.string().trim().min(2, "Enter your business or agency name").max(160) });
const inviteRegisterSchema = z.object({ ...baseRegister, invite: z.string().min(10).max(100) });

/** Only same-site invite pages are allowed as a "next" target after login (no open redirect). */
function safeNext(next: FormDataEntryValue | null): string {
  const v = String(next ?? "");
  return /^\/invite\/[A-Za-z0-9_-]{10,100}$/.test(v) ? v : "/dashboard";
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (formData.get("invite")) return registerWithInvite(formData);
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { name, business, email, password } = parsed.data;

  const db = await getDb();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) return { error: "An account with this email already exists. Please log in." };

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = await db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ name, email, passwordHash }).returning();
    // trialEndsAt only matters when AGENT_TRIAL_DAYS > 0; otherwise the column default is kept.
    const days = freePlan().trialDays;
    const trialEndsAt = days > 0 ? new Date(Date.now() + days * 86400000) : undefined;
    const [ws] = await tx.insert(schema.workspaces).values({ name: business, ownerId: user.id, ...(trialEndsAt ? { trialEndsAt } : {}) }).returning();
    await tx.insert(schema.memberships).values({ workspaceId: ws.id, userId: user.id, role: "owner" });
    await tx.update(schema.users).set({ currentWorkspaceId: ws.id }).where(eq(schema.users.id, user.id));
    return user.id;
  });

  const session = await getSession();
  session.userId = userId;
  await session.save();
  redirect("/dashboard");
}

/** Sign-up from an invite link: the new user joins that workspace only (no workspace of their own). */
async function registerWithInvite(formData: FormData): Promise<FormState> {
  const parsed = inviteRegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { name, email, password, invite: token } = parsed.data;
  if (!(await findOpenInvite(token))) return { error: "This invite link has expired or was already used. Ask for a new one." };

  const db = await getDb();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) return { error: "An account with this email already exists. Log in to accept the invite." };

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(schema.users).values({ name, email, passwordHash }).returning();
  try {
    await acceptInvite(token, user.id);
  } catch (err) {
    await db.delete(schema.users).where(eq(schema.users.id, user.id)); // don't leave an account with no workspace
    if (err instanceof TeamError) return { error: err.message };
    throw err;
  }
  const session = await getSession();
  session.userId = user.id;
  await session.save();
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

// Compared against when the email is unknown, so both cases take the same time.
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync(crypto.randomUUID(), 10));

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password" };

  const keys = throttleKeys(parsed.data.email, clientIpFrom(await headers()));
  if (await lockedUntil(keys)) return { error: lockedMessage() };

  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email));
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? getDummyHash());
  if (!user || !ok) {
    await recordFailure(keys);
    // If this failure just triggered a lock, say so; otherwise the same message for every failure.
    return { error: (await lockedUntil(keys)) ? lockedMessage() : FAILED_MESSAGE };
  }

  await recordSuccess(keys);
  const next = safeNext(formData.get("next"));
  if (next === "/dashboard") {
    // E.g. a client reviewer who was removed from the only workspace they had.
    const [m] = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
    if (!m) return { error: "Your account is not part of any workspace now. Ask the owner for a new invite link." };
  }
  const session = await getSession();
  session.userId = user.id;
  await session.save();
  redirect(next);
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
