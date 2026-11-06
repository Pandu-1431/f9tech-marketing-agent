/*
 * Copy the laptop's files (./.data/uploads: logos, posters, videos) to the S3 bucket the server
 * uses (Supabase Storage / Cloudflare R2). Keys stay the same, so every database row still points
 * at its file. Safe to run again (it overwrites with the same bytes).
 *
 *   S3_* variables of the SERVER + STORAGE_DRIVER=s3, then: npm run copy:uploads
 *   SOURCE_UPLOADS=./.data/uploads   which folder (default shown)
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { mimeFromKey, putFile } from "../src/lib/storage";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function main() {
  if (process.env.STORAGE_DRIVER !== "s3" || !process.env.S3_BUCKET) throw new Error("Set STORAGE_DRIVER=s3 and the S3_* values of the server first");
  const root = path.resolve(process.env.SOURCE_UPLOADS ?? path.join(process.cwd(), ".data", "uploads"));
  const files: string[] = [];
  for await (const f of walk(root)) files.push(f);
  console.log(`${files.length} file(s) in ${root} -> bucket ${process.env.S3_BUCKET}`);
  let done = 0;
  let failed = 0;
  const queue = [...files];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const key = path.relative(root, f).split(path.sep).join("/");
        try {
          await putFile(key, await fs.readFile(f), mimeFromKey(key));
          done++;
        } catch (err) {
          failed++;
          console.error(`  ✗ ${key}: ${err instanceof Error ? err.message : err}`);
        }
        if ((done + failed) % 25 === 0) console.log(`  ${done + failed}/${files.length}`);
      }
    }),
  );
  console.log(`\nCopied ${done}, failed ${failed}.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
