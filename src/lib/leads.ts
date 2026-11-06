import crypto from "node:crypto";
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Lead } from "@/db/schema";

/*
 * Leads (a small CRM): enquiries from the public enquiry page /l/<code>, or added by hand.
 * Follow-up happens on WhatsApp with a click-to-chat link (free, no API needed).
 */

export const LEAD_STATUSES = ["new", "contacted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", won: "Customer", lost: "Lost" };

export class LeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadError";
  }
}

/** The brand's public enquiry page code (made the first time it is needed). */
export async function leadCodeFor(workspaceId: number, brandId: number): Promise<string> {
  const db = await getDb();
  const [b] = await db.select({ code: schema.brands.leadCode }).from(schema.brands).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  if (!b) throw new LeadError("Business not found");
  if (b.code) return b.code;
  for (let i = 0; i < 3; i++) {
    const code = crypto.randomBytes(5).toString("base64url").slice(0, 7);
    try {
      await db.update(schema.brands).set({ leadCode: code }).where(and(eq(schema.brands.id, brandId), sql`${schema.brands.leadCode} is null`));
      const [after] = await db.select({ code: schema.brands.leadCode }).from(schema.brands).where(eq(schema.brands.id, brandId));
      if (after?.code) return after.code;
    } catch {
      // code taken: try another
    }
  }
  throw new LeadError("Could not make an enquiry page code");
}

export async function brandByLeadCode(code: string): Promise<Brand | null> {
  if (!/^[\w-]{4,16}$/.test(code)) return null;
  const db = await getDb();
  const [b] = await db.select().from(schema.brands).where(eq(schema.brands.leadCode, code));
  return b ?? null;
}

/** Indian numbers: 10 digits get +91. Returns digits only (for wa.me), or null. */
export function normalisePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** WhatsApp click-to-chat link with a ready message. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const p = normalisePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : null;
}

export type LeadInput = { name: string; phone?: string | null; email?: string | null; message?: string | null; source?: string | null; postId?: number | null };

export function validateLead(input: LeadInput): LeadInput {
  const name = input.name.trim().slice(0, 120);
  const phone = (input.phone ?? "").trim().slice(0, 30) || null;
  const email = (input.email ?? "").trim().slice(0, 160) || null;
  if (name.length < 2) throw new LeadError("Please enter your name.");
  if (!phone && !email) throw new LeadError("Please enter a phone number or an email so we can reply.");
  if (phone && !normalisePhone(phone)) throw new LeadError("Please check the phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LeadError("Please check the email address.");
  return { name, phone, email, message: (input.message ?? "").trim().slice(0, 2000) || null, source: (input.source ?? "").trim().slice(0, 60) || null, postId: input.postId ?? null };
}

export async function createLead(workspaceId: number, brandId: number, input: LeadInput): Promise<Lead> {
  const v = validateLead(input);
  const db = await getDb();
  // The same person sending the form twice within an hour is one enquiry.
  if (v.phone || v.email) {
    const since = new Date(Date.now() - 3600_000);
    const [dupe] = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.brandId, brandId), gte(schema.leads.createdAt, since), v.phone ? eq(schema.leads.phone, v.phone) : eq(schema.leads.email, v.email!)));
    if (dupe) return dupe;
  }
  const [row] = await db
    .insert(schema.leads)
    .values({ workspaceId, brandId, name: v.name, phone: v.phone, email: v.email, message: v.message, source: v.source ?? "enquiry page", postId: v.postId })
    .returning();
  return row;
}

export async function listLeads(workspaceId: number, opts: { brandId?: number; status?: string } = {}) {
  const db = await getDb();
  const where = [eq(schema.leads.workspaceId, workspaceId)];
  if (opts.brandId) where.push(eq(schema.leads.brandId, opts.brandId));
  if (opts.status && (LEAD_STATUSES as readonly string[]).includes(opts.status)) where.push(eq(schema.leads.status, opts.status));
  return db
    .select({ lead: schema.leads, brandName: schema.brands.name })
    .from(schema.leads)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.leads.brandId))
    .where(and(...where))
    .orderBy(desc(schema.leads.createdAt))
    .limit(300);
}

export async function updateLead(workspaceId: number, id: number, values: { status?: string; notes?: string | null }) {
  const db = await getDb();
  const set: Partial<typeof schema.leads.$inferInsert> = { updatedAt: new Date() };
  if (values.status && (LEAD_STATUSES as readonly string[]).includes(values.status)) set.status = values.status;
  if (values.notes !== undefined) set.notes = values.notes?.trim().slice(0, 2000) || null;
  const [row] = await db.update(schema.leads).set(set).where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.id, id))).returning();
  return row ?? null;
}

export async function newLeadCount(workspaceId: number): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(schema.leads).where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.status, "new")));
  return Number(r?.n ?? 0);
}

export async function leadsSince(workspaceId: number, brandId: number, since: Date): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(schema.leads).where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.brandId, brandId), gte(schema.leads.createdAt, since)));
  return Number(r?.n ?? 0);
}

/** A short, friendly first WhatsApp message (no AI needed; the owner edits it before sending). */
export function followUpText(brand: Pick<Brand, "name">, lead: Pick<Lead, "name" | "message">): string {
  const first = lead.name.split(/\s+/)[0];
  const about = lead.message ? ` about "${lead.message.slice(0, 80)}${lead.message.length > 80 ? "…" : ""}"` : "";
  return `Hi ${first}, thank you for your enquiry${about}. This is ${brand.name}. When is a good time to talk?`;
}

export async function leadsBetween(workspaceId: number, brandId: number, from: Date, to: Date): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ n: count() })
    .from(schema.leads)
    .where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.brandId, brandId), gte(schema.leads.createdAt, from), lt(schema.leads.createdAt, to)));
  return Number(r?.n ?? 0);
}
