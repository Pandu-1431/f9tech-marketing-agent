"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import type { Brand } from "@/db/schema";
import { PLATFORM_LABELS } from "@/lib/platforms";

type Props = {
  brand?: Brand;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
};

export function BrandForm({ brand, action, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);
  const join = (v?: string[] | null) => (v ?? []).join(", ");

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
        <div>
          <label className="label" htmlFor="tone">Tone of voice</label>
          <input className="input" id="tone" name="tone" defaultValue={brand?.tone ?? ""} placeholder="Warm, festive, trustworthy" />
        </div>
        <div>
          <label className="label" htmlFor="language">Language</label>
          <input className="input" id="language" name="language" defaultValue={brand?.language ?? "English"} placeholder="English, Telugu, Hindi…" />
        </div>
        <div>
          <label className="label" htmlFor="colors">Brand colours</label>
          <input className="input" id="colors" name="colors" defaultValue={join(brand?.colors)} placeholder="#E63946, #F1FAEE" />
          <p className="hint">Comma separated hex codes.</p>
        </div>
        <div>
          <label className="label" htmlFor="fonts">Fonts</label>
          <input className="input" id="fonts" name="fonts" defaultValue={join(brand?.fonts)} placeholder="Poppins, Lato" />
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

      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
