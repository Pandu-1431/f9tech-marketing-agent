"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/schedule";
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, FONT_CHOICES } from "@/lib/font-choices";

const KNOWN_FONTS = new Set(FONT_CHOICES.map((f) => f.family));
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth, requireEditor } from "@/lib/auth";
import { canManageTeam } from "@/lib/team";
import { brandFootprint, deleteBrandForever } from "@/lib/brand-delete";
import { sameName } from "@/lib/names";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createBrand, deleteProductShots, getBrand, LimitError, listProductShots, MAX_PRODUCT_SHOTS, setBrandLogo, updateBrand } from "@/lib/data";
import { getDb, schema } from "@/db";
import { newKey, putFile } from "@/lib/storage";
import sharp from "sharp";
import type { FormState } from "./auth";
import { shotLabel } from "@/lib/shots";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** Save an uploaded logo (max 2 MB) as a PNG asset and attach it to the brand. */
async function saveLogo(workspaceId: number, brandId: number, file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!LOGO_TYPES.includes(file.type)) return "Logo must be PNG, JPG, WEBP or SVG";
  if (file.size > 2 * 1024 * 1024) return "Logo must be under 2 MB";
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer())).resize(600, 600, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    return "Could not read that image";
  }
  const key = newKey(workspaceId, "logo", "image/png");
  await putFile(key, png, "image/png");
  const db = await getDb();
  await db.insert(schema.assets).values({ workspaceId, brandId, kind: "logo", storageKey: key, mime: "image/png", bytes: png.length, provider: "upload" });
  await setBrandLogo(workspaceId, brandId, key);
  return null;
}

/** Save new product screenshots (max 8 per brand, 3 MB each) and remove the ticked ones. */
async function saveShots(workspaceId: number, brandId: number, formData: FormData): Promise<string | null> {
  const remove = formData.getAll("removeShot").map(Number).filter(Number.isFinite);
  await deleteProductShots(workspaceId, brandId, remove);
  const files = formData.getAll("shots").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return null;
  const room = MAX_PRODUCT_SHOTS - (await listProductShots(workspaceId, brandId)).length;
  if (room <= 0) return `You already have ${MAX_PRODUCT_SHOTS} screenshots. Remove some first.`;
  const db = await getDb();
  let skipped = 0;
  for (const file of files.slice(0, room)) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
      skipped++;
      continue;
    }
    let png: Buffer;
    try {
      png = await sharp(Buffer.from(await file.arrayBuffer())).resize(1080, 2400, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      skipped++;
      continue;
    }
    const meta = await sharp(png).metadata();
    const key = newKey(workspaceId, "shot", "image/png");
    await putFile(key, png, "image/png");
    await db.insert(schema.assets).values({
      workspaceId, brandId, kind: "product_shot", storageKey: key, mime: "image/png",
      width: meta.width, height: meta.height, bytes: png.length, prompt: shotLabel(file.name), provider: "upload",
    });
  }
  const over = Math.max(0, files.length - room);
  if (skipped || over) return `${skipped + over} screenshot(s) were not added (PNG/JPG/WEBP under 3 MB, max ${MAX_PRODUCT_SHOTS} in total).`;
  return null;
}

const csv = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const brandSchema = z.object({
  name: z.string().trim().min(2, "Brand name is required").max(160),
  industry: text(120),
  website: text(300),
  city: text(120),
  description: text(2000),
  audience: text(1000),
  tone: text(200),
  language: z.string().trim().min(2).max(60).default("English"),
  dos: text(1000),
  donts: text(1000),
  services: text(3000),
  visualStyle: text(1000),
  keyFacts: text(3000),
  voiceSamples: text(3000),
  pictureSource: z.enum(["real", "ai"]).default("real"),
  timezone: z
    .string()
    .trim()
    .max(60)
    .refine((v) => isValidTimeZone(v), "Pick a valid time zone")
    .default(DEFAULT_TIMEZONE),
});

const HEX = /^#[0-9a-f]{6}$/i;

/** Main + accent colour pickers (plus any extra colours kept from before, or the old CSV field). */
function readColors(formData: FormData): string[] {
  const picked = [formData.get("colorPrimary"), formData.get("colorAccent")].map((v) => String(v ?? "").trim());
  const extra = [...csv(formData.get("colorsExtra")), ...csv(formData.get("colors"))];
  return Array.from(new Set([...picked, ...extra].filter((c) => HEX.test(c)).map((c) => c.toLowerCase()))).slice(0, 6);
}

