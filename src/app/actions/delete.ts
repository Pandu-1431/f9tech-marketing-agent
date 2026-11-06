"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { deleteAssets, deleteCampaign } from "@/lib/asset-delete";

/** One image, poster, video, scene, logo or product screenshot (and its file). */
export async function deleteAssetAction(assetId: number, backTo?: string) {
  const { workspace } = await requireEditor();
  await deleteAssets(workspace.id, [assetId]);
  revalidatePath("/library");
  if (backTo) revalidatePath(backTo);
}

/** The business's logo (posters then show the business name). */
export async function removeLogoAction(brandId: number) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand?.logoKey) return;
  const db = await getDb();
  const [asset] = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.workspaceId, workspace.id), eq(schema.assets.storageKey, brand.logoKey)));
  if (asset) await deleteAssets(workspace.id, [asset.id]);
  else await db.update(schema.brands).set({ logoKey: null }).where(eq(schema.brands.id, brandId));
  revalidatePath(`/brands/${brandId}`);
}

/** The presenter photo / AI face (the next presenter video makes a new one). */
export async function removePresenterAction(brandId: number) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, brandId);
  if (!brand?.presenter) return;
  const db = await getDb();
  const [asset] = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.workspaceId, workspace.id), eq(schema.assets.storageKey, brand.presenter.faceKey)));
  if (asset) await deleteAssets(workspace.id, [asset.id]);
  else await db.update(schema.brands).set({ presenter: null }).where(eq(schema.brands.id, brandId));
  revalidatePath(`/brands/${brandId}`);
}

/** A campaign with its posts and media files. */
export async function deleteCampaignAction(campaignId: number, stay = false) {
  const { workspace } = await requireEditor();
  await deleteCampaign(workspace.id, campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  revalidatePath("/review");
  if (!stay) redirect("/campaigns");
}

/** A lead (personal data: name, phone, email). */
export async function deleteLeadAction(leadId: number) {
  const { workspace } = await requireEditor();
  const db = await getDb();
  await db.delete(schema.leads).where(and(eq(schema.leads.workspaceId, workspace.id), eq(schema.leads.id, leadId)));
  revalidatePath("/leads");
}

/** A blog article and its cover image. */
export async function deleteArticleQuickAction(brandId: number, articleId: number) {
  const { workspace } = await requireEditor();
  const db = await getDb();
  const [a] = await db.delete(schema.articles).where(and(eq(schema.articles.workspaceId, workspace.id), eq(schema.articles.id, articleId))).returning({ cover: schema.articles.coverKey });
  if (a?.cover?.startsWith(`ws${workspace.id}/`)) {
    const { deleteFiles } = await import("@/lib/storage");
    await deleteFiles([a.cover]).catch(() => 0);
  }
  revalidatePath(`/brands/${brandId}/articles`);
}
