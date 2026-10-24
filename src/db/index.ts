import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

/*
 * DATABASE_URL set   -> real Postgres (production / DigitalOcean).
 * DATABASE_URL empty -> embedded Postgres (PGlite) in ./.data, zero setup.
 * DATABASE_URL="memory://" -> in-memory PGlite (tests).
 */

export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

type Holder = { db?: Db; ready?: Promise<void>; close?: () => Promise<void> };
const g = globalThis as unknown as { __agentDb?: Holder };

const migrationsFolder = path.join(process.cwd(), "drizzle");

function create(): Holder {
  const url = process.env.DATABASE_URL ?? "";

  if (url.startsWith("postgres")) {
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      ready: migratePg(drizzlePg(pool), { migrationsFolder }),
      close: () => pool.end(),
    };
  }

  const dataDir = url === "memory://" ? undefined : (url || path.join(process.cwd(), ".data", "pglite"));
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    ready: migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

/** Returns the database, running pending migrations on first use. */
export async function getDb(): Promise<Db> {
  if (!g.__agentDb) g.__agentDb = create();
  await g.__agentDb.ready;
  return g.__agentDb.db!;
}

/** Used by tests to start from a clean database. */
export async function resetDbForTests(): Promise<void> {
  if (g.__agentDb?.close) {
    await g.__agentDb.ready?.catch(() => {});
    await g.__agentDb.close();
  }
  g.__agentDb = undefined;
}

export { schema };
