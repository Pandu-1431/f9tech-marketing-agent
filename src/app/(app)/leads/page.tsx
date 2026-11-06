import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { listBrands } from "@/lib/data";
import { followUpText, LEAD_STATUS_LABELS, LEAD_STATUSES, listLeads, whatsappLink } from "@/lib/leads";
import { updateLeadAction } from "@/app/actions/leads";
import { AddLeadForm } from "@/components/add-lead-form";
import { formatSlot } from "@/lib/schedule";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { new: "bg-fuchsia-100 text-fuchsia-800", contacted: "bg-sky-100 text-sky-800", won: "bg-emerald-100 text-emerald-800", lost: "bg-zinc-100 text-zinc-600" };

/** Leads: every enquiry in one list. Follow up on WhatsApp, move it along, keep notes. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ brandId?: string; status?: string }> }) {
  const { workspace, role } = await requireAuth();
  const sp = await searchParams;
  const brandId = Number(sp.brandId) || undefined;
  const status = sp.status && (LEAD_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;
  const [brands, rows, all] = await Promise.all([listBrands(workspace.id), listLeads(workspace.id, { brandId, status }), listLeads(workspace.id, { brandId })]);
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, all.filter((r) => r.lead.status === s).length]));
  const canEdit = canEditContent(role);
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ brandId: brandId ? String(brandId) : undefined, status, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/leads${p.size ? `?${p}` : ""}`;
  };
  const brandById = new Map(brands.map((b) => [b.id, b]));

  return (
    <div className="space-y-6" data-testid="leads">
      <div>
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-zinc-600">
          Enquiries from each business&apos;s enquiry page (link it in posts and bios) and the ones you add by hand. Reply on WhatsApp with one click.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LEAD_STATUSES.map((s) => (
          <Link key={s} href={q({ status: status === s ? undefined : s })} className={`card text-center ${status === s ? "ring-2 ring-indigo-400" : ""}`}>
            <p className="text-2xl font-bold">{counts[s]}</p>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{LEAD_STATUS_LABELS[s]}</p>
          </Link>
        ))}
      </section>

      {brands.length > 1 && (
        <nav className="flex flex-wrap gap-1.5">
          <Link href={q({ brandId: undefined })} className={`badge border ${!brandId ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}>All</Link>
          {brands.map((b) => (
            <Link key={b.id} href={q({ brandId: String(b.id) })} className={`badge border ${brandId === b.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}>{b.name}</Link>
          ))}
        </nav>
      )}

      {brands.length > 0 && <AddLeadForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />}

      {rows.length === 0 ? (
        <div className="card text-center text-sm text-zinc-600">
          No leads yet. Open a business account and copy its <b>enquiry page</b> link into your bio and posts.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ lead, brandName }) => {
            const brand = brandById.get(lead.brandId);
            const wa = whatsappLink(lead.phone, followUpText(brand ?? { name: brandName }, lead));
            return (
              <article key={lead.id} className="card space-y-2" data-testid="lead">
                <header className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`badge ${TONE[lead.status] ?? ""}`}>{LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS] ?? lead.status}</span>
                  <b>{lead.name}</b>
                  <span className="text-zinc-500">· {brandName} · {lead.source}</span>
                  <span className="ml-auto text-xs text-zinc-500">{formatSlot(lead.createdAt, brand?.timezone ?? "Asia/Kolkata")}</span>
                </header>
                <p className="text-sm text-zinc-700">
                  {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                  {lead.message && <span className="block text-zinc-600">“{lead.message}”</span>}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {wa && <a href={wa} target="_blank" rel="noreferrer" className="badge border border-emerald-500 bg-emerald-50 text-emerald-700">💬 WhatsApp</a>}
                  {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="badge border border-zinc-200 bg-white text-zinc-600">📞 Call</a>}
                  {lead.email && <a href={`mailto:${lead.email}`} className="badge border border-zinc-200 bg-white text-zinc-600">✉️ Email</a>}
                  {canEdit && (
                    <form action={updateLeadAction.bind(null, lead.id)} className="ml-auto flex flex-wrap items-center gap-1.5">
                      <select name="status" defaultValue={lead.status} className="input w-auto py-1 text-xs">
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
                      </select>
                      <input name="notes" defaultValue={lead.notes ?? ""} placeholder="Notes" className="input w-56 py-1 text-xs" />
                      <button className="btn-secondary py-1 text-xs">Save</button>
                    </form>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
