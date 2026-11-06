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

/**
 * The web app and the worker start together and both run migrations: a Postgres advisory lock
 * makes them take turns (the second finds nothing left to do) instead of failing on
 * "column already exists".
 */
async function migrateLocked(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(72716401)");
    try {
      await migratePg(drizzlePg(client), { migrationsFolder });
    } finally {
      await client.query("SELECT pg_advisory_unlock(72716401)");
    }
  } finally {
    client.release();
  }
}

function create(): Holder {
  const url = process.env.DATABASE_URL ?? "";

  if (url.startsWith("postgres")) {
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      ready: migrateLocked(pool),
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
  const holder = g.__agentDb;
  try {
    await holder.ready;
  } catch (err) {
    // Never keep a failed start (database restarting, network blip): the next call tries again.
    if (g.__agentDb === holder) g.__agentDb = undefined;
    await holder.close?.().catch(() => {});
    throw err;
  }
  return holder.db!;
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
