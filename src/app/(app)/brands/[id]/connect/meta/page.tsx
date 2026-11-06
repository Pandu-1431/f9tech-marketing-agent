import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { listPages, type MetaPage } from "@/agent/publish/meta-connect";
import { readPick } from "@/lib/meta-pick";
import { connectMetaPageAction } from "@/app/actions/meta";
import { Crumbs } from "@/components/ui/crumbs";

export const dynamic = "force-dynamic";

/** After Facebook login (or a pasted token): pick the Page, and its Instagram account, for this business. */
export default async function PickPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireEditor();
  const brand = await getBrand(workspace.id, Number((await params).id));
  if (!brand) notFound();
  const token = await readPick(brand.id);
  let pages: MetaPage[] = [];
  let problem: string | null = null;
  if (!token) problem = "This step timed out. Go back and click Connect with Facebook again.";
  else {
    try {
      pages = await listPages(token);
      if (!pages.length) problem = "No Facebook Page found for this login. You need to be an admin of the Page, and allow the app to use it on the Facebook screen.";
    } catch (err) {
      problem = `Facebook said: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return (
    <div className="max-w-2xl space-y-5" data-testid="meta-pick">
      <Crumbs items={[{ href: "/brands", label: "Business accounts" }, { href: `/brands/${brand.id}`, label: brand.name }, { href: `/brands/${brand.id}#channels`, label: "Channels" }, { label: "Pick your Page" }]} />
      <div>
        <h1 className="text-2xl font-semibold">Which Facebook Page is {brand.name}?</h1>
        <p className="text-sm text-zinc-600">Posts for {brand.name} will go to the Page you pick, and to its Instagram account if you tick it.</p>
      </div>
      {problem && (
        <div className="card space-y-2 text-sm">
          <p className="text-red-700">{problem}</p>
          <Link href={`/brands/${brand.id}#channels`} className="btn-secondary inline-block">← Back to Channels</Link>
        </div>
      )}
      {pages.map((p) => (
        <form key={p.id} action={connectMetaPageAction.bind(null, brand.id, p.id)} className="card flex flex-wrap items-center gap-4">
          {p.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.picture} alt="" className="h-12 w-12 rounded-full border border-zinc-200" />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-xl">f</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{p.name}</p>
            {p.instagram ? (
              <label className="mt-1 flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name="instagram" defaultChecked /> Also post to Instagram <b>@{p.instagram.username}</b>
              </label>
            ) : (
              <p className="text-xs text-zinc-500">No Instagram professional account is linked to this Page (link it in Instagram → Settings → Account type, then connect again).</p>
            )}
          </div>
          <button className="btn">Connect this Page</button>
        </form>
      ))}
      <p className="text-xs text-zinc-500">The token is kept encrypted and is only used to post, read results and reply to comments for {brand.name}.</p>
    </div>
  );
}
