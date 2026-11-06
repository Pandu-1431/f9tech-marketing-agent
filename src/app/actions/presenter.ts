"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { createAiPresenter, uploadPresenter } from "@/agent/video/presenter";

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Make a new AI presenter face for the brand ("Try another face" shows a different person). */
export async function makePresenterAction(brandId: number) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  // Each click gives the next look (man / woman alternate) so "Try another face" really changes it.
  const variant = Math.floor(Date.now() / 1000) % 97;
  let status = "made";
  try {
    if (!(await createAiPresenter(brand, variant))) status = "no-ai";
  } catch {
    status = "failed";
  }
  revalidatePath(`/brands/${brandId}`);
  redirect(`/brands/${brandId}?presenter=${status}#presenter`);
}

/** Use a real photo (the owner or a staff member) as the presenter. */
export async function uploadPresenterAction(brandId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand) return;
  const file = formData.get("photo");
  let status = "uploaded";
  if (!(file instanceof File) || file.size === 0) status = "no-file";
  else if (!PHOTO_TYPES.includes(file.type) || file.size > 5 * 1024 * 1024) status = "bad-file";
  else {
    try {
      await uploadPresenter(brand, Buffer.from(await file.arrayBuffer()), String(formData.get("name") ?? ""));
    } catch {
      status = "bad-file";
    }
  }
  revalidatePath(`/brands/${brandId}`);
  redirect(`/brands/${brandId}?presenter=${status}#presenter`);
}
