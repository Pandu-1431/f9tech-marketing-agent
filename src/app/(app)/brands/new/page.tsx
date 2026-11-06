import { createBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { timeZoneOptions } from "@/lib/schedule";
import { requireEditor } from "@/lib/auth";
import { WebsiteOnboardForm } from "@/components/website-onboard-form";

export default async function NewBrandPage() {
  await requireEditor();
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Add business account</h1>
      <WebsiteOnboardForm />
      <p className="text-center text-sm text-zinc-500">or fill it in yourself</p>
      <BrandForm action={createBrandAction} submitLabel="Save business account" timeZones={timeZoneOptions()} />
    </div>
  );
}
