"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/actions/team";

export function JoinButton({ token, label }: { token: string; label: string }) {
  const [state, action, pending] = useActionState(async () => acceptInviteAction(token), undefined);
  return (
    <form action={action} className="space-y-2">
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Please wait…" : label}</button>
    </form>
  );
}
