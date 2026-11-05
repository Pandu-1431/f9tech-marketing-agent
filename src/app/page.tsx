import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { LogoMark } from "@/components/ui/logo";
import { AGENTS } from "@/lib/team-status";

export default async function Home() {
  if (await getAuth()) redirect("/dashboard");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-16">
      <header className="flex items-center justify-between py-5">
        <span className="flex items-center gap-2 font-bold">
          <LogoMark /> Marketing<span className="text-grad">Agent</span>
        </span>
        <div className="flex gap-2">
          <Link href="/login" className="btn-secondary">Log in</Link>
          <Link href="/register" className="btn">Start free</Link>
        </div>
      </header>

      <section className="grid items-center gap-10 py-10 lg:grid-cols-2 lg:py-16">
        <div className="space-y-6">
          <p className="reveal d1 inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-white/70 px-3 py-1 text-xs font-semibold text-fuchsia-700">
            <span className="live-dot" /> Open source · runs on free AI
          </p>
          <h1 className="reveal d2 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            A full <span className="text-grad">AI marketing team</span> for your business. You only approve.
          </h1>
          <p className="reveal d3 max-w-xl text-lg text-zinc-600">
            Set up your Brand Kit once. Every week the team picks a theme, writes posts in simple English, designs Indian-style
            posters, makes reels with voice, checks quality and publishes to Instagram, Facebook, YouTube and Telegram.
          </p>
          <div className="reveal d4 flex flex-wrap gap-3">
            <Link href="/register" className="btn px-6 py-3 text-base">Start free</Link>
            <Link href="/login" className="btn-secondary px-6 py-3 text-base">Log in</Link>
          </div>
          <div className="reveal d5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
            <span>✓ Human approval before posting</span>
            <span>✓ No bots, no spam</span>
            <span>✓ Your data stays in your workspace</span>
          </div>
        </div>

        {/* The team orbiting the brand */}
        <div className="reveal d3 relative mx-auto aspect-square w-full max-w-[460px]">
          <div className="absolute inset-[12%] rounded-full border border-dashed border-indigo-300/70" />
          <div className="absolute inset-[26%] rounded-full border border-fuchsia-300/60" />
          <div className="absolute inset-[36%] grid place-items-center rounded-full bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-center text-white shadow-2xl shadow-fuchsia-500/40">
            <div>
              <p className="text-3xl">✨</p>
              <p className="text-xs font-semibold uppercase tracking-widest">Your brand</p>
            </div>
          </div>
          <div className="spin-slow absolute inset-0" style={{ animationDuration: "40s" }}>
            {AGENTS.map((a, i) => {
              const angle = (i / AGENTS.length) * Math.PI * 2;
              const x = 50 + Math.cos(angle) * 38;
              const y = 50 + Math.sin(angle) * 38;
              return (
                <div key={a.key} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                  <div className="spin-slow" style={{ animationDuration: "40s", animationDirection: "reverse" }}>
                    <div className="card card-hover flex items-center gap-2 !p-2 !pr-3">
                      <span className="grid h-8 w-8 place-items-center rounded-lg text-base text-white" style={{ background: a.color }}>{a.emoji}</span>
                      <span className="text-xs font-semibold">{a.name}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((a, i) => (
          <div key={a.key} className={`card card-hover reveal d${i + 1}`}>
            <span className="grid h-10 w-10 place-items-center rounded-xl text-lg text-white" style={{ background: `linear-gradient(135deg, ${a.color}, ${a.color}99)` }}>
              {a.emoji}
            </span>
            <p className="mt-3 font-semibold">{a.name}</p>
            <p className="text-sm text-zinc-600">{a.role}.</p>
          </div>
        ))}
      </section>
    </main>
  );
}
