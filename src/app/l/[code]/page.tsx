import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { brandByLeadCode, normalisePhone } from "@/lib/leads";
import { submitLeadAction } from "@/app/actions/leads";
import { LeadForm } from "@/components/lead-form";
import { publicUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const brand = await brandByLeadCode((await params).code);
  return { title: brand ? `Contact ${brand.name}` : "Enquiry", robots: { index: false } };
}

/** Public enquiry page for one business (posts link here). No login. */
export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { code } = await params;
  const brand = await brandByLeadCode(code);
  if (!brand) notFound();
  const ref = ((await searchParams).ref ?? "").replace(/[^\w-]/g, "").slice(0, 40);
  const color = brand.colors.find((c) => /^#[0-9a-f]{6}$/i.test(c)) ?? "#4f46e5";
  const phoneLine = /(?:phone|call|whatsapp|mobile)[^\n\d]*([+\d][\d\s-]{8,})/i.exec(brand.keyFacts ?? "")?.[1];
  const wa = normalisePhone(phoneLine);
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-10" data-testid="enquiry-page">
      <div className="mx-auto max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          {brand.logoKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={publicUrl(brand.logoKey)} alt="" className="h-14 w-14 rounded-xl border border-zinc-100 object-contain" />
          )}
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{brand.name}</h1>
            {(brand.industry || brand.city) && <p className="text-sm text-zinc-500">{[brand.industry, brand.city].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>
        {brand.description && <p className="text-sm text-zinc-700">{brand.description}</p>}
        <LeadForm action={submitLeadAction.bind(null, code)} refSource={ref} accent={color} brandName={brand.name} />
        {wa && (
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hi ${brand.name}, I have a question.`)}`} className="block rounded-xl border border-emerald-500 px-4 py-3 text-center font-semibold text-emerald-700">
            Chat on WhatsApp
          </a>
        )}
        {brand.website && (
          <p className="text-center text-xs text-zinc-500">
            <a href={brand.website} className="underline">{brand.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
          </p>
        )}
      </div>
    </main>
  );
}
