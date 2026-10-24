"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireEditor } from "@/lib/auth";
import { createBrand, deleteBrand, LimitError, updateBrand } from "@/lib/data";
import type { FormState } from "./auth";

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
});

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
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" } as const;
  return {
    data: {
      ...parsed.data,
      colors: csv(formData.get("colors")),
      fonts: csv(formData.get("fonts")),
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
    await createBrand(workspace.id, input.data);
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
  revalidatePath("/brands");
  redirect("/brands");
}

export async function deleteBrandAction(id: number) {
  const { workspace } = await requireEditor();
  await deleteBrand(workspace.id, id);
  revalidatePath("/brands");
  redirect("/brands");
}
