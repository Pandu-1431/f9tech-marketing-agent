import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db";
import { appOrigin, appUrl } from "@/lib/app-url";
import { freshDb } from "./helpers";

describe("app address for redirects", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never sends people to 0.0.0.0 (Docker's listen address)", () => {
    vi.stubEnv("APP_URL", "");
    const docker = new Request("http://0.0.0.0:3000/api/oauth/meta/start", { headers: { host: "localhost:3000" } });
    expect(appUrl("/brands/5?meta=x#channels", docker).toString()).toBe("http://localhost:3000/brands/5?meta=x#channels");
    const proxied = new Request("http://127.0.0.1:3000/x", { headers: { host: "127.0.0.1:3000", "x-forwarded-host": "agent.f9tech.com", "x-forwarded-proto": "https" } });
    expect(appOrigin(proxied)).toBe("https://agent.f9tech.com");
    vi.stubEnv("APP_URL", "https://agent.example.com/");
    expect(appUrl("/brands", docker).toString()).toBe("https://agent.example.com/brands");
  });
});

describe("job order", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("runs quick text work before slow posters and reels", async () => {
    const db = await getDb();
    await db.insert(schema.jobs).values([
      { type: "post.reel", payload: { n: 1 } },
      { type: "post.design", payload: { n: 2 } },
      { type: "article.write", payload: { n: 3 } },
      { type: "campaign.write", payload: { n: 4 } },
    ]);
    const { sql } = await import("drizzle-orm");
    // Same ORDER BY the worker uses to claim the next job.
    const r = (await db.execute(sql`SELECT type FROM jobs WHERE status = 'queued' ORDER BY CASE WHEN type IN ('post.design', 'campaign.design') THEN 1 WHEN type = 'post.reel' THEN 2 ELSE 0 END, id`)) as unknown as { rows: { type: string }[] };
    expect(r.rows.map((x) => x.type)).toEqual(["article.write", "campaign.write", "post.design", "post.reel"]);
    const src = (await import("node:fs")).readFileSync("src/jobs/queue.ts", "utf8");
    expect(src).toContain("WHEN type IN ('post.design', 'campaign.design') THEN 1");
    expect(src).toContain("WHEN type = 'post.reel' THEN 2");
  });
});
