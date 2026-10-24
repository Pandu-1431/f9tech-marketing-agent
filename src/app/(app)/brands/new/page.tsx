import { createBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { requireEditor } from "@/lib/auth";

export default async function NewBrandPage() {
  await requireEditor();
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Add business account</h1>
      <BrandForm action={createBrandAction} submitLabel="Save business account" />
    </div>
  );
}
