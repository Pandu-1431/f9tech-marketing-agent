import Link from "next/link";
import { MonthCalendar, type CalendarPost } from "@/components/month-calendar";
import { requireAuth } from "@/lib/auth";
import { calendarPosts, isApprovedForPublish, listBrands } from "@/lib/data";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { DEFAULT_TIMEZONE, isMonth, monthGrid, shiftMonth, utcToZoned } from "@/lib/schedule";
import { publicUrl } from "@/lib/storage";
import { canEditContent } from "@/lib/team";

export const metadata = { title: "Calendar · MarketingAgent" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; brand?: string }> }) {
  const { workspace, role } = await requireAuth();
  const sp = await searchParams;
  const today = utcToZoned(new Date(), DEFAULT_TIMEZONE).date;
  const month = isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const brandId = Number(sp.brand) > 0 ? Number(sp.brand) : undefined;
  const { weeks, first, last } = monthGrid(month);
  const [brands, rows] = await Promise.all([listBrands(workspace.id), calendarPosts(workspace.id, { from: first, to: last, brandId })]);

  const timeLabel = (d: Date, tz: string) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  const posts: CalendarPost[] = rows.map((p) => {
    const local = p.scheduledAt ? utcToZoned(p.scheduledAt, p.timezone) : { date: p.publishOn, time: "10:00" };
    return {
      id: p.id,
      campaignId: p.campaignId,
      date: p.publishOn,
      time: local.time,
      timeLabel: p.scheduledAt ? timeLabel(p.scheduledAt, p.timezone) : local.time,
      platform: p.platform,
      platformLabel: PLATFORM_LABELS[p.platform] ?? p.platform,
      format: p.format,
      status: p.status,
      ready: isApprovedForPublish(p),
      brandName: p.brandName,
      campaignTheme: p.campaignTheme,
      snippet: (p.caption ?? p.angle ?? "").slice(0, 240),
      posterUrl: p.posterKey ? publicUrl(p.posterKey) : null,
    };
  });
  const inMonth = posts.filter((p) => p.date.startsWith(month));
  const ready = inMonth.filter((p) => p.ready).length;
  const toReview = inMonth.filter((p) => p.status === "drafted").length;
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const q = (m: string) => `/calendar?month=${m}${brandId ? `&brand=${brandId}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-zinc-500">
            {inMonth.length} posts in {monthName} · {ready} ready to publish · {toReview} need review
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/calendar" className="flex items-center gap-2">
            <input type="hidden" name="month" value={month} />
            <select name="brand" defaultValue={brandId ?? ""} className="input py-1.5" aria-label="Business account">
              <option value="">All business accounts</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button className="btn-secondary">Filter</button>
          </form>
          <Link href={q(shiftMonth(month, -1))} className="btn-secondary" aria-label="Previous month">←</Link>
          <span className="min-w-32 text-center font-medium" data-testid="cal-month">{monthName}</span>
          <Link href={q(shiftMonth(month, 1))} className="btn-secondary" aria-label="Next month">→</Link>
          {month !== today.slice(0, 7) && <Link href={q(today.slice(0, 7))} className="btn-secondary">Today</Link>}
        </div>
      </div>
      <MonthCalendar month={month} weeks={weeks} today={today} posts={posts} canEdit={canEditContent(role)} />
    </div>
  );
}
