import dns from "node:dns/promises";
import net from "node:net";

/*
 * Fetch a URL a user typed (their website, a news feed) without letting it reach this server's
 * own network: only http(s), only public IP addresses, redirects re-checked, size and time capped.
 * Tests and local feeds can allow private addresses with SAFE_FETCH_ALLOW_PRIVATE=true.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

export function isPrivateAddress(ip: string): boolean {
  return net.isIPv4(ip) ? privateV4(ip) : net.isIPv6(ip) ? privateV6(ip) : true;
}

/** "example.com" -> "https://example.com/"; rejects anything that is not a public http(s) address. */
export function normaliseUrl(input: string): URL {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:/]+:\d/.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UnsafeUrlError("That does not look like a web address.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UnsafeUrlError("Only http and https addresses are allowed.");
  if (u.username || u.password) throw new UnsafeUrlError("Addresses with a username or password are not allowed.");
  return u;
}

async function assertPublic(u: URL) {
  if (process.env.SAFE_FETCH_ALLOW_PRIVATE === "true") return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new UnsafeUrlError("Local addresses are not allowed.");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UnsafeUrlError(`Could not find ${host}. Check the address.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("Private network addresses are not allowed.");
}

export type SafeResponse = { url: string; status: number; contentType: string; body: Buffer };

/** GET with public-address checks on every hop, max 4 redirects, a size cap and a timeout. */
export async function safeFetch(input: string | URL, opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = typeof input === "string" ? normaliseUrl(input) : input;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; MarketingAgentBot/1.0)", accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = normaliseUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return { url: url.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  }
  throw new UnsafeUrlError("Too many redirects.");
}
