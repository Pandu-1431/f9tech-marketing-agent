import "server-only";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";

export type SessionData = { userId?: number };

function password(): string {
  const p = process.env.SESSION_SECRET;
  if (!p || p.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be at least 32 characters");
    return "dev-only-session-secret-change-me-0123456789";
  }
  return p;
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), {
    password: password(),
    cookieName: "ma_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      // Secure cookies need https. A local production run (Docker on http://localhost) sets APP_URL=http://...
      secure: process.env.NODE_ENV === "production" && !(process.env.APP_URL ?? "").startsWith("http://"),
      maxAge: 60 * 60 * 24 * 14,
    },
  });
}
