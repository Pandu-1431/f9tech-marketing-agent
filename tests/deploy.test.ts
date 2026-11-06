import { beforeEach, describe, expect, it } from "vitest";
import { checkProductionEnv } from "@/lib/prod-check";
import { decryptSecret, encryptSecret, keyFrom } from "@/lib/secrets";
import { copyOrder, toParam } from "../scripts/copy-data";
import { GET as health } from "@/app/api/health/route";
import { getDb, schema } from "@/db";
import { freshDb } from "./helpers";

const good = {
  SESSION_SECRET: "k3Jd9sLq0Zp2Wm8Xv5Bn7Cr4Ty6Uh1Ae0Fg",
  APP_URL: "https://agent.f9tech.com",
  DATABASE_URL: "postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
  AGENT_INLINE_JOBS: "false",
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://ref.supabase.co/storage/v1/s3",
  S3_BUCKET: "media",
  S3_ACCESS_KEY_ID: "a",
  S3_SECRET_ACCESS_KEY: "b",
  S3_PUBLIC_URL: "https://ref.supabase.co/storage/v1/object/public/media",
  AGENT_TEXT_CHAIN: "gemini,groq",
  GEMINI_API_KEY: "g",
  GROQ_API_KEY: "q",
  AGENT_IMAGE_CHAIN: "cloudflare,fake",
  CLOUDFLARE_API_TOKEN: "t",
  CLOUDFLARE_ACCOUNT_ID: "a",
};

describe("production check", () => {
  it("passes a complete server config", () => {
    const r = checkProductionEnv(good);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => /Google client/.test(w))).toBe(true);
  });

  it("catches what breaks a live server", () => {
    const r = checkProductionEnv({ ...good, SESSION_SECRET: "short", APP_URL: "http://x.com", DATABASE_URL: "", AGENT_INLINE_JOBS: "true", STORAGE_DRIVER: "local", AGENT_TEXT_CHAIN: "fake" });
    expect(r.errors.join("\n")).toMatch(/SESSION_SECRET/);
    expect(r.errors.join("\n")).toMatch(/https/);
    expect(r.errors.join("\n")).toMatch(/real Postgres/);
    expect(r.errors.join("\n")).toMatch(/AGENT_INLINE_JOBS/);
    expect(r.errors.join("\n")).toMatch(/STORAGE_DRIVER must be s3/);
    expect(r.errors.join("\n")).toMatch(/fake/);
  });

  it("flags placeholders, the transaction pooler and a single AI", () => {
    const r = checkProductionEnv({ ...good, S3_PUBLIC_URL: "https://<project-ref>.supabase.co", DATABASE_URL: "postgres://u:p@h:6543/postgres", GROQ_API_KEY: "" });
    expect(r.errors.join("\n")).toMatch(/S3 storage is missing: S3_PUBLIC_URL/);
    expect(r.warnings.join("\n")).toMatch(/6543/);
    expect(r.warnings.join("\n")).toMatch(/Only one text AI/);
  });
});

describe("moving data to the server", () => {
  it("copies parent tables before children", () => {
    const order = copyOrder(["posts", "brands", "workspaces", "users", "jobs"], [
      { child: "posts", parent: "brands" },
      { child: "brands", parent: "workspaces" },
      { child: "workspaces", parent: "users" },
    ]);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("workspaces"));
    expect(order.indexOf("workspaces")).toBeLessThan(order.indexOf("brands"));
    expect(order.indexOf("brands")).toBeLessThan(order.indexOf("posts"));
    expect(order).toHaveLength(5);
  });

  it("sends json columns as JSON text (pg would turn arrays into Postgres arrays)", () => {
    expect(toParam(["#a", "#b"])).toBe('["#a","#b"]');
    expect(toParam({ a: 1 })).toBe('{"a":1}');
    const d = new Date();
    expect(toParam(d)).toBe(d);
    expect(toParam(null)).toBeNull();
    expect(toParam(3)).toBe(3);
  });

  it("re-encrypts a channel token from the laptop key to the server key", () => {
    const laptop = keyFrom(""); // no secret set = dev key
    const server = keyFrom("server-secret-server-secret-server-secret");
    const moved = encryptSecret(decryptSecret(encryptSecret("BOT:TOKEN", laptop), laptop), server);
    expect(decryptSecret(moved, server)).toBe("BOT:TOKEN");
    expect(() => decryptSecret(moved, laptop)).toThrow();
  });
});

describe("health check", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("is healthy with an empty queue, 503 when a job waits too long", async () => {
    const ok = await health();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, db: "up", queue: { waiting: 0 } });

    const db = await getDb();
    await db.insert(schema.jobs).values({ type: "campaign.plan", payload: {}, runAfter: new Date(Date.now() - 20 * 60_000) });
    const stuck = await health();
    expect(stuck.status).toBe(503);
    expect((await stuck.json()).queue.waiting).toBe(1);
  });
});
