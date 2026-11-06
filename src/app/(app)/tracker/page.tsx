import { requireAuth } from "@/lib/auth";
import { listBrands } from "@/lib/data";
import { trackerRows } from "@/lib/tracker";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { StatusBadge } from "@/components/status-badge";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["drafted", "approved", "rejected", "published", "failed"];

/** Every post in one table: when, where, status, link and results. Filter, then download as CSV. */
export default async function TrackerPage({ searchParams }: { searchParams: Promise<{ brandId?: string; from?: string; to?: string; status?: string }> }) {
  const { workspace } = await requireAuth();
  const sp = await searchParams;
  const brandId = Number(sp.brandId) || undefined;
  const from = sp.from && isoDate.test(sp.from) ? sp.from : undefined;
  const to = sp.to && isoDate.test(sp.to) ? sp.to : undefined;
  const status = sp.status && STATUSES.includes(sp.status) ? sp.status : undefined;
  const [brands, rows] = await Promise.all([listBrands(workspace.id), trackerRows(workspace.id, { brandId, from, to, status })]);
  const query = new URLSearchParams(Object.entries({ brandId: brandId ? String(brandId) : "", from: from ?? "", to: to ?? "", status: status ?? "" }).filter(([, v]) => v));
  const totals = rows.reduce((t, r) => ({ published: t.published + (r.status === "published" ? 1 : 0), reach: t.reach + r.reach, likes: t.likes + r.likes, comments: t.comments + r.comments }), { published: 0, reach: 0, likes: 0, comments: 0 });
  const n = (v: number) => (v ? v.toLocaleString("en-IN") : "—");

  return (
    <div className="space-y-6" data-testid="tracker">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Post tracker</h1>
          <p className="text-sm text-zinc-600">Every post across campaigns: when, where, status, link and results. Connect a Google Sheet on a business account to keep a live copy.</p>
        </div>
        <a className="btn-secondary" href={`/api/tracker?${query.toString()}`} download>Download CSV</a>
      </div>

      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="label" htmlFor="brandId">Business</label>
          <select className="input" id="brandId" name="brandId" defaultValue={brandId ?? ""}>
            <option value="">All</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="from">From</label>
          <input className="input" type="date" id="from" name="from" defaultValue={from} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input className="input" type="date" id="to" name="to" defaultValue={to} />
        </div>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Posts", rows.length], ["Published", totals.published], ["Reach", totals.reach], ["Likes + comments", totals.likes + totals.comments]].map(([label, v]) => (
          <div key={label} className="card">
            <p className="text-2xl font-semibold">{Number(v).toLocaleString("en-IN")}</p>
            <p className="text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </section>

      {rows.length === 0 ? (
        <p className="card text-sm text-zinc-500">No posts match. Create a campaign to fill the tracker.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-100 text-xs uppercase text-zinc-500">
              <tr>
                {["Date", "Business", "Platform", "Post", "Status", "Reach", "Likes", "Comments", "Shares", "Views", "Link"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.postId}>
                  <td className="whitespace-nowrap px-3 py-2">{r.date}{r.time && <span className="text-zinc-400"> {r.time}</span>}</td>
                  <td className="px-3 py-2">{r.brand}</td>
                  <td className="whitespace-nowrap px-3 py-2">{PLATFORM_LABELS[r.platform] ?? r.platform} <span className="text-zinc-400">· {r.format}</span></td>
                  <td className="max-w-xs px-3 py-2"><p className="truncate font-medium">{r.headline || r.campaign}</p><p className="truncate text-xs text-zinc-500">{r.caption}</p></td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 tabular-nums">{n(r.reach)}</td>
                  <td className="px-3 py-2 tabular-nums">{n(r.likes)}</td>
                  <td className="px-3 py-2 tabular-nums">{n(r.comments)}</td>
                  <td className="px-3 py-2 tabular-nums">{n(r.shares)}</td>
                  <td className="px-3 py-2 tabular-nums">{n(r.views)}</td>
                  <td className="px-3 py-2">{r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="underline">Open</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
