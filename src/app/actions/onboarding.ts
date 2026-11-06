"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { LimitError } from "@/lib/data";
import { enqueue, processJobs } from "@/jobs/queue";
import { onboardFromWebsite } from "@/agent/onboarding";
import { UnsafeUrlError } from "@/lib/safe-fetch";
import { QuotaExceededError } from "@/agent/router";
import type { FormState } from "./auth";

/** Paste a website link -> a new business account with its Brand Kit, logo and SEO kit. */
export async function createBrandFromWebsiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspace } = await requireEditor();
  const url = String(formData.get("website") ?? "").trim();
  if (!url) return { error: "Paste the business's website or app link." };
  let brandId: number;
  try {
    const brand = await onboardFromWebsite(workspace.id, url);
    brandId = brand.id;
  } catch (err) {
    if (err instanceof UnsafeUrlError || err instanceof LimitError || err instanceof QuotaExceededError) return { error: err.message };
    const msg = err instanceof Error ? err.message : String(err);
    if (/fetch failed|timeout|aborted|ENOTFOUND|ECONNREFUSED/i.test(msg)) return { error: "Could not open that website. Check the link, or fill the Brand Kit by hand below." };
    return { error: msg.slice(0, 200) };
  }
  // The SEO kit (what customers search) is built right after, in the background.
  await enqueue("brand.seo", { workspaceId: workspace.id, brandId }, workspace.id);
  if (process.env.AGENT_INLINE_JOBS !== "false") after(async () => void (await processJobs(5)));
  revalidatePath("/brands");
  redirect(`/brands/${brandId}?onboarded=1`);
}
