import Link from "next/link";
import { CampaignForm } from "@/components/campaign-form";
import { requireEditor } from "@/lib/auth";
import { listBrands } from "@/lib/data";

export default async function NewCampaignPage() {
  const { workspace } = await requireEditor();
  const brands = await listBrands(workspace.id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">New campaign</h1>
      {brands.length === 0 ? (
        <div className="card text-sm">
          Add a business account first. <Link href="/brands/new" className="text-indigo-600">Add one</Link>
        </div>
      ) : (
        <CampaignForm brands={brands.map((b) => ({ id: b.id, name: b.name, platforms: b.platforms }))} today={today} />
      )}
    </div>
  );
}
