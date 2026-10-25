import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { freePlan, textChain } from "@/lib/config";
import { countBrands, listCampaigns, postStatusCounts, recentGenerations } from "@/lib/data";
import { workspaceTextUsageThisMonth } from "@/agent/router";
import { workspaceImageUsageThisMonth } from "@/agent/images/router";
import { workspaceVideosThisMonth } from "@/agent/video/reel";
import { trialInfo } from "@/lib/plan";

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div className="card">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {used} <span className="text-base font-normal text-zinc-400">/ {max}</span>
      </p>
      <div className="mt-3 h-2 rounded-full bg-zinc-100">
        <div className={`h-2 rounded-full ${pct >= 90 ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const { workspace } = await requireAuth();
  const plan = freePlan();
  const [brandCount, textUsed, imagesUsed, videosUsed, trial, counts, campaigns, gens] = await Promise.all([
    countBrands(workspace.id),
    workspaceTextUsageThisMonth(workspace.id),
    workspaceImageUsageThisMonth(workspace.id),
    workspaceVideosThisMonth(workspace.id),
    trialInfo(workspace.id),
    postStatusCounts(workspace.id),
    listCampaigns(workspace.id),
    recentGenerations(workspace.id, 10),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link href="/campaigns/new" className="btn">New campaign</Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Meter label="Business accounts" used={brandCount} max={plan.maxBrands} />
        <Meter label="AI texts this month" used={textUsed} max={plan.monthlyTextGenerations} />
        <Meter label="AI images this month" used={imagesUsed} max={plan.monthlyImageGenerations} />
        <Meter label="Reel videos this month" used={videosUsed} max={plan.monthlyVideos} />
        <div className="card">
          <p className="text-sm text-zinc-500">{trial.enabled ? "Free trial" : "Plan"}</p>
          <p className="mt-1 text-2xl font-semibold">
            {trial.enabled ? (
              <>
                {trial.daysLeft} <span className="text-base font-normal text-zinc-400">days left</span>
              </>
            ) : (
              <>
                Free <span className="text-base font-normal text-zinc-400">no expiry</span>
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {counts.drafted ?? 0} posts to review · {counts.approved ?? 0} approved
          </p>
        </div>
      </section>

      {(brandCount === 0 || campaigns.length === 0) && (
        <div className="card border-indigo-200 bg-indigo-50">
          <p className="font-medium">Get started in 3 steps</p>
          <ol className="mt-3 space-y-3 text-sm">
            <li className="flex items-center justify-between gap-4">
              <span className={brandCount > 0 ? "text-zinc-400 line-through" : ""}>
                <b>1. Add your business account.</b> Fill in the Brand Kit once: name, colors, tone, platforms.
              </span>
              {brandCount === 0 && <Link href="/brands/new" className="btn">Add business account</Link>}
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className={campaigns.length > 0 ? "text-zinc-400 line-through" : brandCount === 0 ? "text-zinc-400" : ""}>
                <b>2. Create a campaign.</b> Type a theme; the agent plans the calendar and writes every post.
              </span>
              {brandCount > 0 && campaigns.length === 0 && <Link href="/campaigns/new" className="btn">New campaign</Link>}
            </li>
            <li className={campaigns.length === 0 ? "text-zinc-400" : ""}>
              <b>3. Review and approve.</b> Open the campaign, edit or rewrite posts, then approve them.
            </li>
          </ol>
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Recent campaigns</h2>
          {campaigns.length === 0 ? (
            <p className="text-sm text-zinc-500">No campaigns yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {campaigns.slice(0, 6).map(({ campaign, brandName }) => (
                <li key={campaign.id} className="flex items-center justify-between py-2">
                  <Link href={`/campaigns/${campaign.id}`} className="hover:text-indigo-600">
                    {campaign.theme} <span className="text-zinc-400">· {brandName}</span>
                  </Link>
                  <span className="badge bg-zinc-100 text-zinc-700">{campaign.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="mb-1 font-semibold">AI activity</h2>
          <p className="mb-3 text-xs text-zinc-500">Provider order: {textChain().join(" → ")}</p>
          {gens.length === 0 ? (
            <p className="text-sm text-zinc-500">No AI calls yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1">Task</th>
                  <th>Model</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {gens.map((g) => (
                  <tr key={g.id}>
                    <td className="py-1.5">{g.purpose.replaceAll("_", " ")}</td>
                    <td className="text-zinc-600">{g.provider} · {g.model}</td>
                    <td className="text-zinc-600">{(g.durationMs / 1000).toFixed(1)}s</td>
                    <td>
                      <span className={`badge ${g.status === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {g.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
