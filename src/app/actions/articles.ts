"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { startArticle } from "@/agent/articles";
import { deleteFiles } from "@/lib/storage";
import { enqueue, processJobs } from "@/jobs/queue";

/** Start writing an article on a topic (the job writes it in the background). */
export async function writeArticleAction(brandId: number, formData: FormData) {
  const { workspace } = await requireEditor();
  if (!(await getBrand(workspace.id, brandId))) return;
  // A clicked suggestion sends its own "topic" after the (maybe empty) text box: use the last one given.
  const topic = formData.getAll("topic").map((v) => String(v).trim()).filter(Boolean).at(-1) ?? "";
  if (topic.length < 4) return;
  const article = await startArticle(workspace.id, brandId, topic);
  await enqueue("article.write", { workspaceId: workspace.id, articleId: article.id }, workspace.id);
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(5)));
  redirect(`/brands/${brandId}/articles/${article.id}`);
}

export async function deleteArticleAction(brandId: number, articleId: number) {
  const { workspace } = await requireEditor();
  const db = await getDb();
  const [gone] = await db.delete(schema.articles).where(and(eq(schema.articles.workspaceId, workspace.id), eq(schema.articles.id, articleId))).returning({ cover: schema.articles.coverKey });
  if (gone?.cover?.startsWith(`ws${workspace.id}/`)) await deleteFiles([gone.cover]).catch(() => 0);
  revalidatePath(`/brands/${brandId}/articles`);
  redirect(`/brands/${brandId}/articles`);
}
