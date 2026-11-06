import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteBrandAction, updateBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { AutopilotForm } from "@/components/autopilot-form";
import { ChannelsSection } from "@/components/channels-section";
import { MemorySection } from "@/components/memory-section";
import { SeoSection } from "@/components/seo-section";
import { PresenterSection } from "@/components/presenter-section";
import { DirectorSection } from "@/components/director-section";
import { directorJobState, planCampaigns } from "@/agent/director";
import { seoJobState } from "@/agent/seo";
import { listMemory } from "@/agent/memory";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listChannels } from "@/agent/publish";
import { googleConfigured } from "@/agent/publish/youtube";
import { timeZoneOptions } from "@/lib/schedule";
import { requireEditor } from "@/lib/auth";
import { getBrand, listProductShots } from "@/lib/data";
import { publicUrl } from "@/lib/storage";

export default async function EditBrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ youtube?: string; gbp?: string; sheets?: string; presenter?: string; onboarded?: string }> }) {
  const { workspace } = await requireEditor();
  const { id } = await params;
  const { youtube, gbp, sheets, presenter, onboarded } = await searchParams;
  const brand = await getBrand(workspace.id, Number(id));
  if (!brand) notFound();
  const shots = (await listProductShots(workspace.id, brand.id)).map((s) => ({ id: s.id, url: publicUrl(s.storageKey), label: s.prompt ?? "app screen" }));
  const db = await getDb();
  const [measured] = await db.select({ n: count() }).from(schema.postMetrics).where(and(eq(schema.postMetrics.workspaceId, workspace.id), eq(schema.postMetrics.brandId, brand.id)));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/brands/${brand.id}/training`} className="btn-secondary">Training center</Link>
          <form action={deleteBrandAction.bind(null, brand.id)}>
            <button className="btn-danger">Delete</button>
          </form>
        </div>
      </div>
      {onboarded && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="onboarded">
          Filled from {brand.website}. Check the Brand Kit below (especially the key facts), then connect channels and start a campaign. The SEO kit is
          being built now.
        </p>
      )}
      <DirectorSection brand={brand} job={await directorJobState(workspace.id, brand.id)} campaigns={await planCampaigns(workspace.id, brand.id, brand.marketingPlan)} />
      <AutopilotForm brand={brand} />
      <ChannelsSection brand={brand} channels={await listChannels(workspace.id, brand.id)} youtubeReady={googleConfigured()} youtubeStatus={youtube} gbpStatus={gbp} sheetsStatus={sheets} />
      <PresenterSection brand={brand} status={presenter} />
      <SeoSection brand={brand} job={await seoJobState(workspace.id, brand.id)} />
      <MemorySection brand={brand} memory={await listMemory(workspace.id, brand.id)} measured={Number(measured?.n ?? 0)} />
      <BrandForm brand={brand} logoUrl={brand.logoKey ? publicUrl(brand.logoKey) : null} action={updateBrandAction.bind(null, brand.id)} submitLabel="Save changes" timeZones={timeZoneOptions()} shots={shots} />
    </div>
  );
}
