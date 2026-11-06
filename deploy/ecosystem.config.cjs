/* eslint-disable @typescript-eslint/no-require-imports -- pm2 loads this file as CommonJS */
/*
 * pm2 process list for the droplet: the web app and the job worker, both reading .env.production.
 *   pm2 start deploy/ecosystem.config.cjs && pm2 save
 */
const fs = require("node:fs");
const path = require("node:path");
const cwd = path.resolve(__dirname, "..");
// pm2 has no reliable env-file option: read the file here and pass the values to both processes.
const fileEnv = require("dotenv").parse(fs.readFileSync(path.join(cwd, ".env.production")));
const env = { ...fileEnv, NODE_ENV: "production" };

module.exports = {
  apps: [
    {
      name: "agent-web",
      cwd,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1", // only nginx talks to it
      env,
      max_memory_restart: "900M",
      kill_timeout: 10000,
    },
    {
      name: "agent-worker",
      cwd,
      script: "node_modules/.bin/tsx",
      args: "scripts/worker.ts",
      env,
      max_memory_restart: "1200M", // reels run ffmpeg
      kill_timeout: 30000, // let a running job finish (the worker stops on SIGTERM)
      restart_delay: 5000,
    },
  ],
};
