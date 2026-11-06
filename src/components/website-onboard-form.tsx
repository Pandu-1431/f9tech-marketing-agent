"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { createBrandFromWebsiteAction } from "@/app/actions/onboarding";

/** "Fill from website": the fastest way to add a business. */
export function WebsiteOnboardForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createBrandFromWebsiteAction, undefined);
  return (
    <form action={action} className="card space-y-3" data-testid="onboard-from-website">
      <div>
        <h2 className="font-semibold">Fill everything from a website ✨</h2>
        <p className="text-sm text-zinc-600">
          Paste the business&apos;s website, landing page or app store link. The AI reads it and fills the Brand Kit (what it offers, who it is for,
          key facts, keywords, hashtags, colours) and saves the logo. You can change anything after.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-[260px] flex-1" name="website" placeholder="https://yourbusiness.com" required disabled={pending} />
        <button className="btn" disabled={pending}>{pending ? "Reading the website…" : "Fill from website"}</button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
