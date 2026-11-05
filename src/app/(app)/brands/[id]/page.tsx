import { notFound } from "next/navigation";
import { deleteBrandAction, updateBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { AutopilotForm } from "@/components/autopilot-form";
import { timeZoneOptions } from "@/lib/schedule";
import { requireEditor } from "@/lib/auth";
import { getBrand, listProductShots } from "@/lib/data";
import { publicUrl } from "@/lib/storage";

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireEditor();
  const { id } = await params;
  const brand = await getBrand(workspace.id, Number(id));
  if (!brand) notFound();
  const shots = (await listProductShots(workspace.id, brand.id)).map((s) => ({ id: s.id, url: publicUrl(s.storageKey), label: s.prompt ?? "app screen" }));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <form action={deleteBrandAction.bind(null, brand.id)}>
          <button className="btn-danger">Delete</button>
        </form>
      </div>
      <AutopilotForm brand={brand} />
      <BrandForm brand={brand} logoUrl={brand.logoKey ? publicUrl(brand.logoKey) : null} action={updateBrandAction.bind(null, brand.id)} submitLabel="Save changes" timeZones={timeZoneOptions()} shots={shots} />
    </div>
  );
}
