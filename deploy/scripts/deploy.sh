#!/bin/sh
# Usage: scripts/deploy.sh <image-tag>
# Pulls the tagged images, restarts, and checks https://api.<domain>/health. Goes back to the previous tag if the
# new one is not healthy (a failed migration is rolled back by Postgres, so the old image still works).
set -eu
cd "$(dirname "$0")/.."
TAG="$1"
COMPOSE="docker compose -f docker-compose.prod.yml"
PREV=$(grep '^IMAGE_TAG=' .env | cut -d= -f2)
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)

set_tag() { sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env; }

healthy() {
  i=0
  while [ $i -lt 30 ]; do
    curl -fsS "https://api.$DOMAIN/health" >/dev/null 2>&1 && return 0
    i=$((i + 1)); sleep 4
  done
  return 1
}

IMAGE_TAG="$TAG" $COMPOSE pull api web
set_tag "$TAG"
$COMPOSE up -d --remove-orphans

if healthy; then
  echo "Deployed $TAG"
  docker image prune -af --filter "until=168h" >/dev/null
else
  echo "Health check failed for $TAG, rolling back to $PREV" >&2
  $COMPOSE logs --tail 80 api >&2
  set_tag "$PREV"
  $COMPOSE up -d --remove-orphans
  exit 1
fi
