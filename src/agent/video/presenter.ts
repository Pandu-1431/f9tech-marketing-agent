import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Presenter } from "@/db/schema";
import { getFile, newKey, putFile } from "@/lib/storage";
import { isDemoProvider } from "@/lib/data";
import { generateImage } from "../images/router";
import { REEL_H, REEL_W } from "./frames";

/*
 * The brand's presenter: ONE face reused in every presenter video, so viewers meet the same person
 * each time (free image AIs cannot keep a face the same across new images, so we make it once).
 * The owner can replace it with a real photo (themselves or a staff member) on the brand page.
 */

const NAMES = ["Rahul", "Priya", "Arjun", "Ananya", "Karthik", "Sneha", "Vikram", "Divya"];

export function presenterPrompt(brand: Pick<Brand, "id" | "industry" | "city" | "audience">, variant = 0): string {
  const woman = (brand.id + variant) % 2 === 1;
  const who = woman
    ? "a confident adult Indian woman aged about 30, professional presenter and host, hair neatly tied back, simple solid-colour kurta, small earrings"
    : "a confident adult Indian man aged about 30, professional presenter and host, short neat hair, light stubble, plain white t-shirt";
  const where = brand.industry ? `softly blurred ${brand.industry} interior behind` : "softly blurred bright office behind";
  return [
    `Photorealistic vertical portrait photo of ${who}`,
    "looking straight into the camera, mid-sentence with a warm natural smile, upper body visible, hands relaxed",
    where,
    "natural window light, shot on a phone camera, creator vlog style, sharp focus on the face, 9:16, no text",
    "an adult, not a child or teenager, no school uniform",
  ].join(", ");
}

export function presenterName(brand: Pick<Brand, "id">, variant = 0): string {
  return NAMES[(brand.id + variant) % NAMES.length];
}

async function savePresenter(workspaceId: number, brandId: number, png: Buffer, p: Omit<Presenter, "faceKey">, provider: string): Promise<Presenter> {
  const faceKey = newKey(workspaceId, "presenter", "image/png");
  await putFile(faceKey, png, "image/png");
  const db = await getDb();
  await db.insert(schema.assets).values({ workspaceId, brandId, kind: "presenter", storageKey: faceKey, mime: "image/png", width: REEL_W, height: REEL_H, bytes: png.length, provider });
  const presenter: Presenter = { faceKey, ...p };
  await db.update(schema.brands).set({ presenter, updatedAt: new Date() }).where(and(eq(schema.brands.workspaceId, workspaceId), eq(schema.brands.id, brandId)));
  return presenter;
}

/** Make a new AI presenter for the brand. Returns null when only demo art is available (no face). */
export async function createAiPresenter(brand: Brand, variant = 0): Promise<Presenter | null> {
  const img = await generateImage(
    { workspaceId: brand.workspaceId, brandId: brand.id, purpose: "reel_presenter" },
    { prompt: presenterPrompt(brand, variant), width: REEL_W, height: REEL_H, colors: brand.colors, seed: brand.id * 101 + variant },
  );
  if (isDemoProvider(img.provider) || img.provider === "brand_art") return null;
  const png = await sharp(img.data).resize(REEL_W, REEL_H, { fit: "cover", position: "attention" }).png().toBuffer();
  return savePresenter(brand.workspaceId, brand.id, png, { name: presenterName(brand, variant), source: "ai" }, img.provider);
}

/** A real photo uploaded by the owner becomes the presenter. */
export async function uploadPresenter(brand: Brand, photo: Buffer, name: string): Promise<Presenter> {
  const png = await sharp(photo).rotate().resize(REEL_W, REEL_H, { fit: "cover", position: "attention" }).png().toBuffer();
  return savePresenter(brand.workspaceId, brand.id, png, { name: name.trim().slice(0, 30) || "Presenter", source: "upload" }, "upload");
}

/** The presenter's face, making one the first time. null = no face (presenter scenes fall back to scene shots). */
export async function presenterFace(brand: Brand): Promise<{ face: Buffer; name: string } | null> {
  let p = brand.presenter;
  let face = p ? await getFile(p.faceKey) : null;
  if (!p || !face) {
    p = await createAiPresenter(brand);
    face = p ? await getFile(p.faceKey) : null;
  }
  return p && face ? { face, name: p.name } : null;
}
