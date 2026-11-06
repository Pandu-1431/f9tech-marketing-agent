"use client";

import { useActionState } from "react";
import { addLeadAction, type LeadFormState } from "@/app/actions/leads";

/** Add a lead by hand: a call, a DM, a walk-in. */
export function AddLeadForm({ brands }: { brands: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(addLeadAction, undefined);
  return (
    <details className="card">
      <summary className="cursor-pointer font-medium">+ Add a lead by hand</summary>
      <form action={action} className="mt-3 grid gap-3 md:grid-cols-3" data-testid="add-lead">
        <select className="input" name="brandId" required defaultValue={brands[0]?.id}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="input" name="name" placeholder="Name *" required />
        <input className="input" name="phone" placeholder="Phone / WhatsApp" />
        <input className="input" name="email" placeholder="Email" type="email" />
        <select className="input" name="source" defaultValue="manual">
          {["manual", "phone call", "instagram DM", "facebook message", "whatsapp", "walk-in", "referral"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className="input" name="message" placeholder="What they asked about" />
        <div className="flex items-center gap-3 md:col-span-3">
          <button className="btn" disabled={pending}>Add lead</button>
          {state?.error && <span className="text-sm text-red-700">{state.error}</span>}
          {state?.ok && <span className="text-sm text-emerald-700">Added.</span>}
        </div>
      </form>
    </details>
  );
}
