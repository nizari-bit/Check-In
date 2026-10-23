#!/usr/bin/env bash
# ONE-TIME setup of the production service on this machine (Linux with systemd).
# Run it yourself, once:   bash deploy/setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/event-checkin}"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "Node.js is not installed (need version 18 or newer)."; exit 1; }

mkdir -p "$APP_DIR/server" "$HOME/.config/systemd/user"

cat > "$HOME/.config/systemd/user/event-checkin.service" <<UNIT
[Unit]
Description=Event Check-in (Express API + built React app)
After=network.target mariadb.service mysqld.service

[Service]
WorkingDirectory=$APP_DIR/server
ExecStart=$NODE_BIN src/index.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable event-checkin
# keep user services running after you log out and start them at boot
loginctl enable-linger "$USER" || sudo loginctl enable-linger "$USER"

echo
echo "Service installed. Next:"
echo "  1) create $APP_DIR/server/.env  (see deploy/README.md)"
echo "  2) push to main, or run: bash deploy/deploy.sh"
