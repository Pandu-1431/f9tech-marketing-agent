"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { DeleteState } from "@/app/actions/brands";
import { sameName } from "@/lib/names";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-emerald-700" : "text-zinc-500"}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${ok ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-500"}`}>{ok ? "✓" : "•"}</span>
      {children}
    </li>
  );
}

/** The last step: name, password, tick. A live checklist shows what is still missing. */
export function DeleteBrandForm({ name, backHref, action }: { name: string; backHref: string; action: (prev: DeleteState, formData: FormData) => Promise<DeleteState> }) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(action, undefined);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [understand, setUnderstand] = useState(false);
  const nameOk = sameName(typed, name);
  const ready = nameOk && password.length > 0 && understand;
  return (
    <form action={formAction} className="space-y-4" data-testid="delete-brand-form">
      <h2 className="font-semibold">Confirm the delete</h2>
      <div>
        <label className="label" htmlFor="confirmName">
          1. Type the business name: <b className="select-all font-mono text-zinc-900">{name}</b>
        </label>
        <input className={`input ${typed && !nameOk ? "border-amber-400" : ""}`} id="confirmName" name="confirmName" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
        {typed && !nameOk && <p className="mt-1 text-xs text-amber-700">Not the same yet. Capital letters don&apos;t matter, the words do.</p>}
      </div>
      <div>
        <label className="label" htmlFor="password">2. Your account password (the one you log in with)</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="understand" className="mt-1 h-4 w-4" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
        <span>3. I understand that this business account, its posts, images, videos, leads and articles are deleted for good and cannot be brought back.</span>
      </label>

      <ul className="space-y-1 rounded-lg bg-zinc-50 p-3 text-sm" aria-live="polite">
        <Check ok={nameOk}>Name typed</Check>
        <Check ok={password.length > 0}>Password entered</Check>
        <Check ok={understand}>Box ticked</Check>
      </ul>

      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Link href={backHref} className="btn-secondary flex-1 text-center">Cancel, keep it</Link>
        <button className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!ready || pending} title={ready ? "" : "Finish the 3 steps above"}>
          {pending ? "Deleting… please wait" : "Delete for good"}
        </button>
      </div>
      {!ready && <p className="text-center text-xs text-zinc-500">The red button turns on when all 3 steps are done.</p>}
    </form>
  );
}
