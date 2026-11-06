/*
 * Move everything from the laptop's embedded database (./.data/pglite) to a real Postgres
 * (Supabase / DigitalOcean) before going live, so no brand, campaign, post or memory is lost.
 *
 *   1. STOP `npm run dev` first (the embedded database allows one process at a time).
 *   2. TARGET_DATABASE_URL=postgres://... npm run copy:data
 *        SOURCE_DIR=./.data/pglite              which embedded database (default shown)
 *        SOURCE_CHANNEL_SECRET=...              the CHANNEL_SECRET/SESSION_SECRET used on the laptop
 *                                               (empty = the dev key, i.e. none was set)
 *        CHANNEL_SECRET or SESSION_SECRET       the SERVER's secret: channel tokens are re-encrypted with it
 *        --force                                copy even if the target already has users
 *   3. Then copy the files: npm run copy:uploads
 *
 * Tables are created on the target by the normal migrations, copied parent-first (foreign keys),
 * and id counters are moved past the copied rows.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { decryptSecret, encryptSecret, keyFrom } from "../src/lib/secrets";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const force = process.argv.includes("--force");

/** Parent tables before children, from the target's foreign keys. */
export function copyOrder(tables: string[], fks: { child: string; parent: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const fk of fks) if (fk.child === t && fk.parent !== t) visit(fk.parent, stack);
    seen.add(t);
    out.push(t);
  };
  for (const t of [...tables].sort()) visit(t, new Set());
  return out;
}

/** pg sends JS arrays as Postgres arrays; our json columns need JSON text instead. */
export function toParam(v: unknown): unknown {
  if (v === null || v === undefined || v instanceof Date || Buffer.isBuffer(v)) return v ?? null;
  return typeof v === "object" ? JSON.stringify(v) : v;
}

async function main() {
  const target = process.env.TARGET_DATABASE_URL ?? "";
  if (!target.startsWith("postgres")) throw new Error("Set TARGET_DATABASE_URL=postgres://... (the server's database)");
  const sourceDir = process.env.SOURCE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!fs.existsSync(sourceDir)) throw new Error(`No embedded database at ${sourceDir}`);
  const serverSecret = process.env.CHANNEL_SECRET || process.env.SESSION_SECRET || "";
  if (serverSecret.length < 32) throw new Error("Set the SERVER's CHANNEL_SECRET or SESSION_SECRET (32+ chars) so channel tokens can be re-encrypted for it");
  const fromKey = keyFrom(process.env.SOURCE_CHANNEL_SECRET ?? "");
  const toKey = keyFrom(serverSecret);

  console.log(`Source: ${sourceDir}`);
  const src = new PGlite(sourceDir);
  await migratePglite(drizzlePglite(src), { migrationsFolder }); // same schema version on both sides
  const pool = new Pool({ connectionString: target });
  await migratePg(drizzlePg(pool), { migrationsFolder });

  const { rows: users } = await pool.query("SELECT count(*)::int AS n FROM users");
  if (users[0].n > 0 && !force) throw new Error(`Target already has ${users[0].n} user(s). Use --force only if you are sure (rows with the same id will fail).`);

  const { rows: tableRows } = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const { rows: fkRows } = await pool.query<{ child: string; parent: string }>(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );
  const order = copyOrder(tableRows.map((r) => r.table_name), fkRows);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of order) {
      const { rows } = await src.query<Record<string, unknown>>(`SELECT * FROM "${table}"`);
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      for (const row of rows) {
        if (table === "channels" && typeof row.secret === "string") row.secret = encryptSecret(decryptSecret(row.secret, fromKey), toKey);
        const values = cols.map((c) => toParam(row[c]));
        const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
        await client.query(sql, values);
      }
      if (cols.includes("id")) {
        await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), (SELECT coalesce(max(id), 1) FROM "${table}"))`);
      }
      console.log(`  ${table}: ${rows.length}`);
    }
    await client.query("COMMIT");
    console.log("\nDone. Next: npm run copy:uploads (files), then start the server.");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof Error && /Unsupported state or unable to authenticate data/.test(err.message)) {
      throw new Error("Could not read a channel token: set SOURCE_CHANNEL_SECRET to the secret the laptop used (or reconnect channels after the move).");
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
    await src.close();
  }
}

if (process.argv[1] && /copy-data/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : err}\n  Nothing was written (the copy runs in one transaction).`);
    process.exit(1);
  });
}
