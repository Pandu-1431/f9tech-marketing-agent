import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export default async function Home() {
  if (await getAuth()) redirect("/dashboard");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-4">
        <p className="text-sm font-medium text-indigo-600">AI marketing agent</p>
        <h1 className="text-4xl font-bold tracking-tight">
          One agent for your whole digital marketing — on brand, every time.
        </h1>
        <p className="max-w-2xl text-lg text-zinc-600">
          Set up your Brand Kit once. Type a theme. The agent plans the calendar, writes captions, hashtags and
          SEO keywords for every platform, and keeps everything in one place for review.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/register" className="btn">Start free</Link>
        <Link href="/login" className="btn-secondary">Log in</Link>
      </div>
      <ul className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-3">
        <li className="card"><b>Brand Kit</b><br />Tone, audience, colours and rules applied to every post.</li>
        <li className="card"><b>Campaign planner</b><br />Theme in, full content calendar out.</li>
        <li className="card"><b>SEO + SMO built in</b><br />Keywords, hashtags and platform-specific copy.</li>
      </ul>
    </main>
  );
}
