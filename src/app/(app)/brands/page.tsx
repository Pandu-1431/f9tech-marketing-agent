import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { freePlan } from "@/lib/config";
import { listBrands } from "@/lib/data";

export default async function BrandsPage() {
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

      {brands.length === 0 ? (
        <div className="card text-sm text-zinc-500">No business accounts yet.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.id}`} className="card block hover:border-indigo-300">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{b.name}</h2>
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
