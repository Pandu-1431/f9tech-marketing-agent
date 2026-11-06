#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 droplet (2 GB RAM or more). Run as root:
#   DOMAIN=agent.example.com EMAIL=you@example.com REPO=https://github.com/<you>/<repo>.git bash setup-droplet.sh
# Afterwards: put .env.production in /srv/agent, then run deploy/deploy.sh as the "agent" user.
set -euo pipefail
: "${DOMAIN:?set DOMAIN=agent.example.com}"
: "${EMAIL:?set EMAIL for the HTTPS certificate}"
: "${REPO:?set REPO to the git clone URL}"
APP_DIR=/srv/agent

echo "== packages"
apt-get update -y
apt-get install -y curl git nginx ufw certbot python3-certbot-nginx
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "== swap (next build needs memory on small droplets)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== app user and code"
id agent >/dev/null 2>&1 || adduser --disabled-password --gecos "" agent
mkdir -p "$APP_DIR" && chown agent:agent "$APP_DIR"
[ -d "$APP_DIR/.git" ] || sudo -u agent git clone "$REPO" "$APP_DIR"

echo "== firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== nginx + https"
sed "s/DOMAIN/$DOMAIN/" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/agent
ln -sf /etc/nginx/sites-available/agent /etc/nginx/sites-enabled/agent
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect

echo "== pm2 on boot"
env PATH="$PATH" pm2 startup systemd -u agent --hp /home/agent

echo
echo "Done. Next:"
echo "  1. Copy your .env.production to $APP_DIR/.env.production (chown agent, chmod 600)"
echo "  2. sudo -u agent bash $APP_DIR/deploy/deploy.sh"
