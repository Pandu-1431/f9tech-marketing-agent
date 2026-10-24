import { testConnectionAction } from "@/app/actions/settings";
import { requireEditor } from "@/lib/auth";
import { connectionRows, systemChecks, type ConnectionRow } from "@/lib/connections";

const TASKS: Record<string, { title: string; what: string }> = {
  text: { title: "Text AI", what: "Plans campaigns, writes captions, hashtags, SEO keywords and reel scripts." },
  image: { title: "Image AI", what: "Makes poster backgrounds and reel scene photos." },
  voice: { title: "Voice AI", what: "Reads reel scripts aloud as the voiceover." },
};

export default async function AiConnectionsPage({ searchParams }: { searchParams: Promise<{ t?: string; ok?: string; msg?: string; ms?: string }> }) {
  await requireEditor();
  const [rows, sys, q] = await Promise.all([connectionRows(), systemChecks(), searchParams]);
  const byTask = (t: string) => rows.filter((r) => r.task === t);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI connections</h1>
        <p className="text-sm text-zinc-500">
          The agent tries each provider from top to bottom and moves to the next one if a provider fails or reaches its free daily limit.
          Keys are kept on the server in <code>.env.local</code>, never in the browser.
        </p>
      </div>

      {q.t && (
        <div className={`rounded-lg px-4 py-3 text-sm ${q.ok === "1" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          <b>{q.ok === "1" ? "Connected" : "Test failed"}</b> — {q.t}: {q.msg} {q.ms && q.ms !== "0" ? `(${(Number(q.ms) / 1000).toFixed(1)} s)` : ""}
        </div>
      )}

      {Object.entries(TASKS).map(([task, info]) => (
        <section key={task} className="card space-y-3">
          <div>
            <h2 className="font-semibold">{info.title}</h2>
            <p className="text-sm text-zinc-500">{info.what}</p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1">#</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Used today</th>
                <th>How to connect</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {byTask(task).map((r: ConnectionRow) => (
                <tr key={r.name} className="align-top">
                  <td className="py-2 text-zinc-400">{r.order + 1}</td>
                  <td className="py-2">
                    <b>{r.label}</b>
                    <div className="text-xs text-zinc-500">{r.free}{r.model ? ` · ${r.model}` : ""}</div>
                  </td>
                  <td className="py-2">
                    {r.configured ? (
                      <span className="badge bg-emerald-50 text-emerald-700">Ready</span>
                    ) : (
                      <span className="badge bg-amber-50 text-amber-700">Key missing</span>
                    )}
                  </td>
                  <td className="py-2 text-zinc-600">
                    {r.usedToday}
                    {r.dailyLimit < 100000 ? ` / ${r.dailyLimit}` : ""}
                  </td>
                  <td className="py-2 text-xs text-zinc-600">
                    {r.env.length ? <code>{r.env.join(", ")}</code> : "Nothing to set"}
                    {r.url && (
                      <>
                        {" · "}
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-600">
                          get key
                        </a>
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <form action={testConnectionAction.bind(null, r.task, r.name)}>
                      <button className="btn-secondary px-3 py-1">Test</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="card text-sm">
        <h2 className="mb-2 font-semibold">System</h2>
        <ul className="space-y-1 text-zinc-700">
          <li>Database: <b>{sys.db}</b></li>
          <li>File storage: <b>{sys.storage}</b></li>
          <li>Video engine: <b>{sys.ffmpeg}</b></li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">
          To change the order or add a provider, edit <code>AGENT_TEXT_CHAIN</code>, <code>AGENT_IMAGE_CHAIN</code> or <code>AGENT_VOICE_CHAIN</code> in
          <code> .env.local</code> and restart the app.
        </p>
      </section>
    </div>
  );
}
