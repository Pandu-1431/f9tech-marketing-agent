import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { inbox } from "@/agent/community";
import { checkCommentsNowAction, sendReplyAction, skipCommentAction } from "@/app/actions/community";
import { PLATFORM_LABELS } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const INTENT: Record<string, string> = {
  question: "bg-sky-100 text-sky-800",
  praise: "bg-emerald-100 text-emerald-800",
  complaint: "bg-red-100 text-red-800",
  spam: "bg-zinc-200 text-zinc-600",
  other: "bg-zinc-100 text-zinc-700",
};
const TABS = [
  { key: "todo", label: "To answer" },
  { key: "sent", label: "Replied" },
  { key: "skipped", label: "Skipped" },
];

/** Community manager inbox: comments on your posts with a ready reply. Send, edit or skip. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { workspace, role } = await requireAuth();
  const asked = (await searchParams).tab;
  const tab = TABS.some((t) => t.key === asked) ? asked! : "todo";
  const rows = await inbox(workspace.id, { status: tab });
  const canEdit = canEditContent(role);

  return (
    <div className="space-y-6" data-testid="inbox">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-zinc-600">
            Comments on your Facebook and Instagram posts, read every 30 minutes. The AI drafts a reply in your brand&apos;s voice; send it as is,
            edit it, or skip. Spam is skipped for you.
          </p>
        </div>
        {canEdit && (
          <form action={checkCommentsNowAction}>
            <button className="btn-secondary">Check now</button>
          </form>
        )}
      </div>
      <nav className="flex gap-1.5">
        {TABS.map((t) => (
          <Link key={t.key} href={`/inbox?tab=${t.key}`} className={`badge border ${tab === t.key ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600"}`}>{t.label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <div className="card text-center text-sm text-zinc-600">
          {tab === "todo" ? "No comments waiting. New comments on published Facebook and Instagram posts show up here." : "Nothing here yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ c, brandName, url, headline }) => (
            <article key={c.id} className="card space-y-2" data-testid="comment">
              <header className="flex flex-wrap items-center gap-2 text-sm">
                {c.intent && <span className={`badge ${INTENT[c.intent] ?? ""}`}>{c.intent}</span>}
                <b>{c.author}</b>
                <span className="text-zinc-500">on {PLATFORM_LABELS[c.platform] ?? c.platform} · {brandName}{headline ? ` · “${headline}”` : ""}</span>
                {url && <a href={url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-indigo-700 underline">Open post</a>}
              </header>
              <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">{c.text}</p>
              {c.status === "new" && <p className="text-xs text-zinc-500">Drafting a reply…</p>}
              {c.status === "sent" && <p className="text-sm text-emerald-800">↳ {c.reply}</p>}
              {c.status === "failed" && <p className="text-xs text-red-700">Could not send: {c.error}</p>}
              {canEdit && (c.status === "drafted" || c.status === "failed") && (
                <div className="flex flex-wrap items-start gap-2">
                  <form action={sendReplyAction.bind(null, c.id)} className="flex min-w-[280px] flex-1 gap-2">
                    <textarea name="reply" defaultValue={c.reply ?? ""} rows={2} className="input flex-1" />
                    <button className="btn shrink-0">Send</button>
                  </form>
                  <form action={skipCommentAction.bind(null, c.id)}>
                    <button className="btn-secondary">Skip</button>
                  </form>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
