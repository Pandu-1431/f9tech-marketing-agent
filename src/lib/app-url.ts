/*
 * The address people open the app at. Inside Docker (or behind nginx) the request URL can say
 * http://0.0.0.0:3000, which is a different site to the browser (no login cookie there), so
 * redirects use APP_URL, else the Host header the browser sent, else the request URL.
 */
export function appOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && !/^0\.0\.0\.0(:|$)/.test(host)) {
    const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

/** An absolute address inside the app, for redirects from route handlers. */
export const appUrl = (path: string, req: Request) => new URL(path, `${appOrigin(req)}/`);
