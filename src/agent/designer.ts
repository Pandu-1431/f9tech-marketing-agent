import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Brand, Post } from "@/db/schema";
import { getFile, newKey, putFile } from "@/lib/storage";
import { isDemoProvider, recordPostVersion, setDemoPart } from "@/lib/data";
import { brandFonts } from "@/lib/fonts";
import { creativeSpec } from "@/lib/formats";
import { generateImage } from "./images/router";
import { composePoster, isPosterTemplate, posterSize, type PosterTemplate } from "./images/poster";
import { imagePrompt, siteLabel } from "./style";

function backgroundPrompt(brand: Brand, post: Post, template: PosterTemplate): string {
  return imagePrompt(brand, post.imagePrompt || post.angle || "", template);
}

/**
 * Makes the poster for one post: AI background (or reuse the latest one)
 * + logo, headline and CTA composed on top. Saves both as assets.
 */
export async function designPost(post: Post, brand: Brand, opts: { newBackground?: boolean; template?: PosterTemplate } = {}) {
  const db = await getDb();
  const { width, height } = posterSize(post.platform, post.format);
  const template: PosterTemplate = opts.template ?? (isPosterTemplate(post.posterTemplate) ? post.posterTemplate : "band");

  // Reuse the existing background when only the template or text changes.
  let background: Buffer | null = null;
  let backgroundProvider: string | null = null;
  if (!opts.newBackground) {
    const [bgAsset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, post.workspaceId), eq(schema.assets.postId, post.id), eq(schema.assets.kind, "background")))
      .orderBy(desc(schema.assets.id))
      .limit(1);
    // A demo background is never reused: try the real image AI again (it may work now).
    if (bgAsset && !bgAsset.demo) {
      background = await getFile(bgAsset.storageKey);
      backgroundProvider = bgAsset.provider;
    }
  }

  if (!background) {
    const img = await generateImage(
      { workspaceId: post.workspaceId, brandId: brand.id, purpose: "post_background", subject: { type: "post", id: post.id } },
      { prompt: backgroundPrompt(brand, post, template), width, height, colors: brand.colors, seed: post.id },
    );
    background = img.data;
    backgroundProvider = img.provider;
    const key = newKey(post.workspaceId, "background", img.mime);
    await putFile(key, img.data, img.mime);
    await db.insert(schema.assets).values({
      workspaceId: post.workspaceId,
      brandId: brand.id,
      postId: post.id,
      kind: "background",
      storageKey: key,
      mime: img.mime,
      width,
      height,
      bytes: img.data.length,
      prompt: backgroundPrompt(brand, post, template),
      provider: img.provider,
      demo: isDemoProvider(img.provider),
    });
  }

  const logo = brand.logoKey ? await getFile(brand.logoKey) : null;
  const poster = await composePoster({
    background,
    width,
    height,
    template,
    headline: post.posterHeadline || brand.name,
    subline: post.posterSubline,
    kicker: post.posterKicker,
    cta: post.posterCta,
    brandName: brand.name,
    colors: brand.colors,
    fonts: brandFonts(brand.fonts),
    logo,
    footer: [brand.name, siteLabel(brand.website) ?? brand.city].filter(Boolean).join(" · "),
    safe: creativeSpec(post.platform, post.format).safe,
  });

  const demoImage = isDemoProvider(backgroundProvider);
  const key = newKey(post.workspaceId, "poster", "image/png");
  await putFile(key, poster, "image/png");
  const [asset] = await db
    .insert(schema.assets)
    .values({
      workspaceId: post.workspaceId,
      brandId: brand.id,
      postId: post.id,
      kind: "poster",
      storageKey: key,
      mime: "image/png",
      width,
      height,
      bytes: poster.length,
      provider: "composer",
      demo: demoImage,
    })
    .returning();

  await db
    .update(schema.posts)
    .set({ designStatus: "done", posterTemplate: template, updatedAt: new Date() })
    .where(and(eq(schema.posts.workspaceId, post.workspaceId), eq(schema.posts.id, post.id)));
  await setDemoPart(post.workspaceId, post.id, "image", demoImage);
  // New poster = new version; an approved post goes back to review.
  await recordPostVersion(post.workspaceId, post.id, "poster");
  return asset;
}

