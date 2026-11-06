"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { saveChannel } from "@/agent/publish";
import { listPages } from "@/agent/publish/meta-connect";
import { META_PICK_COOKIE, pickCookieOptions, pickCookieValue, readPick } from "@/lib/meta-pick";

/** Paste any Facebook token (user or Page): the next screen lists the Pages to pick from. */
export async function metaPasteTokenAction(brandId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 20) redirect(`/brands/${brandId}?meta=bad-token#channels`);
  (await cookies()).set(META_PICK_COOKIE, pickCookieValue(brandId, token), pickCookieOptions);
  redirect(`/brands/${brandId}/connect/meta`);
}

/** Connect the chosen Page, and its Instagram account when there is one (and the owner wants it). */
export async function connectMetaPageAction(brandId: number, pageId: string, formData: FormData) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  const token = await readPick(brandId);
  if (!token) redirect(`/brands/${brandId}?meta=expired#channels`);
  const page = (await listPages(token).catch(() => [])).find((p) => p.id === pageId);
  if (!page) redirect(`/brands/${brandId}?meta=failed#channels`);
  await saveChannel(workspace.id, brandId, "facebook", page.name, page.token, { pageId: page.id });
  const withIg = formData.get("instagram") === "on" && page.instagram;
  if (withIg && page.instagram) await saveChannel(workspace.id, brandId, "instagram", `@${page.instagram.username}`, page.token, { igUserId: page.instagram.id, username: page.instagram.username });
  (await cookies()).delete(META_PICK_COOKIE);
  revalidatePath(`/brands/${brandId}`);
  redirect(`/brands/${brandId}?meta=${withIg ? "connected-both" : "connected"}#channels`);
}
