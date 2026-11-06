/*
 * Agent eval: `npm run eval` (on the Mac, with the real free AI keys from .env.local).
 *
 * Makes one week of posts for a sample brand in a throw-away in-memory database, scores
 * the result (safe, readable, plain, varied, on brand, fits the platform) and saves the
 * scorecard to eval/results/<time>.json. Run it again after a prompt or provider change
 * and compare: `npm run eval -- --compare eval/results/<earlier>.json`.
 *
 * Options:
 *   --brand eval/brands/chakravyuh.json   which brand file (default: chakravyuh)
 *   --posts 6                             how many posts (default 6; keeps free quotas safe)
 *   --posters                             also make the posters (uses the free image AIs)
 *   --compare <file>                      show the change against an earlier scorecard
 *   --learn                               add sample learnings to memory first (tests that prompts use them)
 * Costs: about 2-4 free text calls for 6 posts without posters.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "memory://"; // never touch the real database
process.env.AGENT_INLINE_JOBS = "false";
process.env.STORAGE_DRIVER = process.env.EVAL_STORAGE_DRIVER ?? "local";
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), ".data", "eval-uploads");
if (!process.env.AGENT_PIPELINE) process.env.AGENT_PIPELINE = "false"; // design only when asked

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

async function main() {
  const [{ getDb, schema }, { enqueue, processJobs }, { createBrand, createCampaign, getCampaign, listCampaignPosts }, { scorecard, formatScorecard }, { replaceLearnings }] = await Promise.all([
    import("../src/db"),
    import("../src/jobs/queue"),
    import("../src/lib/data"),
    import("../src/agent/eval/scorecard"),
    import("../src/agent/memory"),
  ]);
  const { eq } = await import("drizzle-orm");

  const brandFile = opt("brand", path.join("eval", "brands", "chakravyuh.json"));
  const spec = JSON.parse(fs.readFileSync(brandFile, "utf8")) as { brand: Record<string, unknown>; campaign: Record<string, unknown>; learnings?: { topic: string; text: string; data: Record<string, unknown>; weight: number }[] };
  const postCount = Math.max(1, Number(opt("posts", "6")));

  const db = await getDb();
  const [user] = await db.insert(schema.users).values({ name: "Eval", email: `eval-${Date.now()}@local`, passwordHash: "x" }).returning();
  const [ws] = await db.insert(schema.workspaces).values({ name: "Eval", ownerId: user.id }).returning();
  const brand = await createBrand(ws.id, spec.brand as Parameters<typeof createBrand>[1]);
  if (flag("learn") && spec.learnings?.length) {
    await replaceLearnings(ws.id, brand.id, spec.learnings as Parameters<typeof replaceLearnings>[2]);
    console.log(`Memory: ${spec.learnings.length} sample learning(s) added.`);
  }
  const start = new Date();
  const end = new Date(start.getTime() + 6 * 86400000);
  const platforms = (spec.campaign.platforms as string[]) ?? ["instagram"];
  const campaign = await createCampaign(ws.id, {
    ...(spec.campaign as object),
    brandId: brand.id,
    theme: String(spec.campaign.theme),
    platforms,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    postsPerWeek: Math.ceil(postCount / platforms.length),
  } as Parameters<typeof createCampaign>[1]);

  const t0 = Date.now();
  await enqueue("campaign.plan", { workspaceId: ws.id, campaignId: campaign.id }, ws.id);
  // plan + write; posters only with --posters (the design job is queued by the write job).
  await processJobs(2);
  if (flag("posters")) await processJobs();
  const ms = Date.now() - t0;

  const c = (await getCampaign(ws.id, campaign.id))!;
  const posts = await listCampaignPosts(ws.id, campaign.id);
  const gens = await db.select().from(schema.generations).where(eq(schema.generations.workspaceId, ws.id));
  const card = scorecard(posts, brand, c, { posters: flag("posters") });

  const previous = flag("compare") ? (JSON.parse(fs.readFileSync(opt("compare", ""), "utf8")) as { card: typeof card }).card : null;
  console.log(`\nCampaign "${c.theme}" -> ${c.status}${c.error ? ` (${c.error})` : ""}`);
  console.log(`Time: ${(ms / 1000).toFixed(1)} s for ${posts.length} posts (${(ms / 1000 / Math.max(1, posts.length)).toFixed(1)} s/post)`);
  const byProvider: Record<string, number> = {};
  for (const g of gens) byProvider[`${g.provider} ${g.status}`] = (byProvider[`${g.provider} ${g.status}`] ?? 0) + 1;
  console.log(`AI calls: ${JSON.stringify(byProvider)}\n`);
  console.log(formatScorecard(card, previous));
  console.log("\nSample posts:");
  for (const p of posts.slice(0, 3)) console.log(`- [${p.platform}/${p.format}] ${p.posterHeadline ?? ""} | ${(p.caption ?? "").split("\n")[0]}`);

  const outDir = path.join("eval", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), brand: brandFile, posts: posts.length, ms, providers: byProvider, card, sample: posts.map((p) => ({ platform: p.platform, format: p.format, headline: p.posterHeadline, caption: p.caption, hashtags: p.hashtags, template: p.posterTemplate })) }, null, 2));
  console.log(`\nSaved ${file}`);
  process.exit(card.safe < 100 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
