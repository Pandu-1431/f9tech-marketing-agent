import { notFound } from "next/navigation";
import {
  editPostAction,
  editPosterTextAction,
  makeReelAction,
  redesignPostAction,
  retryCampaignAction,
  reviewPostAction,
  rewritePostAction,
} from "@/app/actions/campaigns";
import { AutoRefresh } from "@/components/auto-refresh";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { StatusBadge } from "@/components/status-badge";
import { requireAuth } from "@/lib/auth";
import { campaignHistory, getBrand, getCampaign, isApprovedForPublish, latestPosters, latestVideos, listCampaignPosts } from "@/lib/data";
import { publicUrl } from "@/lib/storage";
import { campaignJobProblem } from "@/jobs/queue";
import type { Campaign, Post } from "@/db/schema";
import { allowedFormats } from "@/agent/planner";
import { campaignTypeLabel, FORMAT_LABELS } from "@/lib/campaign-types";

const TEMPLATE_LABELS: Record<string, string> = { band: "Bottom band", top: "Top headline", center: "Centre card" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace, role } = await requireAuth();
  const { id } = await params;
  const campaign = await getCampaign(workspace.id, Number(id));
  if (!campaign) notFound();
  const [brand, posts, posters, videos, history] = await Promise.all([
    getBrand(workspace.id, campaign.brandId),
    listCampaignPosts(workspace.id, campaign.id),
    latestPosters(workspace.id, campaign.id),
    latestVideos(workspace.id, campaign.id),
    campaignHistory(workspace.id, campaign.id),
  ]);
  const makingVideos = posts.filter((p) => p.reelStatus === "making").length;
  const problem = await campaignJobProblem(workspace.id, campaign.id);
  const designing = posts.filter((p) => p.status !== "idea" && (p.designStatus === "designing" || (campaign.status === "ready" && p.designStatus === "none")));
  const working =
    campaign.status === "planning" || campaign.status === "writing" || campaign.status === "draft" || posts.some((p) => p.status === "idea") || designing.length > 0 || makingVideos > 0;
  const canEdit = role !== "client";
  const drafted = posts.filter((p) => p.status !== "idea").length;

  return (
    <div className="space-y-6">
      <AutoRefresh active={working} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{brand?.name}</p>
          <h1 className="text-2xl font-semibold">{campaign.theme}</h1>
          <p className="text-sm text-zinc-500">
            {campaign.startDate} → {campaign.endDate} · {campaign.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={campaign.status} />
          {campaign.status === "failed" && canEdit && (
            <form action={retryCampaignAction.bind(null, campaign.id)}>
              <button className="btn-secondary">Retry</button>
            </form>
          )}
        </div>
      </div>

      {campaign.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{campaign.error}</p>}
      {problem && !campaign.error && (
        <p className={`rounded-lg px-3 py-2 text-sm ${problem.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          {problem.status === "failed" ? "Stopped after 3 tries: " : `Hit a problem, retrying automatically (try ${problem.attempts} of 3): `}
          {problem.error.slice(0, 300)}
        </p>
      )}
      {working && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The agent is working
          {!posts.length
            ? ": planning the calendar"
            : drafted < posts.length
              ? `: ${drafted} of ${posts.length} posts written`
              : designing.length > 0
                ? `: designing posters (${posts.length - designing.length} of ${posts.length} done)`
                : `: making ${makingVideos} reel video${makingVideos === 1 ? "" : "s"} (script → images → voice → video)`}
          . This page updates by itself.
        </p>
      )}
      <CampaignBrief campaign={campaign} />
      {campaign.strategy && (
        <div className="card">
          <h2 className="mb-1 font-semibold">Strategy</h2>
          <p className="text-sm text-zinc-700">{campaign.strategy}</p>
        </div>
      )}

      <div className="space-y-4">
        {posts.map((post) => (
          <article key={post.id} className="card space-y-3">
            <header className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{post.publishOn}</span>
              <span className="badge bg-zinc-100 text-zinc-700">{PLATFORM_LABELS[post.platform] ?? post.platform}</span>
              <span className="badge bg-zinc-100 text-zinc-700">{post.format}</span>
              <StatusBadge status={post.status} />
              {post.demoParts.length > 0 && (
                <span data-testid="demo-badge" className="badge bg-amber-400 font-bold uppercase tracking-wide text-black">Demo content</span>
              )}
              <span className="ml-auto text-xs text-zinc-500">{post.angle}</span>
            </header>
            {post.demoParts.length > 0 && post.status !== "idea" && (
              <p data-testid="demo-notice" className="rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <b>Demo content — not made by a real AI model.</b> {demoPartsText(post.demoParts)} came from the built-in demo
                generator. It cannot be approved or published. Add a real AI key on the AI connections page and use “Rewrite with AI”
                or “New image”, or edit the caption yourself.
              </p>
            )}

            {post.status === "idea" ? (
              <p className="text-sm text-zinc-500">Writing…</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-[280px_1fr]">
                <div className="space-y-2">
                  {posters.get(post.id) && post.designStatus !== "designing" ? (
                    <a href={publicUrl(posters.get(post.id)!.storageKey)} target="_blank" rel="noreferrer" className="relative block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={publicUrl(posters.get(post.id)!.storageKey)}
                        alt={post.posterHeadline ?? "Poster"}
                        className="w-full rounded-lg border border-zinc-200"
                      />
                      {posters.get(post.id)!.demo && <DemoStamp />}
                    </a>
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500">
                      {post.designStatus === "failed" ? "Design failed — try again" : "Designing poster…"}
                    </div>
                  )}
                  {canEdit && (
                    <>
                      <form action={editPosterTextAction.bind(null, post.id)} className="space-y-1.5">
                        <input className="input" name="posterHeadline" defaultValue={post.posterHeadline ?? ""} placeholder="Poster headline" />
                        <div className="flex gap-1.5">
                          <input className="input" name="posterCta" defaultValue={post.posterCta ?? ""} placeholder="Button text" />
                          <button className="btn-secondary shrink-0">Update</button>
                        </div>
                      </form>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(TEMPLATE_LABELS).map(([value, label]) => (
                          <form key={value} action={redesignPostAction.bind(null, post.id, { template: value })}>
                            <button
                              className={`badge border ${post.posterTemplate === value ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}
                            >
                              {label}
                            </button>
                          </form>
                        ))}
                        <form action={redesignPostAction.bind(null, post.id, { newBackground: true })}>
                          <button className="badge border border-zinc-200 bg-white text-zinc-600">New image</button>
                        </form>
                        {posters.get(post.id) && (
                          <a
                            href={publicUrl(posters.get(post.id)!.storageKey)}
                            download={`post-${post.id}-${post.platform}.png`}
                            className="badge border border-zinc-200 bg-white text-zinc-600"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    </>
                  )}
                  <div className="mt-3 border-t border-zinc-100 pt-3">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Reel video</p>
                    {post.reelStatus === "making" ? (
                      <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
                        Making video… script → images → voice → video
                      </div>
                    ) : videos.get(post.id) ? (
                      <div className="relative">
                        {videos.get(post.id)!.demo && <DemoStamp />}
                        <video
                          src={publicUrl(videos.get(post.id)!.storageKey)}
                          poster={posters.get(post.id) ? publicUrl(posters.get(post.id)!.storageKey) : undefined}
                          controls
                          preload="metadata"
                          playsInline
                          className="w-full rounded-lg border border-zinc-200 bg-black"
                        />
                        <p className="mt-1 text-xs text-zinc-500">
                          {post.reelScript?.durationSec ? `${post.reelScript.durationSec}s · ` : ""}
                          {post.reelScript?.scenes.length ?? 0} scenes · voice: {post.reelScript?.voice ?? "—"}
                        </p>
                      </div>
                    ) : (
                      post.reelStatus === "failed" && <p className="text-xs text-red-600">{post.reelError ?? "Video failed"}</p>
                    )}
                    {canEdit && post.reelStatus !== "making" && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <form action={makeReelAction.bind(null, post.id)}>
                          <button className="badge border border-zinc-200 bg-white text-zinc-600">
                            {videos.get(post.id) ? "Remake video" : "Make reel video"}
                          </button>
                        </form>
                        {videos.get(post.id) && (
                          <a href={publicUrl(videos.get(post.id)!.storageKey)} download={`reel-${post.id}.mp4`} className="badge border border-zinc-200 bg-white text-zinc-600">
                            Download video
                          </a>
                        )}
                      </div>
                    )}
                    {post.reelScript && (
                      <details className="mt-1.5 text-xs text-zinc-600">
                        <summary className="cursor-pointer">Script</summary>
                        <ol className="mt-1 list-decimal space-y-1 pl-4">
                          {post.reelScript.scenes.map((sc, i) => (
                            <li key={i}>
                              <b>{sc.onScreen}</b> — {sc.voiceover}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                <form action={editPostAction.bind(null, post.id)} className="space-y-2">
                  <textarea className="input" name="caption" rows={5} defaultValue={post.caption ?? ""} readOnly={!canEdit} />
                  <input className="input" name="hashtags" defaultValue={post.hashtags.join(" ")} readOnly={!canEdit} />
                  <details className="text-sm">
                    <summary className="cursor-pointer text-zinc-600">Image prompt and SEO keywords</summary>
                    <textarea className="input mt-2" name="imagePrompt" rows={2} defaultValue={post.imagePrompt ?? ""} readOnly={!canEdit} />
                    <p className="mt-1 text-xs text-zinc-500">SEO keywords: {post.seoKeywords.join(", ") || "—"}</p>
                  </details>
                  {canEdit && <button className="btn-secondary">Save edits</button>}
                </form>

                <ApprovalLine post={post} entries={history.get(post.id) ?? []} />
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                  <form action={reviewPostAction.bind(null, post.id, "approved")} className="flex gap-2">
                    {/* The version on screen: approval is refused if the post changed after the page loaded. */}
                    <input type="hidden" name="version" value={post.currentVersion} />
                    <button
                      className="btn"
                      disabled={Boolean(approveBlocker(post)) || isApprovedForPublish(post)}
                      title={approveBlocker(post) ?? (isApprovedForPublish(post) ? "Already approved" : undefined)}
                    >
                      {isApprovedForPublish(post) ? "Approved" : `Approve v${post.currentVersion}`}
                    </button>
                  </form>
                  <form action={reviewPostAction.bind(null, post.id, "rejected")} className="flex flex-1 gap-2">
                    <input type="hidden" name="version" value={post.currentVersion} />
                    <input className="input" name="note" placeholder="What should change? (optional)" defaultValue={post.reviewNote ?? ""} />
                    <button className="btn-danger">Reject</button>
                  </form>
                  {canEdit && (
                    <form action={rewritePostAction.bind(null, post.id)}>
                      <button className="btn-secondary">Rewrite with AI</button>
                    </form>
                  )}
                </div>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/** The brief the campaign was planned from: only the fields that were filled in. */
function CampaignBrief({ campaign }: { campaign: Campaign }) {
  const rows: [string, React.ReactNode][] = [
    ["Type", campaignTypeLabel(campaign.campaignType)],
    ["Goal", campaign.goal],
    ["Audience", campaign.audience],
    ["Event date", campaign.eventDate],
    ["Location", campaign.location],
    ["Call to action", campaign.callToAction],
    [
      "Link",
      campaign.ctaUrl && (
        <a href={campaign.ctaUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{campaign.ctaUrl}</a>
      ),
    ],
    ["Language", campaign.language],
    ["Hashtags", campaign.hashtags.join(" ")],
    ["Formats", allowedFormats(campaign).map((f) => FORMAT_LABELS[f] ?? f).join(", ")],
  ];
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Brief</h2>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[140px_1fr]">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="text-zinc-800">{value}</dd>
            </div>
          ))}
      </dl>
      {campaign.keyFacts && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <p className="mb-1 text-sm text-zinc-500">Key facts</p>
          <p className="whitespace-pre-line text-sm text-zinc-800">{campaign.keyFacts}</p>
        </div>
      )}
    </div>
  );
}

type HistoryEntry = { key: string; at: Date; version: number; kind: "version" | "approved" | "rejected"; label: string; by: string | null; note: string | null };

/** Why the Approve button is off, or null when the post can be approved. */
function approveBlocker(post: Post): string | null {
  if (post.demoParts.length > 0) return "Demo content cannot be approved";
  if (post.designStatus === "designing" || post.reelStatus === "making") return "Wait until the poster and video are ready";
  if (post.currentVersion < 1) return "Nothing to approve yet";
  return null;
}

/** "Approved v3 by Ravi · 2 Nov" or "Changed after approval of v3 — needs review", plus the full history. */
function ApprovalLine({ post, entries }: { post: Post; entries: HistoryEntry[] }) {
  const lastApproval = entries.find((e) => e.kind === "approved");
  const when = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  let summary: React.ReactNode = null;
  if (isApprovedForPublish(post) && lastApproval) {
    summary = (
      <p className="text-sm text-emerald-700" data-testid="approval-line">
        Approved v{post.approvedVersion} by {lastApproval.by ?? "—"} · {when(lastApproval.at)}
      </p>
    );
  } else if (post.approvedVersion !== null && post.status === "drafted") {
    summary = (
      <p className="text-sm text-amber-700" data-testid="approval-line">
        Changed after v{post.approvedVersion} was approved. Now v{post.currentVersion}: needs review again.
      </p>
    );
  }
  if (!summary && entries.length === 0) return null;
  return (
    <div className="space-y-1">
      {summary}
      {entries.length > 0 && (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer">History (v{post.currentVersion})</summary>
          <ul className="mt-1 space-y-0.5">
            {entries.map((e) => (
              <li key={e.key}>
                <span className={e.kind === "approved" ? "text-emerald-700" : e.kind === "rejected" ? "text-red-600" : undefined}>
                  v{e.version} · {e.label}
                </span>
                {e.by ? ` by ${e.by}` : e.kind === "version" ? " by the agent" : ""} · {when(e.at)}
                {e.note ? ` — “${e.note}”` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function demoPartsText(parts: string[]): string {
  const names: Record<string, string> = { text: "The caption", image: "The poster image", video: "The reel video" };
  const list = parts.map((p) => names[p] ?? p);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)!.toLowerCase()}`;
}

/** Diagonal stamp over a demo poster or video so it can't be mistaken for real output. */
function DemoStamp() {
  return (
    <span
      data-testid="demo-stamp"
      className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border-2 border-black bg-amber-400 px-2 py-0.5 text-xs font-black uppercase tracking-widest text-black shadow"
    >
      Demo · not real AI
    </span>
  );
}
