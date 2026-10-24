import { notFound } from "next/navigation";
import { deleteBrandAction, updateBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { requireEditor } from "@/lib/auth";
import { getBrand } from "@/lib/data";
import { publicUrl } from "@/lib/storage";

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireEditor();
  const { id } = await params;
  const brand = await getBrand(workspace.id, Number(id));
  if (!brand) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <form action={deleteBrandAction.bind(null, brand.id)}>
          <button className="btn-danger">Delete</button>
        </form>
      </div>
      <BrandForm brand={brand} logoUrl={brand.logoKey ? publicUrl(brand.logoKey) : null} action={updateBrandAction.bind(null, brand.id)} submitLabel="Save changes" />
    </div>
  );
}
