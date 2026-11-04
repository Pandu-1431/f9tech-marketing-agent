"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reschedulePostAction } from "@/app/actions/campaigns";

export type CalendarPost = {
  id: number;
  campaignId: number;
  date: string; // local publish date
  time: string; // local HH:MM
  timeLabel: string; // "7:00 pm IST"
  platform: string;
  platformLabel: string;
  format: string;
  status: string;
  ready: boolean; // approved and unchanged since: ready to publish
  brandName: string;
  campaignTheme: string;
  snippet: string;
  posterUrl: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  idea: "border-zinc-200 bg-zinc-50 text-zinc-600",
  drafted: "border-sky-200 bg-sky-50 text-sky-800",
  approved: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
  published: "border-indigo-200 bg-indigo-50 text-indigo-800",
};
const STATUS_LABEL: Record<string, string> = {
  idea: "Writing",
  drafted: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthCalendar({
  month,
  weeks,
  today,
  posts,
  canEdit,
}: {
  month: string;
  weeks: string[][];
  today: string;
  posts: CalendarPost[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [shown, moveOptimistic] = useOptimistic(posts, (state, move: { id: number; date: string; time?: string }) =>
    state.map((p) => (p.id === move.id ? { ...p, date: move.date, time: move.time ?? p.time } : p)),
  );

  const byDay = new Map<string, CalendarPost[]>();
  for (const p of shown) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  for (const list of byDay.values()) list.sort((a, b) => a.time.localeCompare(b.time));
  const selected = shown.find((p) => p.id === selectedId) ?? null;

  function move(id: number, date: string, time?: string) {
    const post = shown.find((p) => p.id === id);
    if (!post || (post.date === date && (time === undefined || time === post.time))) return;
    setError(null);
    startTransition(async () => {
      moveOptimistic({ id, date, time });
      const res = await reschedulePostAction(id, date, time);
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {Object.entries(STATUS_LABEL).map(([k, label]) => (
          <span key={k} className={`rounded border px-1.5 py-0.5 ${STATUS_STYLE[k]}`}>{label}</span>
        ))}
        <span className="rounded border border-emerald-500 bg-emerald-600 px-1.5 py-0.5 font-medium text-white">Ready to publish</span>
        {canEdit && <span className="text-zinc-500">Drag a post to another day to move it. Click a post to change the time.</span>}
        {pending && <span className="text-zinc-500">Saving…</span>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 text-sm" style={{ gap: 1 }}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-500">{d}</div>
          ))}
          {weeks.flat().map((day) => {
            const inMonth = day.startsWith(month);
            const list = byDay.get(day) ?? [];
            return (
              <div
                key={day}
                data-day={day}
                data-testid={`day-${day}`}
                className={`min-h-28 space-y-1 p-1.5 ${inMonth ? "bg-white" : "bg-zinc-50"} ${overDay === day ? "ring-2 ring-inset ring-indigo-400" : ""}`}
                onDragOver={(e) => {
                  if (!canEdit || dragId === null) return;
                  e.preventDefault();
                  if (overDay !== day) setOverDay(day);
                }}
                onDragLeave={() => setOverDay((d) => (d === day ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverDay(null);
                  const id = Number(e.dataTransfer.getData("text/plain") || dragId);
                  setDragId(null);
                  if (id) move(id, day);
                }}
              >
                <p className={`text-xs ${day === today ? "inline-block rounded-full bg-indigo-600 px-1.5 font-semibold text-white" : inMonth ? "text-zinc-700" : "text-zinc-400"}`}>
                  {Number(day.slice(8))}
                </p>
                {list.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`cal-post-${p.id}`}
                    draggable={canEdit && p.status !== "published"}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(p.id));
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(p.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                    title={`${p.brandName} · ${p.campaignTheme}`}
                    className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-xs ${
                      p.ready ? "border-emerald-500 bg-emerald-600 text-white" : STATUS_STYLE[p.status] ?? STATUS_STYLE.idea
                    } ${selectedId === p.id ? "ring-2 ring-indigo-500" : ""} ${canEdit ? "cursor-grab" : "cursor-pointer"}`}
                  >
                    <span className="font-medium">{p.time}</span> {p.platformLabel} · {p.brandName}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {selected && <PostPanel key={`${selected.id}-${selected.date}-${selected.time}`} post={selected} canEdit={canEdit} onMove={move} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function PostPanel({
  post,
  canEdit,
  onMove,
  onClose,
}: {
  post: CalendarPost;
  canEdit: boolean;
  onMove: (id: number, date: string, time?: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(post.date);
  const [time, setTime] = useState(post.time);
  return (
    <div className="card flex flex-wrap gap-4" data-testid="cal-panel">
      {post.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.posterUrl} alt="" className="h-28 w-28 rounded border border-zinc-200 object-cover" />
      )}
      <div className="min-w-60 flex-1 space-y-1 text-sm">
        <p className="text-zinc-500">
          {post.brandName} · {post.campaignTheme}
        </p>
        <p className="font-medium">
          {post.platformLabel} · {post.format} · {post.ready ? "Ready to publish" : STATUS_LABEL[post.status] ?? post.status}
        </p>
        <p className="text-zinc-600">{post.date} at {post.timeLabel}</p>
        {post.snippet && <p className="line-clamp-3 text-zinc-700">{post.snippet}</p>}
        <Link href={`/campaigns/${post.campaignId}`} className="text-indigo-600 hover:underline">Open in campaign</Link>
      </div>
      {canEdit && post.status !== "published" && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onMove(post.id, date, time);
          }}
        >
          <div>
            <label className="label" htmlFor="cal-date">Date</label>
            <input className="input" id="cal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="cal-time">Time</label>
            <input className="input" id="cal-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <button className="btn">Move</button>
        </form>
      )}
      <button type="button" className="self-start text-sm text-zinc-500 hover:text-zinc-900" onClick={onClose} aria-label="Close">
        Close
      </button>
    </div>
  );
}
