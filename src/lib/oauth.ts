import crypto from "node:crypto";
import { YOUTUBE_SCOPES } from "@/agent/publish/youtube";
import { GBP_SCOPES } from "@/agent/publish/google-business";
import { SHEETS_SCOPES } from "@/agent/sheets";

/** What a "Sign in with Google" round trip connects. Also the query key the brand page reads the result from. */
export type GoogleService = "youtube" | "gbp" | "sheets";
export const SERVICE_SCOPES: Record<GoogleService, string[]> = { youtube: YOUTUBE_SCOPES, gbp: GBP_SCOPES, sheets: SHEETS_SCOPES };
export const googleService = (v: string | null | undefined): GoogleService => (v === "gbp" || v === "sheets" ? v : "youtube");
export const OAUTH_SERVICE_COOKIE = "ma_oauth_svc";

/** Where Google sends the user back: APP_URL in production, else the address the app was opened at. */
export function googleRedirectUri(requestUrl: string): string {
  const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : new URL(requestUrl).origin.replace("//0.0.0.0", "//localhost");
  return `${base}/api/oauth/google/callback`;
}

export const OAUTH_COOKIE = "ma_oauth";

/** Random state for the OAuth round trip; the cookie holds "<state>.<brandId>". */
export function newOAuthState(brandId: number): { state: string; cookie: string } {
  const state = crypto.randomBytes(24).toString("base64url");
  return { state, cookie: `${state}.${brandId}` };
}

/** Checks the state Google echoed back against our cookie; returns the brand id or null. */
export function checkOAuthState(cookie: string | undefined, state: string | null): number | null {
  if (!cookie || !state) return null;
  const [expected, brand] = cookie.split(".");
  if (!expected || expected.length !== state.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(state))) return null;
  const id = Number(brand);
  return Number.isInteger(id) && id > 0 ? id : null;
}
