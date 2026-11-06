import { getAuth } from "@/lib/auth";
import { toCsv, trackerRows, trackerTable } from "@/lib/tracker";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Post tracker as CSV (opens in Excel / Google Sheets). Same filters as the Tracker page. */
export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response("Sign in first", { status: 401 });
  const q = new URL(req.url).searchParams;
  const brandId = Number(q.get("brandId")) || undefined;
  const from = isoDate.test(q.get("from") ?? "") ? q.get("from")! : undefined;
  const to = isoDate.test(q.get("to") ?? "") ? q.get("to")! : undefined;
  const status = q.get("status") || undefined;
  const rows = await trackerRows(auth.workspace.id, { brandId, from, to, status });
  return new Response("﻿" + toCsv(trackerTable(rows)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="post-tracker-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
