import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { listBrands } from "@/lib/data";
import { reviewQueue } from "@/lib/review";
import { reviewPostAction } from "@/app/actions/campaigns";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { publicUrl } from "@/lib/storage";
import { formatSlot } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** One place to approve posts: every post that is ready, across all campaigns, soonest first. */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ brandId?: string }> }) {
  const { workspace, role } = await requireAuth();
  const brandId = Number((await searchParams).brandId) || undefined;
  const [brands, items] = await Promise.all([listBrands(workspace.id), reviewQueue(workspace.id, { brandId })]);
  const canEdit = canEditContent(role);

  return (
    <div className="space-y-6" data-testid="review-queue">
      <div>
        <h1 className="text-2xl font-semibold">Waiting for your review</h1>
        <p className="text-sm text-zinc-600">
          Approve a post and it goes out on its date. Ask for changes and the team rewrites it; your note is remembered for future posts.
        </p>
      </div>

      {brands.length > 1 && (
        <nav className="flex flex-wrap gap-1.5" aria-label="Business">
          <Link href="/review" className={`badge border ${!brandId ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}>
            All
          </Link>
          {brands.map((b) => (
            <Link
              key={b.id}
              href={`/review?brandId=${b.id}`}
              className={`badge border ${brandId === b.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}
            >
              {b.name}
            </Link>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        <div className="card text-center text-sm text-zinc-600" data-testid="review-empty">
          <p className="text-lg">All caught up ✅</p>
          <p className="mt-1">Nothing is waiting for a decision. New posts appear here as soon as the team finishes them.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-600">
            <b>{items.length}</b> post{items.length === 1 ? "" : "s"} waiting{items.length >= 50 ? " (showing the first 50)" : ""}.
          </p>
          <div className="space-y-4">
            {items.map(({ post, brandName, campaignId, campaignTheme, poster, video, previouslyApproved }) => (
              <article key={post.id} className="card grid gap-5 md:grid-cols-[260px_1fr]" data-testid="review-item">
                <div className="space-y-2">
                  {poster ? (
                    <a href={publicUrl(poster.storageKey)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={publicUrl(poster.storageKey)} alt={post.posterHeadline ?? "Poster"} className="w-full rounded-lg border border-zinc-200" />
                    </a>
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500">
                      No image
                    </div>
                  )}
                  {video && (
                    <video src={publicUrl(video.storageKey)} controls preload="metadata" playsInline className="w-full rounded-lg border border-zinc-200 bg-black" />
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <header className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="badge bg-indigo-50 text-indigo-700">{PLATFORM_LABELS[post.platform] ?? post.platform}</span>
                    <span className="font-medium">{brandName}</span>
                    <span className="text-zinc-400">·</span>
                    <Link href={`/campaigns/${campaignId}`} className="text-zinc-600 underline-offset-2 hover:underline">
                      {campaignTheme}
                    </Link>
                    <span className="ml-auto text-xs text-zinc-500">
                      {post.scheduledAt ? formatSlot(post.scheduledAt, post.timezone) : post.publishOn ?? "Not scheduled"}
                    </span>
                  </header>

                  {previouslyApproved !== null && (
                    <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                      Changed after you approved v{previouslyApproved}. Please check this new version (v{post.currentVersion}).
                    </p>
                  )}
                  {post.reviewNote && (
                    <p className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-800">Last note: “{post.reviewNote}”</p>
                  )}

                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{post.caption}</p>
                  {post.hashtags.length > 0 && <p className="text-sm text-indigo-700">{post.hashtags.join(" ")}</p>}

                  {post.qcIssues.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-amber-800">
                      {post.qcIssues.map((q, i) => (
                        <li key={i}>⚠ {q.message}</li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                    <form action={reviewPostAction.bind(null, post.id, "approved")}>
                      <input type="hidden" name="version" value={post.currentVersion} />
                      <button className="btn" data-testid="review-approve">Approve</button>
                    </form>
                    <form action={reviewPostAction.bind(null, post.id, "rejected")} className="flex min-w-[260px] flex-1 gap-2">
                      <input type="hidden" name="version" value={post.currentVersion} />
                      <input className="input" name="note" placeholder="What should change?" required />
                      <button className="btn-danger shrink-0">Ask for changes</button>
                    </form>
                    {canEdit && (
                      <Link href={`/campaigns/${campaignId}`} className="btn-secondary">
                        Edit
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
