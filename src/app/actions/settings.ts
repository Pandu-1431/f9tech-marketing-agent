"use server";

import { redirect } from "next/navigation";
import { requireEditor } from "@/lib/auth";
import { testConnection, type Task } from "@/lib/connections";

export async function testConnectionAction(task: Task, name: string) {
  await requireEditor();
  const r = await testConnection(task, name);
  const q = new URLSearchParams({ t: `${task}:${name}`, ok: r.ok ? "1" : "0", msg: r.message, ms: String(r.ms) });
  redirect(`/settings/ai?${q.toString()}`);
}
