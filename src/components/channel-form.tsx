"use client";

import { useActionState } from "react";
import type { ChannelFormState } from "@/app/actions/publishing";

type Field = { name: string; label: string; placeholder: string; secret?: boolean };

/** One "connect a channel" form; shows the result of the live test. */
export function ChannelForm({
  title,
  help,
  fields,
  action,
}: {
  title: string;
  help: React.ReactNode;
  fields: Field[];
  action: (prev: ChannelFormState, formData: FormData) => Promise<ChannelFormState>;
}) {
  const [state, formAction, pending] = useActionState<ChannelFormState, FormData>(action, undefined);
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-zinc-200 p-3">
      <p className="font-medium">{title}</p>
      <div className="text-xs text-zinc-600">{help}</div>
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={`${title}-${f.name}`}>{f.label}</label>
          <input className="input" id={`${title}-${f.name}`} name={f.name} type={f.secret ? "password" : "text"} placeholder={f.placeholder} autoComplete="off" />
        </div>
      ))}
      <button className="btn-secondary" disabled={pending}>{pending ? "Testing…" : "Test and connect"}</button>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700">{state.ok}</p>}
    </form>
  );
}
