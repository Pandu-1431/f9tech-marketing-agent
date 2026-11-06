#!/usr/bin/env bash
# Build and (re)start the app. Run as the "agent" user in /srv/agent, for the first deploy and every update:
#   bash deploy/deploy.sh            (deploys the current branch, default main)
#   BRANCH=feature/x bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${BRANCH:-main}"

[ -f .env.production ] || { echo "Missing .env.production"; exit 1; }
chmod 600 .env.production

echo "== code ($BRANCH)"
git fetch --quiet origin
git checkout --quiet "$BRANCH"
git pull --ff-only --quiet origin "$BRANCH"

echo "== packages"
npm ci --no-audit --no-fund

echo "== config check"
npx tsx scripts/check-env.ts .env.production

echo "== build"
NODE_ENV=production npm run build

echo "== restart (database migrations run on start)"
if pm2 describe agent-web >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo "== health"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then echo "healthy"; exit 0; fi
  sleep 2
done
echo "Health check failed: pm2 logs agent-web --lines 50"; exit 1
