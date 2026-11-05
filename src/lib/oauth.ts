import crypto from "node:crypto";

/** Where Google sends the user back: APP_URL in production, else the address the app was opened at. */
export function googleRedirectUri(requestUrl: string): string {
  const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : new URL(requestUrl).origin;
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
