"use client";

import { useActionState, useState } from "react";
import { createCampaignAction } from "@/app/actions/campaigns";
import type { FormState } from "@/app/actions/auth";
import { PLATFORM_LABELS } from "@/lib/platforms";

type BrandOption = { id: number; name: string; platforms: string[] };

export function CampaignForm({ brands, today }: { brands: BrandOption[]; today: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createCampaignAction, undefined);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? 0);
  const brand = brands.find((b) => b.id === brandId);
  const twoWeeks = new Date(Date.parse(today) + 13 * 86400000).toISOString().slice(0, 10);

  return (
    <form action={formAction} className="card space-y-5">
      <div>
        <label className="label" htmlFor="brandId">Business account</label>
        <select className="input" id="brandId" name="brandId" value={brandId} onChange={(e) => setBrandId(Number(e.target.value))}>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="theme">Theme</label>
        <input className="input" id="theme" name="theme" required placeholder="Diwali sweets offer — 20% off gift boxes" />
        <p className="hint">One line: what this campaign is about.</p>
      </div>
      <div>
        <label className="label" htmlFor="goal">Goal (optional)</label>
        <textarea className="input" id="goal" name="goal" rows={2} placeholder="More walk-ins and WhatsApp pre-orders" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="startDate">Start</label>
          <input className="input" id="startDate" name="startDate" type="date" defaultValue={today} required />
        </div>
        <div>
          <label className="label" htmlFor="endDate">End</label>
          <input className="input" id="endDate" name="endDate" type="date" defaultValue={twoWeeks} required />
        </div>
        <div>
          <label className="label" htmlFor="postsPerWeek">Posts per week, per platform</label>
          <input className="input" id="postsPerWeek" name="postsPerWeek" type="number" min={1} max={14} defaultValue={3} />
        </div>
      </div>
      <fieldset key={brandId}>
        <legend className="label">Platforms</legend>
        <div className="flex flex-wrap gap-3">
          {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="platforms" value={value} defaultChecked={brand?.platforms.includes(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Starting…" : "Plan and write campaign"}</button>
      <p className="hint">The agent plans the calendar first, then writes every post. This takes a minute or two.</p>
    </form>
  );
}
