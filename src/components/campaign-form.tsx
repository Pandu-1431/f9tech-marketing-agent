"use client";

import { useActionState, useState } from "react";
import { createCampaignAction } from "@/app/actions/campaigns";
import type { FormState } from "@/app/actions/auth";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { CAMPAIGN_TYPES, CTA_SUGGESTIONS, FORMAT_LABELS, type CampaignType } from "@/lib/campaign-types";

type BrandOption = { id: number; name: string; platforms: string[]; language: string };

const THEME_PLACEHOLDERS: Record<CampaignType, string> = {
  general: "Diwali sweets offer — 20% off gift boxes",
  awareness: "Say no to single-use plastic on RK Beach",
  event: "RK Beach clean-up drive — Sunday 7 AM",
  volunteer_drive: "Join our weekend teaching volunteers",
  fundraising: "School kits for 200 children this June",
  observance: "World Environment Day — plant a tree",
  impact_story: "What 120 volunteers did in October",
};

export function CampaignForm({ brands, today }: { brands: BrandOption[]; today: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createCampaignAction, undefined);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? 0);
  const [campaignType, setCampaignType] = useState<CampaignType>("general");
  const brand = brands.find((b) => b.id === brandId);
  const twoWeeks = new Date(Date.parse(today) + 13 * 86400000).toISOString().slice(0, 10);
  const hasEventDate = campaignType === "event" || campaignType === "observance";

  return (
    <form action={formAction} className="card space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="brandId">Business account</label>
          <select className="input" id="brandId" name="brandId" value={brandId} onChange={(e) => setBrandId(Number(e.target.value))}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="campaignType">Campaign type</label>
          <select
            className="input"
            id="campaignType"
            name="campaignType"
            value={campaignType}
            onChange={(e) => setCampaignType(e.target.value as CampaignType)}
          >
            {Object.entries(CAMPAIGN_TYPES).map(([value, t]) => (
              <option key={value} value={value}>{t.label}</option>
            ))}
          </select>
          <p className="hint">Sets the story the calendar follows.</p>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="theme">Theme</label>
        <input className="input" id="theme" name="theme" required placeholder={THEME_PLACEHOLDERS[campaignType]} />
        <p className="hint">One line: what this campaign is about.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="goal">Goal (optional)</label>
          <textarea className="input" id="goal" name="goal" rows={2} placeholder="50 volunteer sign-ups for the drive" />
        </div>
        <div>
          <label className="label" htmlFor="audience">Audience (optional)</label>
          <textarea className="input" id="audience" name="audience" rows={2} placeholder="College students and young professionals in Vizag" />
          <p className="hint">Leave empty to use the Brand Kit audience.</p>
        </div>
      </div>

      {hasEventDate && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="eventDate">{campaignType === "event" ? "Event date" : "Day date (optional)"}</label>
            <input className="input" id="eventDate" name="eventDate" type="date" required={campaignType === "event"} />
          </div>
          <div>
            <label className="label" htmlFor="location">Location (optional)</label>
            <input className="input" id="location" name="location" maxLength={200} placeholder="RK Beach, near Kali Temple" />
          </div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="keyFacts">Key facts (optional)</label>
        <textarea
          className="input"
          id="keyFacts"
          name="keyFacts"
          rows={3}
          maxLength={2000}
          placeholder={"Reporting time 6:45 AM, gloves and bags provided\nLast drive: 85 volunteers, 420 kg waste removed\nContact: 98xxxxxx10"}
        />
        <p className="hint">Times, numbers, contacts. The agent uses only these facts and never invents numbers.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="callToAction">Call to action (optional)</label>
          <input className="input" id="callToAction" name="callToAction" list="cta-suggestions" maxLength={60} placeholder="Volunteer now" />
          <datalist id="cta-suggestions">
            {CTA_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor="ctaUrl">Link (optional)</label>
          <input className="input" id="ctaUrl" name="ctaUrl" type="url" maxLength={300} placeholder="https://vizagvolunteers.org/join" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="language">Language</label>
          <input className="input" id="language" name="language" key={brandId} defaultValue={brand?.language} maxLength={60} placeholder="English + Telugu" />
        </div>
        <div>
          <label className="label" htmlFor="hashtags">Campaign hashtags (optional)</label>
          <input className="input" id="hashtags" name="hashtags" placeholder="#VizagBeachCleanup #VVDrive2026" />
          <p className="hint">Added to every post, on top of the brand hashtags.</p>
        </div>
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
      <fieldset>
        <legend className="label">Post formats</legend>
        <div className="flex flex-wrap gap-3">
          {Object.entries(FORMAT_LABELS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="formats" value={value} defaultChecked={value !== "text"} />
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
