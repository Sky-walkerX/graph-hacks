#!/usr/bin/env bash
# Runs as root on the VM at every boot (GCE startup-script), and again from
# redeploy.sh. Installs Docker once, brings the checkout up to date, writes
# .env on the first run, then builds and starts the stack behind Caddy (HTTPS).
set -euo pipefail

meta() {
  curl -fs -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/$1" || true
}

REPO_URL="$(meta attributes/repo-url)"
REPO_URL="${REPO_URL:-https://github.com/Sky-walkerX/graph-hacks.git}"
BRANCH="$(meta attributes/repo-branch)"
BRANCH="${BRANCH:-main}"
DIR=/opt/graph-hacks

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# The Next build wants more memory than the machine has spare once Postgres
# and FalkorDB are up.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile; }
  swapon /swapfile
fi

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" checkout -B "$BRANCH" FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  PUBLIC_URL="$(meta attributes/public-url)"
  if [ -z "$PUBLIC_URL" ]; then
    IP="$(meta network-interfaces/0/access-configs/0/external-ip)"
    PUBLIC_URL="https://${IP//./-}.sslip.io"
  fi
  cp .env.example .env
  sed -i \
    -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" \
    -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" \
    .env
fi

docker compose --profile https up -d --build --remove-orphans
docker image prune -f >/dev/null
