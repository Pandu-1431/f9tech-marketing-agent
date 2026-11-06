import { notFound } from "next/navigation";
import {
  chooseVideoAction,
  editPostAction,
  editPosterTextAction,
  makeReelAction,
  redesignPostAction,
  replaceDemoMediaAction,
  rescheduleFormAction,
  retryCampaignAction,
  reviewPostAction,
  rewritePostAction,
  approveAllPassedAction,
  finishMissingMediaAction,
} from "@/app/actions/campaigns";
import { AutoRefresh } from "@/components/auto-refresh";
import { campaignPublications, listChannels } from "@/agent/publish";
import { publishNowAction } from "@/app/actions/publishing";
import type { Publication } from "@/db/schema";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { StatusBadge } from "@/components/status-badge";
import { requireAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { lastProviderFailure, campaignHistory, getBrand, getCampaign, isApprovedForPublish, latestPosters, campaignVideos, listCampaignPosts } from "@/lib/data";
import { REEL_STYLES, styleLabel } from "@/agent/video/styles";
import { publicUrl } from "@/lib/storage";
import { formatSlot, utcToZoned } from "@/lib/schedule";
import { campaignJobProblem } from "@/jobs/queue";
import { openJobCount } from "@/jobs/heal";
import type { Campaign, Post } from "@/db/schema";
import { allowedFormats } from "@/agent/planner";
import { campaignTypeLabel, FORMAT_LABELS } from "@/lib/campaign-types";

import { TEMPLATE_INFO } from "@/agent/images/poster-info";
import { Pipeline, type StepState } from "@/components/ui/pipeline";

/** Where this campaign is in the AI team's line: plan → write → design → (reels) → check → approve → publish. */
function CampaignPipeline({ campaign, posts }: { campaign: Campaign; posts: Post[] }) {
  const real = posts.filter((p) => p.status !== "idea" && p.status !== "rejected");
  const all = (f: (p: Post) => boolean) => real.length > 0 && real.every(f);
  const some = (f: (p: Post) => boolean) => real.some(f);
  const planned = posts.length > 0;
  const written = planned && posts.every((p) => p.status !== "idea");
  const designed = all((p) => p.designStatus === "done");
  const reels = real.filter((p) => p.format === "reel");
  const reelsDone = reels.every((p) => p.reelStatus === "done");
  const checked = all((p) => p.qcStatus !== "none");
  const approved = all((p) => p.status === "approved" || p.status === "published");
  const published = all((p) => p.status === "published");
  const state = (done: boolean, started: boolean): StepState => (done ? "done" : started ? "active" : "todo");
  const steps: { label: string; icon: string; state: StepState; note?: string }[] = [
    { label: "Plan", icon: "🧭", state: state(planned, campaign.status === "planning" || campaign.status === "draft") },
    { label: "Write", icon: "✍️", state: state(written, planned), note: planned ? `${posts.filter((p) => p.status !== "idea").length}/${posts.length}` : undefined },
    { label: "Design", icon: "🎨", state: state(designed, written), note: real.length ? `${real.filter((p) => p.designStatus === "done").length}/${real.length}` : undefined },
    ...(reels.length
      ? [{ label: "Reels", icon: "🎬", state: state(reelsDone, designed || some((p) => p.reelStatus === "making")), note: `${reels.filter((p) => p.reelStatus === "done").length}/${reels.length}` }]
      : []),
    { label: "Check", icon: "🛡️", state: state(checked, some((p) => p.qcStatus !== "none")) },
    { label: "Approve", icon: "👍", state: state(approved, checked), note: real.length ? `${real.filter((p) => p.status === "approved" || p.status === "published").length}/${real.length}` : undefined },
    { label: "Publish", icon: "🚀", state: state(published, approved || some((p) => p.status === "published")) },
  ];
  return (
    <div className="card overflow-x-auto">
      <Pipeline steps={steps} />
    </div>
  );
}
const TEMPLATE_LABELS: Record<string, string> = Object.fromEntries(Object.entries(TEMPLATE_INFO).map(([id, t]) => [id, t.label]));

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace, role } = await requireAuth();
  const { id } = await params;
  const campaign = await getCampaign(workspace.id, Number(id));
  if (!campaign) notFound();
  const [brand, posts, posters, allVideos, history] = await Promise.all([
    getBrand(workspace.id, campaign.brandId),
    listCampaignPosts(workspace.id, campaign.id),
    latestPosters(workspace.id, campaign.id),
    campaignVideos(workspace.id, campaign.id),
    campaignHistory(workspace.id, campaign.id),
  ]);
  // The video each post uses: the one a person picked ("Use this"), else the newest.
  const videos = new Map(
    posts.flatMap((p) => {
      const list = allVideos.get(p.id) ?? [];
      const pick = list.find((v) => v.id === p.videoChoice) ?? list[0];
      return pick ? [[p.id, pick] as const] : [];
    }),
  );
  const [channels, publications] = await Promise.all([listChannels(workspace.id, campaign.brandId), campaignPublications(workspace.id, campaign.id)]);
  const channelPlatforms = new Set(channels.map((c) => c.platform));
  const makingVideos = posts.filter((p) => p.reelStatus === "making").length;
  const [problem, openJobs] = await Promise.all([campaignJobProblem(workspace.id, campaign.id), openJobCount(workspace.id, campaign.id)]);
  const designing = posts.filter((p) => p.status !== "idea" && (p.designStatus === "designing" || (campaign.status === "ready" && p.designStatus === "none")));
  const working =
    campaign.status === "planning" || campaign.status === "writing" || campaign.status === "draft" || posts.some((p) => p.status === "idea") || designing.length > 0 || makingVideos > 0;
  const canEdit = canEditContent(role);
  const drafted = posts.filter((p) => p.status !== "idea").length;
  const demoMedia = posts.filter((p) => p.status !== "idea" && (p.demoParts.includes("image") || p.demoParts.includes("video"))).length;
  const imageFailure = demoMedia > 0 ? await lastProviderFailure(workspace.id, "image") : null;

  return (
    <div className="space-y-6">
      <AutoRefresh active={working} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{brand?.name}</p>
          <h1 className="text-2xl font-semibold">
            {campaign.theme}
            {campaign.source === "autopilot" && <span className="badge ml-2 align-middle bg-indigo-50 text-indigo-700">Autopilot</span>}
          </h1>
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
      <QualitySummary posts={posts} />
      {(() => {
        const ready = posts.filter((p) => p.qcStatus === "pass" && p.status === "drafted" && p.demoParts.length === 0 && p.currentVersion > 0).length;
        return ready > 0 ? (
          <form action={approveAllPassedAction.bind(null, campaign.id)} className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="flex-1 text-emerald-900">{ready} post{ready === 1 ? "" : "s"} passed every check and wait for you.</span>
            <button className="btn">Approve all {ready}</button>
          </form>
        ) : null;
      })()}
      {demoMedia > 0 && (
        <div data-testid="demo-media-banner" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="min-w-60 flex-1">
            <b>{demoMedia} post{demoMedia === 1 ? " has" : "s have"} demo images or video</b>, because the real image AI did not answer.
            {imageFailure && (
              <span className="mt-1 block text-xs text-amber-800">
                Last error from {imageFailure.provider}: {(imageFailure.error ?? "").slice(0, 220)}
              </span>
            )}
          </p>
          {canEdit && (
            <form action={replaceDemoMediaAction.bind(null, campaign.id)}>
              <button className="btn">Make real images now</button>
            </form>
          )}
        </div>
      )}
      {problem && !campaign.error && (
        <p className={`rounded-lg px-3 py-2 text-sm ${problem.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          {problem.status === "failed" ? "Stopped after 3 tries: " : `Hit a problem, retrying automatically (try ${problem.attempts} of 3): `}
          {problem.error.slice(0, 300)}
        </p>
      )}
      <CampaignPipeline campaign={campaign} posts={posts} />
      {(() => {
        const live = posts.filter((p) => p.status !== "idea" && p.status !== "published" && p.status !== "rejected");
        // "In progress" with no job behind it = stuck (a job gave up or the app restarted).
        const stuck = working && openJobs === 0;
        const missing = stuck
          ? posts.filter((p) => p.status === "idea" || p.designStatus === "designing" || p.reelStatus === "making").length +
            live.filter((p) => p.designStatus === "failed").length
          : live.filter((p) => p.designStatus === "failed" || (p.format === "reel" && (p.reelStatus === "failed" || (p.reelStatus === "none" && p.designStatus === "done")))).length;
        return canEdit && missing > 0 && (!working || stuck) ? (
          <form action={finishMissingMediaAction.bind(null, campaign.id)} className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-sm" data-testid="finish-missing">
            <span className="flex-1 text-indigo-900">
              {stuck
                ? `${missing} post${missing === 1 ? "" : "s"} paused (a free AI was busy). The team restarts them by itself within a few minutes, or click now.`
                : `${missing} poster${missing === 1 ? "" : "s"} or video${missing === 1 ? "" : "s"} still missing. The team waits for free AI limits and falls back to brand art, so this will work.`}
            </span>
            <button className="btn">{stuck ? "Restart now" : "Make the missing ones"}</button>
          </form>
        ) : null;
      })()}
      {working && (
        <p className="relative overflow-hidden rounded-xl border border-fuchsia-200 bg-gradient-to-r from-indigo-50 via-fuchsia-50 to-amber-50 px-3 py-2 text-sm text-indigo-900">
          <span className="shimmer pointer-events-none absolute inset-0" />
          <span className="live-dot mr-2 align-middle" />
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
              <span className="font-medium" data-testid="post-slot">
                {post.scheduledAt ? formatSlot(post.scheduledAt, post.timezone) : post.publishOn}
              </span>
              {canEdit && post.status !== "published" && (
                <details className="relative">
                  <summary className="cursor-pointer text-xs text-indigo-600">Change</summary>
                  <form action={rescheduleFormAction.bind(null, post.id)} className="absolute z-20 mt-1 flex items-end gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow">
                    <input className="input py-1" type="date" name="date" defaultValue={post.publishOn} required aria-label="Date" />
                    <input
                      className="input py-1"
                      type="time"
                      name="time"
                      defaultValue={post.scheduledAt ? utcToZoned(post.scheduledAt, post.timezone).time : ""}
                      aria-label="Time"
                    />
                    <button className="btn py-1">Save</button>
                  </form>
                </details>
              )}
              {isApprovedForPublish(post) && <span className="badge bg-emerald-600 text-white">Ready to publish</span>}
              <PublishLine pub={publications.get(post.id)} post={post} hasChannel={channelPlatforms.has(post.platform)} canEdit={canEdit} />
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
              post.lastError || campaign.status === "failed" ? (
                <div data-testid="write-failed" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <span className="flex-1">Not written yet: {post.lastError ?? "the AI could not write this post."}</span>
                  {canEdit && (
                    <form action={rewritePostAction.bind(null, post.id)}>
                      <button className="btn-secondary py-1">Try again</button>
                    </form>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Writing…</p>
              )
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
                      {post.designStatus === "failed" ? (
                        <span className="px-4 text-center">
                          Design failed. Click &quot;New image&quot; below to try again.
                          {post.lastError && <span className="mt-1 block text-xs text-red-700">{post.lastError}</span>}
                        </span>
                      ) : (
                        "Designing poster…"
                      )}
                    </div>
                  )}
                  {canEdit && (
                    <>
                      <form action={editPosterTextAction.bind(null, post.id)} className="space-y-1.5">
                        <input className="input" name="posterKicker" defaultValue={post.posterKicker ?? ""} placeholder="Small label (e.g. TIP)" />
                        <input className="input" name="posterHeadline" defaultValue={post.posterHeadline ?? ""} placeholder="Poster headline" />
                        <input className="input" name="posterSubline" defaultValue={post.posterSubline ?? ""} placeholder="Sub-line (one short sentence)" />
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
                          poster={post.reelScript?.coverKey ? publicUrl(post.reelScript.coverKey) : posters.get(post.id) ? publicUrl(posters.get(post.id)!.storageKey) : undefined}
                          controls
                          preload="metadata"
                          playsInline
                          className="w-full rounded-lg border border-zinc-200 bg-black"
                        />
                        <p className="mt-1 text-xs text-zinc-500">
                          {post.reelScript?.durationSec ? `${post.reelScript.durationSec}s · ` : ""}
                          {post.reelScript?.scenes.length ?? 0} scenes · voice: {post.reelScript?.voice ?? "—"}
                          {post.reelScript?.coverKey && (
                            <>
                              {" · "}
                              <a href={publicUrl(post.reelScript.coverKey)} download={`reel-${post.id}-cover.png`} className="underline">
                                Cover image
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    ) : (
                      post.reelStatus === "failed" && <p className="text-xs text-red-600">{post.reelError ?? "Video failed"}</p>
                    )}
                    {(allVideos.get(post.id)?.length ?? 0) > 1 && (
                      <div className="mt-2" data-testid="video-versions">
                        <p className="mb-1 text-xs text-zinc-500">Versions ({allVideos.get(post.id)!.length}): pick the one to publish</p>
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                          {allVideos.get(post.id)!.map((v) => {
                            const inUse = videos.get(post.id)?.id === v.id;
                            return (
                              <div key={v.id} className={`w-20 shrink-0 rounded-lg border p-1 text-center ${inUse ? "border-indigo-500 bg-indigo-50" : "border-zinc-200"}`}>
                                <a href={publicUrl(v.storageKey)} target="_blank" rel="noreferrer">
                                  <video src={publicUrl(v.storageKey)} preload="metadata" muted playsInline className="aspect-[9/16] w-full rounded bg-black object-cover" />
                                </a>
                                <p className="mt-0.5 truncate text-[10px] text-zinc-600">{styleLabel(v.style)}</p>
                                {inUse ? (
                                  <p className="text-[10px] font-semibold text-indigo-700">In use</p>
                                ) : (
                                  canEdit && post.status !== "published" && (
                                    <form action={chooseVideoAction.bind(null, post.id, v.id)}>
                                      <button className="text-[10px] font-semibold text-indigo-700 underline">Use this</button>
                                    </form>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {canEdit && post.reelStatus !== "making" && (
                      <div className="mt-2 space-y-1.5" data-testid="video-styles">
                        <div className="flex flex-wrap gap-1.5">
                          {REEL_STYLES.map((st) => (
                            <form key={st.key} action={makeReelAction.bind(null, post.id, st.key)}>
                              <button className="badge border border-zinc-200 bg-white text-zinc-600" title={st.hint}>
                                {st.emoji} {st.label}
                              </button>
                            </form>
                          ))}
                          <form action={makeReelAction.bind(null, post.id, "all")}>
                            <button className="badge border border-indigo-500 bg-indigo-50 text-indigo-700" title="One video in each style: presenter, theme, concept and text (uses 4 of your monthly videos)">
                              ✨ Make all 4 styles
                            </button>
                          </form>
                        </div>
                        {videos.get(post.id) && (
                          <a href={publicUrl(videos.get(post.id)!.storageKey)} download={`reel-${post.id}.mp4`} className="badge inline-block border border-zinc-200 bg-white text-zinc-600">
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
                <QualityPanel post={post} canEdit={canEdit} />
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
  if (post.status === "published") return "Already published";
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

/** One line for the whole campaign: how many posts passed the quality check. */
function QualitySummary({ posts }: { posts: Post[] }) {
  const checked = posts.filter((p) => p.qcStatus !== "none");
  if (!checked.length) return null;
  const count = (s: string) => checked.filter((p) => p.qcStatus === s).length;
  const fail = count("fail");
  const warn = count("warn");
  return (
    <p data-testid="qc-summary" className={`rounded-lg px-3 py-2 text-sm ${fail ? "bg-red-50 text-red-800" : warn ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
      <b>Quality check:</b> {count("pass")} of {checked.length} posts passed
      {warn > 0 && <>, {warn} with tips</>}
      {fail > 0 && <>, {fail} need fixing</>}.
    </p>
  );
}

/** What the quality checker found on one post, with a one-click fix. */
function QualityPanel({ post, canEdit }: { post: Post; canEdit: boolean }) {
  if (post.status === "idea" || post.qcStatus === "none") return null;
  if (post.qcStatus === "pass") {
    return (
      <p data-testid="qc-pass" className="text-sm text-emerald-700">
        ✓ Quality check passed: facts, wording, hashtags and poster look right.
      </p>
    );
  }
  const fail = post.qcStatus === "fail";
  const canFix = canEdit && post.qcIssues.some((i) => i.fix === "rewrite") && post.demoParts.length === 0;
  return (
    <div data-testid={`qc-${post.qcStatus}`} className={`rounded-lg border px-3 py-2 text-sm ${fail ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      <p className="font-medium">{fail ? "Quality check: needs fixing before it goes out" : "Quality check: tips"}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {post.qcIssues.map((i) => (
          <li key={i.code}>
            {i.level === "fail" ? <b>Fix: </b> : null}
            {i.message}
          </li>
        ))}
      </ul>
      {post.qcFixes > 0 && fail && <p className="mt-1 text-xs">The agent already tried to fix this by itself. Edit it, add the fact to Key facts, or fix with AI again.</p>}
      {canFix && (
        <form action={rewritePostAction.bind(null, post.id)} className="mt-2">
          <button className="btn-secondary py-1">Fix with AI</button>
        </form>
      )}
    </div>
  );
}

/** Publishing status of a post, and "Publish now" when it is approved and a channel is connected. */
function PublishLine({ pub, post, hasChannel, canEdit }: { pub?: Publication; post: Post; hasChannel: boolean; canEdit: boolean }) {
  const current = pub && pub.version === post.approvedVersion ? pub : undefined;
  if (current?.status === "sent") {
    return (
      <span data-testid="published" className="badge bg-emerald-100 text-emerald-800">
        Published v{current.version}
        {current.url && (
          <a href={current.url} target="_blank" rel="noreferrer" className="ml-1 underline">
            view
          </a>
        )}
      </span>
    );
  }
  if (current && (current.status === "queued" || current.status === "sending")) return <span className="badge bg-sky-100 text-sky-800">Publishing…</span>;
  if (!isApprovedForPublish(post)) return null;
  if (!hasChannel) return <span className="text-xs text-zinc-500">Connect a {PLATFORM_LABELS[post.platform] ?? post.platform} channel in the Brand Kit to publish</span>;
  return (
    <>
      {current?.status === "failed" && <span className="text-xs text-red-700" title={current.error ?? ""}>Publish failed: {(current.error ?? "").slice(0, 90)}</span>}
      {canEdit && (
        <form action={publishNowAction.bind(null, post.id)}>
          <button className="badge border border-emerald-600 bg-white text-emerald-700">{current?.status === "failed" ? "Try again" : "Publish now"}</button>
        </form>
      )}
    </>
  );
}
