# Run the whole product on this computer (Docker)

One command starts everything: the database, the app and the background worker (the AI team that plans, writes, designs, makes videos and publishes). It keeps working in the background while you use the app.

Docker Desktop is free for personal use and small businesses (under 250 people and under $10M revenue).

## Start

```bash
cp .env.docker.example .env.docker   # once: fill in the AI keys (or copy them from .env.local)
npm run docker:up                    # build + start (first time ~5-10 minutes)
```

Open **http://localhost:3000**.

| Command | What it does |
| --- | --- |
| `npm run docker:up` | Start (or update after code changes) |
| `npm run docker:logs` | Watch what the app and the AI team are doing |
| `npm run docker:down` | Stop. Your data stays (Docker volumes `pgdata` and `uploads`) |
| `docker compose ps` | Is everything running and healthy? |

## Bring your current data in (once)

Stop `npm run dev` first, start only the database, then copy:

```bash
docker compose up -d db
TARGET_DATABASE_URL=postgres://agent:agent@127.0.0.1:5433/agent \
SOURCE_CHANNEL_SECRET='<SESSION_SECRET from .env.local>' \
CHANNEL_SECRET='<SESSION_SECRET from .env.docker>' \
npm run copy:data
npm run docker:up
```

## Show it to someone on the same Wi-Fi

Find this Mac's address (`ipconfig getifaddr en0`, e.g. `192.168.1.20`), then:

```bash
APP_URL=http://192.168.1.20:3000 npm run docker:up
```

They open `http://192.168.1.20:3000` on their phone or laptop.

## Good to know

- **Free AI limits:** Cloudflare's free images and voice reset every day. When they run out, images come from Pollinations (small watermark) and voice from Groq.
- **Mac sleep:** scheduled posts only go out while the Mac is awake and Docker is running. For 24×7 posting, use the droplet setup in `deploy/README.md`.
- **Google sign-in (YouTube / Business Profile / Sheet):** works on `http://localhost:3000` only (the address registered in Google Cloud).
