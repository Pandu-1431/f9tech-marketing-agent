import { notFound } from "next/navigation";
import { editPostAction, retryCampaignAction, reviewPostAction, rewritePostAction } from "@/app/actions/campaigns";
import { AutoRefresh } from "@/components/auto-refresh";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { StatusBadge } from "@/components/status-badge";
import { requireAuth } from "@/lib/auth";
import { getBrand, getCampaign, listCampaignPosts } from "@/lib/data";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace, role } = await requireAuth();
  const { id } = await params;
  const campaign = await getCampaign(workspace.id, Number(id));
  if (!campaign) notFound();
  const [brand, posts] = await Promise.all([getBrand(workspace.id, campaign.brandId), listCampaignPosts(workspace.id, campaign.id)]);
  const working = campaign.status === "planning" || campaign.status === "writing" || campaign.status === "draft" || posts.some((p) => p.status === "idea");
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
      {working && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The agent is working{posts.length ? `: ${drafted} of ${posts.length} posts written` : ": planning the calendar"}. This page updates by itself.
        </p>
      )}
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
              <span className="ml-auto text-xs text-zinc-500">{post.angle}</span>
            </header>

            {post.status === "idea" ? (
              <p className="text-sm text-zinc-500">Writing…</p>
            ) : (
              <>
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

                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                  <form action={reviewPostAction.bind(null, post.id, "approved")} className="flex gap-2">
                    <button className="btn">Approve</button>
                  </form>
                  <form action={reviewPostAction.bind(null, post.id, "rejected")} className="flex flex-1 gap-2">
                    <input className="input" name="note" placeholder="What should change? (optional)" defaultValue={post.reviewNote ?? ""} />
                    <button className="btn-danger">Reject</button>
                  </form>
                  {canEdit && (
                    <form action={rewritePostAction.bind(null, post.id)}>
                      <button className="btn-secondary">Rewrite with AI</button>
                    </form>
                  )}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
