"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, registerAction, type FormState } from "@/app/actions/auth";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  return (
    <form action={formAction} className="card w-full max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{mode === "login" ? "Log in" : "Create your free account"}</h1>
        <p className="text-sm text-zinc-500">
          {mode === "login" ? "Welcome back." : "Free plan: up to 4 business accounts. No card needed."}
        </p>
      </div>

      {mode === "register" && (
        <>
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input className="input" id="name" name="name" required />
          </div>
          <div>
            <label className="label" htmlFor="business">Business or agency name</label>
            <input className="input" id="business" name="business" required />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 8 : undefined}
          required
        />
      </div>

      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <button className="btn w-full" disabled={pending}>
        {pending ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        {mode === "login" ? (
          <>No account? <Link className="text-indigo-600" href="/register">Sign up free</Link></>
        ) : (
          <>Already have an account? <Link className="text-indigo-600" href="/login">Log in</Link></>
        )}
      </p>
    </form>
  );
}
