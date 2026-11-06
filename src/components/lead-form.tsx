"use client";

import { useActionState } from "react";
import type { LeadFormState } from "@/app/actions/leads";

type Props = { action: (prev: LeadFormState, formData: FormData) => Promise<LeadFormState>; refSource?: string; accent: string; brandName: string };

/** Public enquiry form: name, phone / email, message. */
export function LeadForm({ action, refSource, accent, brandName }: Props) {
  const [state, formAction, pending] = useActionState<LeadFormState, FormData>(action, undefined);
  if (state?.ok) {
    return (
      <div className="rounded-xl bg-emerald-50 p-6 text-center text-emerald-900" data-testid="lead-sent">
        <p className="text-lg font-semibold">Thank you! 🙏</p>
        <p className="mt-1 text-sm">{brandName} has your message and will get back to you soon.</p>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3" data-testid="lead-form">
      <input type="hidden" name="ref" value={refSource ?? ""} />
      <input name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div>
        <label className="label" htmlFor="name">Your name *</label>
        <input className="input" id="name" name="name" required maxLength={120} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="phone">Phone / WhatsApp</label>
          <input className="input" id="phone" name="phone" inputMode="tel" maxLength={30} placeholder="98765 43210" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" maxLength={160} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="message">How can we help?</label>
        <textarea className="input" id="message" name="message" rows={3} maxLength={2000} />
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-60" style={{ background: accent }} disabled={pending}>
        {pending ? "Sending…" : "Send enquiry"}
      </button>
    </form>
  );
}
