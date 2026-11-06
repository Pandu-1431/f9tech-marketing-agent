"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuth, requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { brandByLeadCode, createLead, LeadError, updateLead } from "@/lib/leads";
import { clientIpFrom } from "@/lib/login-throttle";

export type LeadFormState = { error?: string; ok?: boolean } | undefined;

// Public form: at most 5 enquiries per address per 10 minutes (per server process).
const recent = new Map<string, number[]>();
function tooMany(ip: string | null): boolean {
  if (!ip) return false;
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > 5;
}

/** The public enquiry page (no login): a visitor sends their details to the business. */
export async function submitLeadAction(code: string, _prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  if (String(formData.get("company") ?? "")) return { ok: true }; // honeypot: bots fill every field
  const brand = await brandByLeadCode(code);
  if (!brand) return { error: "This enquiry page is no longer available." };
  if (tooMany(clientIpFrom(await headers()))) return { error: "Too many messages. Please try again in a few minutes." };
  try {
    await createLead(brand.workspaceId, brand.id, {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      source: String(formData.get("ref") ?? "") || "enquiry page",
    });
  } catch (err) {
    if (err instanceof LeadError) return { error: err.message };
    throw err;
  }
  return { ok: true };
}

/** Team: add a lead by hand (a phone call, a DM, a walk-in). */
export async function addLeadAction(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const { workspace } = await requireAuth();
  const brandId = Number(formData.get("brandId"));
  if (!(await getBrand(workspace.id, brandId))) return { error: "Pick a business." };
  try {
    await createLead(workspace.id, brandId, {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      source: String(formData.get("source") ?? "") || "manual",
    });
  } catch (err) {
    if (err instanceof LeadError) return { error: err.message };
    throw err;
  }
  revalidatePath("/leads");
  return { ok: true };
}

export async function updateLeadAction(id: number, formData: FormData) {
  const { workspace } = await requireEditor();
  await updateLead(workspace.id, id, {
    status: formData.get("status") ? String(formData.get("status")) : undefined,
    notes: formData.has("notes") ? String(formData.get("notes")) : undefined,
  });
  revalidatePath("/leads");
}
