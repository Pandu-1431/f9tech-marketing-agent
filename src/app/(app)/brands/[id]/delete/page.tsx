import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageTeam } from "@/lib/team";
import { getBrand } from "@/lib/data";
import { brandFootprint, formatBytes } from "@/lib/brand-delete";
import { deleteBrandForeverAction } from "@/app/actions/brands";
import { DeleteBrandForm } from "@/components/delete-brand-form";

export const dynamic = "force-dynamic";

/** Deleting a business account: see what goes, download a copy, then confirm three ways. Owner only. */
export default async function DeleteBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace, role } = await requireAuth();
  const brand = await getBrand(workspace.id, Number((await params).id));
  if (!brand) notFound();
  if (!canManageTeam(role)) {
    return (
      <div className="max-w-xl card space-y-2">
        <h1 className="text-xl font-semibold">Only the owner can delete a business account</h1>
        <Link href={`/brands/${brand.id}`} className="text-indigo-700 underline">← Back to {brand.name}</Link>
      </div>
    );
  }
  const f = await brandFootprint(workspace.id, brand.id);
  const rows: [string, string][] = [
    ["Campaigns", String(f.campaigns)],
    ["Posts", `${f.posts}${f.published ? ` (${f.published} published; they stay on the social platforms)` : ""}`],
    ["Images and videos", `${f.files} files · ${formatBytes(f.bytes)}`],
    ["Leads", String(f.leads)],
    ["Blog articles", String(f.articles)],
    ["Comments in the inbox", String(f.comments)],
    ["Connected channels", String(f.channels)],
  ];

  return (
    <div className="max-w-xl space-y-6" data-testid="delete-brand">
      <Link href={`/brands/${brand.id}`} className="text-sm text-zinc-500">← Back to {brand.name}</Link>
      <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
        <h1 className="text-xl font-semibold text-red-800">Delete “{brand.name}” for good?</h1>
        <p className="mt-1 text-sm text-red-900">
          This removes the business account and everything the AI team made for it, and frees the storage it used. It cannot be undone: there is no
          trash and no backup to restore from.
        </p>
      </div>

      <section className="card space-y-2">
        <h2 className="font-semibold">What will be deleted</h2>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-zinc-100">
                <td className="py-1.5 text-zinc-600">{k}</td>
                <td className="py-1.5 text-right font-medium">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Keep a copy first (optional)</h2>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/tracker?brandId=${brand.id}`} download>Posts &amp; results (CSV)</a>
          <a className="btn-secondary" href={`/api/training/${brand.id}?type=sft`} download>Training data</a>
          <Link className="btn-secondary" href={`/reports/${brand.id}`}>Monthly report (PDF)</Link>
        </div>
      </section>

      <section className="card">
        <DeleteBrandForm name={brand.name} action={deleteBrandForeverAction.bind(null, brand.id)} />
      </section>
    </div>
  );
}
