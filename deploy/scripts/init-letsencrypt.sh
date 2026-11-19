#!/bin/sh
# Run once on a new server, after DNS points at it and before the first deploy.
set -eu
cd "$(dirname "$0")/.."
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
EMAIL="${1:?usage: scripts/init-letsencrypt.sh you@example.com}"

docker compose -f docker-compose.prod.yml run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone -d "$DOMAIN" -d "www.$DOMAIN" -d "api.$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email