function readBrand(formData: FormData) {
  const parsed = brandSchema.safeParse({
    name: formData.get("name") ?? "",
    industry: formData.get("industry") ?? "",
    website: formData.get("website") ?? "",
    city: formData.get("city") ?? "",
    description: formData.get("description") ?? "",
    audience: formData.get("audience") ?? "",
    tone: formData.get("tone") ?? "",
    language: formData.get("language") || "English",
    dos: formData.get("dos") ?? "",
    donts: formData.get("donts") ?? "",
    services: formData.get("services") ?? "",
    visualStyle: formData.get("visualStyle") ?? "",
    keyFacts: formData.get("keyFacts") ?? "",
    voiceSamples: formData.get("voiceSamples") ?? "",
    pictureSource: formData.get("pictureSource") || "real",
    timezone: formData.get("timezone") || DEFAULT_TIMEZONE,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" } as const;
  return {
    data: {
      ...parsed.data,
      colors: readColors(formData),
      fonts: [String(formData.get("fontHeading") || DEFAULT_HEADING_FONT), String(formData.get("fontBody") || DEFAULT_BODY_FONT)].filter((f) => KNOWN_FONTS.has(f)),
      keywords: csv(formData.get("keywords")),
      hashtags: csv(formData.get("hashtags")).map((h) => (h.startsWith("#") ? h : `#${h}`)),
      platforms: formData.getAll("platforms").map(String),
    },
  } as const;
}

export async function createBrandAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspace } = await requireEditor();
  const input = readBrand(formData);
  if ("error" in input) return { error: input.error };
  try {
    const brand = await createBrand(workspace.id, input.data);
    const logoError = (await saveLogo(workspace.id, brand.id, formData.get("logo"))) ?? (await saveShots(workspace.id, brand.id, formData));
    if (logoError) return { error: `Saved, but: ${logoError}` };
  } catch (err) {
    if (err instanceof LimitError) return { error: err.message };
    throw err;
  }
  revalidatePath("/brands");
  redirect("/brands");
}

export async function updateBrandAction(id: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const { workspace } = await requireEditor();
  const input = readBrand(formData);
  if ("error" in input) return { error: input.error };
  const row = await updateBrand(workspace.id, id, input.data);
  if (!row) return { error: "Brand not found" };
  const logoError = (await saveLogo(workspace.id, id, formData.get("logo"))) ?? (await saveShots(workspace.id, id, formData));
  if (logoError) return { error: logoError };
  revalidatePath("/brands");
  redirect("/brands");
}

export type DeleteState = { error?: string } | undefined;

// Wrong confirmations per user (per server process): 5 tries, then wait 15 minutes.
const deleteTries = new Map<number, number[]>();

/**
 * Delete a business account for good. Owner only, and only after typing the business name,
 * the account password and ticking "I understand". Its files are removed from storage too.
 */
export async function deleteBrandForeverAction(id: number, _prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const { workspace, user, role } = await requireAuth();
  if (!canManageTeam(role)) return { error: "Only the workspace owner can delete a business account." };
  const brand = await getBrand(workspace.id, id);
  if (!brand) return { error: "This business account no longer exists." };
  const now = Date.now();
  const tries = (deleteTries.get(user.id) ?? []).filter((t) => now - t < 15 * 60_000);
  if (tries.length >= 5) return { error: "Too many wrong tries. Wait 15 minutes and try again." };
  const fail = (error: string): DeleteState => {
    deleteTries.set(user.id, [...tries, now]);
    return { error };
  };
  if (!sameName(String(formData.get("confirmName") ?? ""), brand.name)) return fail(`The name does not match. Type: ${brand.name}`);
  if (formData.get("understand") !== "on") return fail("Tick the box to confirm you understand this cannot be undone.");
  const db = await getDb();
  const [row] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!row || !(await bcrypt.compare(String(formData.get("password") ?? ""), row.hash))) return fail("Wrong password.");
  deleteTries.delete(user.id);
  const before = await brandFootprint(workspace.id, id);
  await deleteBrandForever(workspace.id, id);
  revalidatePath("/brands");
  revalidatePath("/dashboard");
  const q = new URLSearchParams({ deleted: brand.name, posts: String(before.posts), files: String(before.files), bytes: String(before.bytes) });
  redirect(`/brands?${q}`);
}
