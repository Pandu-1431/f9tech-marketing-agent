"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import type { Brand } from "@/db/schema";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { brandFonts, FONT_CHOICES } from "@/lib/font-choices";

type Props = {
  brand?: Brand;
  logoUrl?: string | null;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  timeZones?: string[];
  /** Product screenshots already saved (edit page only). */
  shots?: { id: number; url: string; label: string }[];
};

export function BrandForm({ brand, logoUrl, action, submitLabel, timeZones = ["Asia/Kolkata"], shots = [] }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);
  const join = (v?: string[] | null) => (v ?? []).join(", ");
  const hex = (v: string | undefined, fallback: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

  return (
    <form action={formAction} className="space-y-6">
      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Business</h2>
        <div>
          <label className="label" htmlFor="name">Business name *</label>
          <input className="input" id="name" name="name" defaultValue={brand?.name} required />
        </div>
        <div>
          <label className="label" htmlFor="industry">Industry</label>
          <input className="input" id="industry" name="industry" defaultValue={brand?.industry ?? ""} placeholder="Sweet shop, real estate, clinic…" />
        </div>
        <div>
          <label className="label" htmlFor="website">Website</label>
          <input className="input" id="website" name="website" defaultValue={brand?.website ?? ""} placeholder="https://" />
        </div>
        <div>
          <label className="label" htmlFor="city">City / market</label>
          <input className="input" id="city" name="city" defaultValue={brand?.city ?? ""} placeholder="Visakhapatnam" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="description">What the business does</label>
          <textarea className="input" id="description" name="description" rows={3} defaultValue={brand?.description ?? ""} />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="audience">Target audience</label>
          <textarea className="input" id="audience" name="audience" rows={2} defaultValue={brand?.audience ?? ""} placeholder="Families in Vizag, 25-45, who buy for festivals and gifting" />
        </div>
      </section>

      <section className="card grid gap-4 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Brand Kit</h2>
        <div className="flex items-center gap-4 md:col-span-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded-lg border border-zinc-200 bg-white object-contain p-1" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400">Logo</div>
          )}
          <div>
            <label className="label" htmlFor="logo">Logo</label>
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-sm" />
            <p className="hint">PNG with transparent background works best. Max 2 MB. Printed on every poster.</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="tone">Tone of voice</label>
          <input className="input" id="tone" name="tone" defaultValue={brand?.tone ?? ""} placeholder="Warm, festive, trustworthy" />
        </div>
        <div>
          <label className="label" htmlFor="language">Language</label>
          <input className="input" id="language" name="language" defaultValue={brand?.language ?? "English"} placeholder="English, Telugu, Hindi…" />
        </div>
        <div>
          <label className="label" htmlFor="timezone">Time zone for posting times</label>
          <select className="input" id="timezone" name="timezone" defaultValue={brand?.timezone ?? "Asia/Kolkata"}>
            {timeZones.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="services">Services or products</label>
          <textarea
            className="input"
            id="services"
            name="services"
            rows={3}
            defaultValue={brand?.services ?? ""}
            placeholder={"One per line, e.g.\nWedding sweets boxes\nCorporate Diwali gifting\nSugar-free range"}
          />
          <p className="hint">The planner spreads posts across these, so every service gets attention.</p>
        </div>
        <div>
          <span className="label">Brand colours</span>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="color" name="colorPrimary" defaultValue={hex(brand?.colors?.[0], "#3730a3")} className="h-9 w-12 cursor-pointer rounded border border-zinc-200" />
              Main
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="color" name="colorAccent" defaultValue={hex(brand?.colors?.[1], "#f59e0b")} className="h-9 w-12 cursor-pointer rounded border border-zinc-200" />
              Accent
            </label>
          </div>
          <input type="hidden" name="colorsExtra" defaultValue={join(brand?.colors?.slice(2))} />
          <p className="hint">Main = bands and backgrounds (use your logo colour). Accent = buttons and highlights.</p>
        </div>
        <div>
          <label className="label" htmlFor="fontHeading">Heading font</label>
          <select className="input" id="fontHeading" name="fontHeading" defaultValue={brandFonts(brand?.fonts).heading}>
            {FONT_CHOICES.filter((f) => f.use !== "body").map((f) => (
              <option key={f.family} value={f.family}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fontBody">Body font</label>
          <select className="input" id="fontBody" name="fontBody" defaultValue={brandFonts(brand?.fonts).body}>
            {FONT_CHOICES.filter((f) => f.use !== "heading").map((f) => (
              <option key={f.family} value={f.family}>{f.label}</option>
            ))}
          </select>
          <p className="hint">Used on every poster and video. Telugu and Hindi text switch to a matching font automatically.</p>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="visualStyle">Photo style</label>
          <textarea
            className="input"
            id="visualStyle"
            name="visualStyle"
            rows={2}
            defaultValue={brand?.visualStyle ?? ""}
            placeholder="Real Indian students aged 20-30 studying at home, in libraries and hostels; calm, hopeful mood; warm daylight. No stock-photo look."
          />
          <p className="hint">Who and what should appear in your photos. Every AI image follows this.</p>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="keyFacts">Key facts</label>
          <textarea
            className="input"
            id="keyFacts"
            name="keyFacts"
            rows={4}
            defaultValue={brand?.keyFacts ?? ""}
            placeholder={"One per line, e.g.\n2,476 real UPSC past questions\nFree, no ads\nWorks offline"}
          />
          <p className="hint">True numbers and features. The AI only states facts from here and the campaign brief.</p>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="voiceSamples">Your own posts (for your voice)</label>
          <textarea
            className="input"
            id="voiceSamples"
            name="voiceSamples"
            rows={4}
            defaultValue={brand?.voiceSamples ?? ""}
            placeholder={"Paste 2-5 posts you wrote yourself, one after another.\nThe AI copies how you talk (words, length, emojis), not the text."}
          />
          <p className="hint">Makes every caption sound like you, not like an AI.</p>
        </div>
        <div>
          <label className="label" htmlFor="keywords">SEO keywords</label>
          <input className="input" id="keywords" name="keywords" defaultValue={join(brand?.keywords)} placeholder="best sweets in vizag, diwali sweets" />
          <p className="hint">Words customers search for. Comma separated.</p>
        </div>
        <div>
          <label className="label" htmlFor="hashtags">Brand hashtags</label>
          <input className="input" id="hashtags" name="hashtags" defaultValue={join(brand?.hashtags)} placeholder="#vizagsweets, #sweetmoments" />
        </div>
        <div>
          <label className="label" htmlFor="dos">Do</label>
          <textarea className="input" id="dos" name="dos" rows={2} defaultValue={brand?.dos ?? ""} placeholder="Mention fresh daily, family recipes" />
        </div>
        <div>
          <label className="label" htmlFor="donts">Don&apos;t</label>
          <textarea className="input" id="donts" name="donts" rows={2} defaultValue={brand?.donts ?? ""} placeholder="No competitor names, no health claims" />
        </div>
        <div className="md:col-span-2">
          <span className="label">App or website screenshots (for reels)</span>
          {shots.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-3">
              {shots.map((s, i) => (
                <label key={s.id} className="w-24 text-center text-xs text-zinc-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={s.label} className="mb-1 h-40 w-24 rounded-lg border border-zinc-200 object-cover object-top" />
                  <span className="block truncate">{i + 1}. {s.label}</span>
                  <span className="flex items-center justify-center gap-1">
                    <input type="checkbox" name="removeShot" value={s.id} /> remove
                  </span>
                </label>
              ))}
            </div>
          )}
          <input id="shots" name="shots" type="file" multiple accept="image/png,image/jpeg,image/webp" className="text-sm" />
          <p className="hint">
            Up to 8 phone screenshots (PNG/JPG, max 3 MB each). Name the files by what they show, e.g. &quot;daily-plan.png&quot;, &quot;past-questions.png&quot;. Reels show them in a phone, so people see the real product.
          </p>
        </div>
        <fieldset className="md:col-span-2">
          <legend className="label">Platforms this business uses</legend>
          <div className="flex flex-wrap gap-3">
            {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="platforms" value={value} defaultChecked={brand?.platforms.includes(value) ?? value === "instagram"} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
