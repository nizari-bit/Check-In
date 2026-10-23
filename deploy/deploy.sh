#!/usr/bin/env bash
# Copies the new version into the production folder, installs, builds,
# updates the database tables, restarts the service and checks that it answers.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${APP_DIR:-$HOME/apps/event-checkin}"
ENV_FILE="$APP_DIR/server/.env"

# The runner is a system service, so tell systemctl --user where the user session lives
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

install_deps() { if [ -f package-lock.json ]; then npm ci "$@"; else npm install "$@"; fi; }

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE - create it first (see deploy/README.md)"; exit 1; }

echo "==> Copying files to $APP_DIR"
mkdir -p "$APP_DIR"
# .env, node_modules and the built site are kept; everything else is replaced
rsync -a --delete \
  --exclude='.git' --exclude='.github' --exclude='node_modules' \
  --exclude='.env' --exclude='client/dist' \
  "$SRC/" "$APP_DIR/"

echo "==> Installing server dependencies"
( cd "$APP_DIR/server" && install_deps --omit=dev )

echo "==> Building the client"
( cd "$APP_DIR/client" && install_deps && npm run build )

echo "==> Updating database tables (safe to repeat)"
( cd "$APP_DIR/server" && node src/scripts/migrate.js )

echo "==> Restarting the service"
systemctl --user restart event-checkin

PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '\r' || true)"
PORT="${PORT:-5000}"

echo "==> Waiting for the app on port $PORT"

for i in $(seq 1 30); do
  if curl -fsS --max-time 2 -o /dev/null \
      "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "Deployed successfully."
    exit 0
  fi

  sleep 1
done

echo "Deployment health check failed. Service logs:"
journalctl --user -u event-checkin -n 50 --no-pager || true
exit 1

