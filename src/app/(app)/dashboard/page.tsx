import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { freePlan } from "@/lib/config";
import { countBrands, listBrands, listCampaigns, postStatusCounts } from "@/lib/data";
import { formatSlot } from "@/lib/schedule";
import { workspaceTextUsageThisMonth } from "@/agent/router";
import { workspaceImageUsageThisMonth } from "@/agent/images/router";
import { workspaceVideosThisMonth } from "@/agent/video/reel";
import { trialInfo } from "@/lib/plan";
import { connectionRows } from "@/lib/connections";
import { teamStatus } from "@/lib/team-status";
import { AutoRefresh } from "@/components/auto-refresh";
import { AiTeam, ActivityFeed } from "@/components/ui/ai-team";
import { FuelGauge } from "@/components/ui/fuel-gauge";
import { CountUp } from "@/components/ui/count-up";
import { StatusBadge } from "@/components/status-badge";

function Meter({ label, used, max, color }: { label: string; used: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-zinc-600">{label}</span>
        <span className="font-semibold">
          {used} <span className="font-normal text-zinc-400">/ {max}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="bar-fill h-2 rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? "#ef4444" : color }} />
      </div>
    </div>
  );
}

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const { workspace, role, user } = await requireAuth();
  const canEdit = canEditContent(role);
  const plan = freePlan();
  const [brandCount, textUsed, imagesUsed, videosUsed, trial, counts, campaigns, team, rows] = await Promise.all([
    countBrands(workspace.id),
    workspaceTextUsageThisMonth(workspace.id),
    workspaceImageUsageThisMonth(workspace.id),
    workspaceVideosThisMonth(workspace.id),
    trialInfo(workspace.id),
    postStatusCounts(workspace.id),
    listCampaigns(workspace.id),
    teamStatus(workspace.id),
    connectionRows(),
  ]);
  const brands = await listBrands(workspace.id);
  const autopilotOn = brands.filter((b) => b.autopilotEnabled);
  const toReview = counts.drafted ?? 0;
  const workingNow = team.agents.filter((a) => a.working);

  return (
    <div className="space-y-8">
      <AutoRefresh active={team.anyWorking} everyMs={6000} />

      {/* Hero: the team at a glance + live feed */}
      <section className="grid gap-5 lg:grid-cols-5">
        <div className="card-dark relative overflow-hidden lg:col-span-3">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-fuchsia-500/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-10 h-64 w-64 rounded-full bg-indigo-500/30 blur-3xl" />
          <p className="relative text-sm text-white/60">
            {greeting()}, {user.name.split(" ")[0]} 👋
          </p>
          <h1 className="relative mt-2 text-3xl font-bold leading-tight sm:text-4xl">
            Your <span className="text-grad">AI marketing team</span>
            <br />
            {workingNow.length ? `is working — ${workingNow.map((a) => a.name.toLowerCase()).join(", ")}` : "is ready for the next idea"}
          </h1>
          <p className="relative mt-3 max-w-lg text-sm text-white/65">
            Six AI agents plan, write, design, make reels, check quality and publish. You only approve.
          </p>
          <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "To review", value: toReview, tone: "text-amber-300" },
              { label: "Approved", value: counts.approved ?? 0, tone: "text-emerald-300" },
              { label: "Published", value: counts.published ?? 0, tone: "text-sky-300" },
              { label: "Reels made", value: videosUsed, tone: "text-fuchsia-300" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <CountUp value={s.value} className={`text-2xl font-bold ${s.tone}`} />
                <p className="text-[11px] uppercase tracking-wide text-white/50">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="relative mt-6 flex flex-wrap gap-3">
            {canEdit && <Link href="/campaigns/new" className="btn">New campaign</Link>}
            {toReview > 0 && (
              <Link href="/campaigns" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                Review {toReview} posts →
              </Link>
            )}
          </div>
        </div>

        <div className="card-dark relative overflow-hidden lg:col-span-2">
          <div className="scanline" />
          <div className="relative mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Live activity</h2>
            <span className="flex items-center gap-2 text-xs text-white/60">
              <span className={`live-dot ${team.anyWorking ? "" : "idle"}`} /> {team.anyWorking ? "live" : "quiet"}
            </span>
          </div>
          <div className="relative">
            <ActivityFeed items={team.activity.slice(0, 9)} />
          </div>
        </div>
      </section>

      {brandCount === 0 && canEdit && (
        <div className="card border-indigo-200 bg-indigo-50/80">
          <p className="font-medium">Start by adding your first business account.</p>
          <p className="text-sm text-zinc-600">The Brand Kit you fill in is used for every post the agent writes.</p>
          <Link href="/brands/new" className="btn mt-3">Add business account</Link>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold">Meet your AI team</h2>
            <p className="text-sm text-zinc-500">Each agent hands its work to the next. Nothing is posted without your approval.</p>
          </div>
        </div>
        <AiTeam agents={team.agents} />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-bold">Free AI fuel</h2>
          <p className="text-sm text-zinc-500">
            The team uses each free AI until its daily limit, then moves to the next one. Nothing here costs money.
          </p>
        </div>
        <FuelGauge rows={rows} />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card lg:col-span-2" data-testid="autopilot-card">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Weekly autopilot</h2>
            <span className={`live-dot ${autopilotOn.length ? "" : "idle"}`} />
          </div>
          {autopilotOn.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-600">
              Off. Turn it on in a business account (Brands → Edit → Weekly autopilot) and the AI team plans and makes every week for you.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {autopilotOn.map((b) => {
                const latest = campaigns.find(({ campaign }) => campaign.brandId === b.id && campaign.source === "autopilot");
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-zinc-500">next plan {b.autopilotNextRunAt ? formatSlot(b.autopilotNextRunAt, b.timezone) : "—"}</span>
                    {latest && (
                      <Link href={`/campaigns/${latest.campaign.id}`} className="ml-auto text-indigo-600 hover:underline">
                        This week: {latest.campaign.theme} →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <h2 className="mb-2 mt-6 font-semibold">Recent campaigns</h2>
          {campaigns.length === 0 ? (
            <p className="text-sm text-zinc-500">No campaigns yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {campaigns.slice(0, 6).map(({ campaign, brandName }) => (
                <li key={campaign.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/campaigns/${campaign.id}`} className="truncate hover:text-indigo-600">
                    {campaign.theme} <span className="text-zinc-400">· {brandName}</span>
                  </Link>
                  <StatusBadge status={campaign.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold">This month</h2>
          <Meter label="Business accounts" used={brandCount} max={plan.maxBrands} color="#6366f1" />
          <Meter label="AI texts" used={textUsed} max={plan.monthlyTextGenerations} color="#8b5cf6" />
          <Meter label="AI images" used={imagesUsed} max={plan.monthlyImageGenerations} color="#db2777" />
          <Meter label="Reel videos" used={videosUsed} max={plan.monthlyVideos} color="#f59e0b" />
          <p className="text-xs text-zinc-500">
            {trial.enabled ? `Trial · ${trial.daysLeft} days left` : "No expiry"} · open source
          </p>
        </div>
      </section>
    </div>
  );
}
