# Going live (Layer 7)

The web app and the background worker run on one DigitalOcean droplet. The database and files live in Supabase. About an hour the first time.

## What you need

| Item | Where | Notes |
| --- | --- | --- |
| Droplet | DigitalOcean, Ubuntu 24.04, **2 GB RAM** or more (~$12/month) | 1 GB is too small for `next build` and reel videos |
| Domain | e.g. `agent.f9tech.com` | An A record pointing to the droplet IP |
| Postgres | Supabase → Project Settings → Database → **Session pooler** (port 5432) | Not 6543 (the transaction pooler) |
| File bucket | Supabase Storage, public bucket `media` + S3 access key | Already set in your `.env.local` |
| AI keys | Gemini + Groq (+ Cloudflare for images) | The same keys as now |
| Google OAuth | Google Cloud → Clients → add redirect `https://<domain>/api/oauth/google/callback` | Only if you use YouTube, Business Profile or Sheets |

## 1. Make `.env.production`

Start from your `.env.local` and change these:

```bash
SESSION_SECRET=<openssl rand -base64 32>   # new one for the server
APP_URL=https://agent.f9tech.com
DATABASE_URL=postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
AGENT_INLINE_JOBS=false
STORAGE_DRIVER=s3                          # + the S3_* values
TRUSTED_PROXY_HOPS=1
```

Check it on your Mac. It must report 0 errors:

```bash
npm run check:prod -- .env.production
```

## 2. Move your current data (optional, keeps brands, campaigns, memory and channels)

Stop `npm run dev` first. The laptop database allows only one process at a time.

```bash
TARGET_DATABASE_URL='<the Supabase URL>' \
SOURCE_CHANNEL_SECRET='<SESSION_SECRET from .env.local>' \
CHANNEL_SECRET='<SESSION_SECRET from .env.production>' \
npm run copy:data
```

- The copy runs in one transaction: either everything is copied or nothing is.
- Connected channel tokens are re-encrypted for the server's secret.
- It refuses to run if the target already has users. It was tested on a copy of your data: 17 tables, tokens readable, id counters correct.
- Files: your `.env.local` already uses Supabase Storage, so posters and videos are already in the bucket. If some were made while `STORAGE_DRIVER=local`, run `npm run copy:uploads` with the server's `S3_*` values.

## 3. Set up the droplet (once)

```bash
scp deploy/setup-droplet.sh root@<droplet-ip>:   # from your Mac
ssh root@<droplet-ip>
DOMAIN=agent.f9tech.com EMAIL=web@f9tech.com REPO=https://github.com/<you>/<repo>.git bash setup-droplet.sh
```

This installs Node 22, nginx, HTTPS (Let's Encrypt), pm2, a firewall and 2 GB of swap. It also clones the code to `/srv/agent` and creates an `agent` user.

**Private repo:** use a deploy key or a fine-grained token in `REPO`.

## 4. Deploy

```bash
scp .env.production root@<droplet-ip>:/srv/agent/.env.production
ssh root@<droplet-ip> 'chown agent:agent /srv/agent/.env.production && chmod 600 /srv/agent/.env.production'
ssh root@<droplet-ip> 'sudo -iu agent bash /srv/agent/deploy/deploy.sh'
```

`deploy.sh` does the following. Run the same command for every update.

1. `git pull`
2. `npm ci`
3. Config check (stops on errors)
4. `next build`
5. Starts or reloads `agent-web` and `agent-worker` in pm2. Database migrations run automatically.
6. Waits for `/api/health`

## 5. After going live

- **Monitoring:** add `https://<domain>/api/health` to UptimeRobot (free). It returns 503 if the database is down or a job has waited more than 15 minutes, which means the worker stopped.
- **Logs:** `pm2 logs agent-web` and `pm2 logs agent-worker`.
- **Google:** add the production redirect URI. Move the OAuth app from "Testing" to "In production", otherwise tokens expire after 7 days.
- **Meta:** check that Facebook and Instagram tokens are long-lived Page tokens.
- **Backups:** Supabase free tier makes daily backups. Download one from time to time.
- **Telegram, Facebook, Instagram, YouTube and Google Business Profile** posting all work from the server. Posts go out on schedule even when your Mac is off.
