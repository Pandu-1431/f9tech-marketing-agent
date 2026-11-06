/*
 * `npm run check:prod [-- path/to/.env]` — lists what is missing or risky before going live.
 * With a file: checks that file. Without: checks the current environment (e.g. on the server).
 * Exit code 1 when there are errors, so a deploy script can stop.
 */
import fs from "node:fs";
import { parse } from "dotenv";
import { checkProductionEnv } from "../src/lib/prod-check";

const file = process.argv[2];
const env = file ? { ...parse(fs.readFileSync(file)) } : (process.env as Record<string, string | undefined>);
const { errors, warnings, ok } = checkProductionEnv(env);

console.log(`\nProduction check${file ? ` (${file})` : ""}\n`);
for (const m of ok) console.log(`  ✓ ${m}`);
for (const m of warnings) console.log(`  ! ${m}`);
for (const m of errors) console.log(`  ✗ ${m}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)\n`);
process.exit(errors.length ? 1 : 0);
