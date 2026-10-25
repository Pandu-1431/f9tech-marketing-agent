import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { freePlan } from "@/lib/config";
import { listBrands } from "@/lib/data";
import { publicUrl } from "@/lib/storage";

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const { added } = await searchParams;
  const { workspace } = await requireAuth();
  const brands = await listBrands(workspace.id);
  const max = freePlan().maxBrands;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Business accounts</h1>
          <p className="text-sm text-zinc-500">
            {brands.length} of {max} on the free plan. Each one has its own Brand Kit.
          </p>
        </div>
        {brands.length < max ? (
          <Link href="/brands/new" className="btn">Add business account</Link>
        ) : (
          <span className="text-sm text-zinc-500">Free plan limit reached</span>
        )}
      </div>

      {added && brands.length > 0 && (
        <div className="card border-emerald-200 bg-emerald-50">
          <p className="font-medium text-emerald-900">Business account saved.</p>
          <p className="text-sm text-emerald-800">Next step: create a campaign. Type a theme and the agent plans the calendar and writes every post.</p>
          <Link href="/campaigns/new" className="btn mt-3">Create your first campaign</Link>
        </div>
      )}

      {brands.length === 0 ? (
        <div className="card text-sm text-zinc-500">
          <p>No business accounts yet. A business account holds your Brand Kit (name, colors, tone, platforms).</p>
          <Link href="/brands/new" className="btn mt-3">Add business account</Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.id}`} className="card block hover:border-indigo-300">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  {b.logoKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={publicUrl(b.logoKey)} alt="" className="h-8 w-8 rounded border border-zinc-200 bg-white object-contain" />
                  )}
                  {b.name}
                </h2>
                <div className="flex gap-1">
                  {b.colors.slice(0, 5).map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full border border-zinc-200" style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                {[b.industry, b.city].filter(Boolean).join(" · ") || "Brand Kit not filled yet"}
              </p>
              <p className="mt-2 line-clamp-2 text-sm text-zinc-700">{b.description}</p>
              <p className="mt-2 text-xs text-zinc-500">{b.platforms.join(", ")}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
