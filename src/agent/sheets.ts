import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decryptSecret } from "@/lib/secrets";
import { trackerRows, trackerTable } from "@/lib/tracker";
import { accessToken } from "./publish/youtube";
import { PublishConfigError, readJson } from "./publish/types";

/*
 * Google Sheet sync (Layer 5): each business account can keep its post tracker in a Google
 * Sheet the team already uses. "Connect Google Sheet" (Sign in with Google, scope drive.file =
 * only files this app creates) makes a new spreadsheet; the app then rewrites its "Posts" tab
 * once a day after the Analyst reads results, and whenever someone clicks "Sync now".
 * Stored as a channel row with platform "google_sheets" (refresh token encrypted).
 */
export const SHEETS_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
export const SHEETS_PLATFORM = "google_sheets";
const TAB = "Posts";
const API = () => (process.env.SHEETS_API_URL ?? "https://sheets.googleapis.com").replace(/\/$/, "");

async function call(method: "GET" | "POST" | "PUT", path: string, token: string, body?: unknown) {
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await readJson(res);
  if (!res.ok) {
    const msg = `Google Sheets: ${String((json.error as { message?: string })?.message ?? res.status)}`;
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new PublishConfigError(msg);
    throw new Error(msg);
  }
  return json;
}

/** Make the tracker spreadsheet (called right after sign-in). */
export async function createTrackerSheet(token: string, brandName: string): Promise<{ spreadsheetId: string; url: string; title: string }> {
  const title = `${brandName} — post tracker`;
  const out = await call("POST", "/v4/spreadsheets", token, {
    properties: { title },
    sheets: [{ properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } }],
  });
  const id = String(out.spreadsheetId ?? "");
  if (!id) throw new Error("Google Sheets: no spreadsheet id returned");
  return { spreadsheetId: id, url: String(out.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}`), title };
}

async function sheetChannel(workspaceId: number, brandId: number) {
  const db = await getDb();
  const [c] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.brandId, brandId), eq(schema.channels.platform, SHEETS_PLATFORM)));
  return c ?? null;
}

export async function hasSheet(workspaceId: number, brandId: number): Promise<boolean> {
  return (await sheetChannel(workspaceId, brandId)) !== null;
}

/** Rewrite the "Posts" tab with the brand's tracker rows. Returns the number of posts written. */
export async function syncBrandSheet(workspaceId: number, brandId: number): Promise<number> {
  const channel = await sheetChannel(workspaceId, brandId);
  if (!channel) return 0;
  const db = await getDb();
  try {
    const token = await accessToken(decryptSecret(channel.secret));
    const id = encodeURIComponent(channel.config.spreadsheetId);
    const rows = await trackerRows(workspaceId, { brandId });
    const range = encodeURIComponent(`${TAB}!A:Z`);
    await call("POST", `/v4/spreadsheets/${id}/values/${range}:clear`, token, {});
    // RAW: values are stored as typed, so a caption starting with "=" is never run as a formula.
    await call("PUT", `/v4/spreadsheets/${id}/values/${encodeURIComponent(`${TAB}!A1`)}?valueInputOption=RAW`, token, { values: trackerTable(rows) });
    await db.update(schema.channels).set({ lastError: null }).where(eq(schema.channels.id, channel.id));
    return rows.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(schema.channels).set({ lastError: message.slice(0, 500) }).where(eq(schema.channels.id, channel.id));
    if (err instanceof PublishConfigError) return 0; // needs a reconnect; retrying will not help
    throw err;
  }
}
