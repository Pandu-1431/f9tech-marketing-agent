import { notFound } from "next/navigation";
import { deleteBrandAction, updateBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { AutopilotForm } from "@/components/autopilot-form";
import { ChannelsSection } from "@/components/channels-section";
import { MemorySection } from "@/components/memory-section";
import { listMemory } from "@/agent/memory";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listChannels } from "@/agent/publish";
import { googleConfigured } from "@/agent/publish/youtube";
import { timeZoneOptions } from "@/lib/schedule";
import { requireEditor } from "@/lib/auth";
import { getBrand, listProductShots } from "@/lib/data";
import { publicUrl } from "@/lib/storage";

export default async function EditBrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ youtube?: string }> }) {
  const { workspace } = await requireEditor();
  const { id } = await params;
  const { youtube } = await searchParams;
  const brand = await getBrand(workspace.id, Number(id));
  if (!brand) notFound();
  const shots = (await listProductShots(workspace.id, brand.id)).map((s) => ({ id: s.id, url: publicUrl(s.storageKey), label: s.prompt ?? "app screen" }));
  const db = await getDb();
  const [measured] = await db.select({ n: count() }).from(schema.postMetrics).where(and(eq(schema.postMetrics.workspaceId, workspace.id), eq(schema.postMetrics.brandId, brand.id)));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <form action={deleteBrandAction.bind(null, brand.id)}>
          <button className="btn-danger">Delete</button>
        </form>
      </div>
      <AutopilotForm brand={brand} />
      <ChannelsSection brand={brand} channels={await listChannels(workspace.id, brand.id)} youtubeReady={googleConfigured()} youtubeStatus={youtube} />
      <MemorySection brand={brand} memory={await listMemory(workspace.id, brand.id)} measured={Number(measured?.n ?? 0)} />
      <BrandForm brand={brand} logoUrl={brand.logoKey ? publicUrl(brand.logoKey) : null} action={updateBrandAction.bind(null, brand.id)} submitLabel="Save changes" timeZones={timeZoneOptions()} shots={shots} />
    </div>
  );
}
