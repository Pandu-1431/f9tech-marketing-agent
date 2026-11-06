import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "./secrets";

/*
 * Between "logged in with Facebook" (or "pasted a token") and "picked a Page", the token waits in a
 * short-lived, encrypted, httpOnly cookie, tied to one business. It never reaches the browser's JS.
 */
export const META_PICK_COOKIE = "ma_meta_pick";

export function pickCookieValue(brandId: number, token: string): string {
  return encryptSecret(JSON.stringify({ brandId, token, at: Date.now() }));
}

export async function readPick(brandId: number): Promise<string | null> {
  const raw = (await cookies()).get(META_PICK_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(decryptSecret(raw)) as { brandId: number; token: string; at: number };
    if (v.brandId !== brandId || Date.now() - v.at > 20 * 60_000) return null;
    return v.token;
  } catch {
    return null;
  }
}

export const pickCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" && !(process.env.APP_URL ?? "").startsWith("http://"), maxAge: 20 * 60, path: "/" };
