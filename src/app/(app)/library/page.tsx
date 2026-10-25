import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listAssets } from "@/lib/data";
import { publicUrl } from "@/lib/storage";

const KINDS: Record<string, string> = { poster: "Posters", video: "Videos", background: "AI images", scene: "Reel scenes", logo: "Logos" };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { workspace } = await requireAuth();
  const { kind = "poster" } = await searchParams;
  const active = KINDS[kind] ? kind : "poster";
  const assets = await listAssets(workspace.id, active);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Asset library</h1>
        <p className="text-sm text-zinc-500">Everything the agent made or you uploaded, in one place.</p>
      </div>
      <div className="flex gap-2">
        {Object.entries(KINDS).map(([k, label]) => (
          <Link key={k} href={`/library?kind=${k}`} className={`badge border px-3 py-1 ${k === active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}>
            {label}
          </Link>
        ))}
      </div>
      {assets.length === 0 ? (
        <div className="card text-sm text-zinc-500">Nothing here yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {assets.map(({ asset, brandName }) => (
            <div key={asset.id} className="card relative p-2">
              {asset.demo && (
                <span data-testid="demo-stamp" className="absolute left-3 top-3 z-10 rounded-md border-2 border-black bg-amber-400 px-2 py-0.5 text-xs font-black uppercase tracking-widest text-black">
                  Demo
                </span>
              )}
              {asset.kind === "video" ? (
                <video src={publicUrl(asset.storageKey)} controls preload="metadata" playsInline className="aspect-[9/16] w-full rounded-md bg-black" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicUrl(asset.storageKey)} alt="" className="aspect-square w-full rounded-md bg-zinc-50 object-contain" loading="lazy" />
              )}
              <p className="mt-2 truncate text-xs text-zinc-600">{brandName ?? "—"}</p>
              <p className="text-xs text-zinc-400">
                {asset.width && asset.height ? `${asset.width}×${asset.height}` : ""} · {asset.provider}
              </p>
              <a href={publicUrl(asset.storageKey)} target="_blank" rel="noreferrer" className="text-xs text-indigo-600">
                Open
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
