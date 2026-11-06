"use client";

import { useActionState, useState } from "react";
import type { DeleteState } from "@/app/actions/brands";

/** The last step: type the name, enter the password, tick the box. The button wakes up only then. */
export function DeleteBrandForm({ name, action }: { name: string; action: (prev: DeleteState, formData: FormData) => Promise<DeleteState> }) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(action, undefined);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [understand, setUnderstand] = useState(false);
  const ready = typed.trim() === name.trim() && password.length > 0 && understand;
  return (
    <form action={formAction} className="space-y-4" data-testid="delete-brand-form">
      <div>
        <label className="label" htmlFor="confirmName">
          Type <b className="select-all font-mono">{name}</b> to confirm
        </label>
        <input className="input" id="confirmName" name="confirmName" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Your account password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="understand" className="mt-1" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
        <span>I understand that this business account, its posts, images, videos, leads and articles are deleted for good and cannot be brought back.</span>
      </label>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!ready || pending}>
        {pending ? "Deleting…" : `Delete ${name} for good`}
      </button>
    </form>
  );
}
