"use client";

import { useActionState, useState } from "react";
import { createInviteAction, type InviteState } from "@/app/actions/team";

export function InviteForm({ days }: { days: number }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInviteAction, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2" onSubmit={() => setCopied(false)}>
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="label">Who is it for? (optional)</label>
          <input className="input" id="label" name="label" maxLength={120} placeholder="e.g. Ravi from Sunrise Hotels" />
        </div>
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select className="input" id="role" name="role" defaultValue="client">
            <option value="client">Client reviewer: view, approve, reject</option>
            <option value="editor">Editor: create and edit content</option>
          </select>
        </div>
        <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create invite link"}</button>
      </form>
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.link && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="mb-2 text-emerald-800">
            Invite link{state.label ? ` for ${state.label}` : ""}. Send it on WhatsApp or email. It works once and expires in {days} days.
            This is the only time the link is shown.
          </p>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly value={state.link} data-testid="invite-link" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.link!);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
