import Link from "next/link";
import { notFound } from "next/navigation";
import { updateBrandAction } from "@/app/actions/brands";
import { canManageTeam } from "@/lib/team";
import { BrandForm } from "@/components/brand-form";
import { AutopilotForm } from "@/components/autopilot-form";
import { ChannelsSection } from "@/components/channels-section";
import { MemorySection } from "@/components/memory-section";
import { SeoSection } from "@/components/seo-section";
import { PresenterSection } from "@/components/presenter-section";
import { DirectorSection } from "@/components/director-section";
import { GoLiveChecklist } from "@/components/go-live";
import { goLiveStatus } from "@/lib/go-live";
import { EnquirySection } from "@/components/enquiry-section";
import { last30Days, leadCodeFor } from "@/lib/leads";
import { trackingBase } from "@/lib/links";
import { headers } from "next/headers";
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
  const { workspace, role } = await requireEditor();
  const { id } = await params;
  const { youtube, gbp, sheets, presenter, onboarded } = await searchParams;
  const brand = await getBrand(workspace.id, Number(id));
  if (!brand) notFound();
  const shots = (await listProductShots(workspace.id, brand.id)).map((s) => ({ id: s.id, url: publicUrl(s.storageKey), label: s.prompt ?? "app screen" }));
  const stats30 = await last30Days(workspace.id, brand.id);
  const db = await getDb();
  const [measured] = await db.select({ n: count() }).from(schema.postMetrics).where(and(eq(schema.postMetrics.workspaceId, workspace.id), eq(schema.postMetrics.brandId, brand.id)));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <div className="flex items-center gap-2">
          <Link href={`/brands/${brand.id}/articles`} className="btn-secondary">Blog articles</Link>
          <Link href={`/reports/${brand.id}`} className="btn-secondary">Monthly report</Link>
          <Link href={`/brands/${brand.id}/training`} className="btn-secondary">Training center</Link>

        </div>
      </div>
      {onboarded && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="onboarded">
          Filled from {brand.website}. Check the Brand Kit below (especially the key facts), then connect channels and start a campaign. The SEO kit is
          being built now.
        </p>
      )}
      <GoLiveChecklist brand={brand} s={await goLiveStatus(workspace.id, brand)} />
      <DirectorSection brand={brand} job={await directorJobState(workspace.id, brand.id)} campaigns={await planCampaigns(workspace.id, brand.id, brand.marketingPlan)} />
      <AutopilotForm brand={brand} />
      <ChannelsSection brand={brand} channels={await listChannels(workspace.id, brand.id)} youtubeReady={googleConfigured()} youtubeStatus={youtube} gbpStatus={gbp} sheetsStatus={sheets} />
      <EnquirySection
        brand={brand}
        url={`${(process.env.APP_URL ?? `http://${(await headers()).get("host") ?? "localhost:3000"}`).replace(/\/$/, "")}/l/${await leadCodeFor(workspace.id, brand.id)}`}
        leads30={stats30.leads}
        clicks30={stats30.clicks}
        tracking={Boolean(trackingBase())}
      />
      <PresenterSection brand={brand} status={presenter} />
      <SeoSection brand={brand} job={await seoJobState(workspace.id, brand.id)} />
      <MemorySection brand={brand} memory={await listMemory(workspace.id, brand.id)} measured={Number(measured?.n ?? 0)} />
      <BrandForm brand={brand} logoUrl={brand.logoKey ? publicUrl(brand.logoKey) : null} action={updateBrandAction.bind(null, brand.id)} submitLabel="Save changes" timeZones={timeZoneOptions()} shots={shots} />
      {canManageTeam(role) && (
        <section className="rounded-2xl border border-red-200 p-5" data-testid="danger-zone">
          <h2 className="font-semibold text-red-800">Danger zone</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Delete this business account with all its posts, images, videos, leads and articles, and free the storage they use. You will see
            exactly what goes and confirm with its name and your password.
          </p>
          <Link href={`/brands/${brand.id}/delete`} className="mt-3 inline-block rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
            Delete this business account…
          </Link>
        </section>
      )}
    </div>
  );
}
