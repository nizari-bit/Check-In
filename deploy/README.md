# Deploying (CD) on your own Linux machine

How it works: you push to `main` -> GitHub runs the tests (CI) -> if they pass, a small program
on your machine (the "runner") runs `deploy/deploy.sh`, which updates the live copy in
`~/apps/event-checkin`, rebuilds, updates the database tables and restarts the app.
The Cloudflare Tunnel then serves that live copy.

## One-time setup

### 1. Live settings file
```bash
mkdir -p ~/apps/event-checkin/server
nano ~/apps/event-checkin/server/.env
```
```
PORT=5050
PUBLIC_URL=https://events.yourdomain.com
JWT_SECRET=PASTE-A-LONG-RANDOM-TEXT-HERE      # create one with: openssl rand -hex 32
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your-db-password
DB_NAME=event_checkin
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a-strong-password
MAX_GUESTS_PER_EVENT=1000
APP_TZ_OFFSET=+03:00
```
Port 5050 keeps the live app separate from `npm run dev` (which uses 5000 and 5173).
This file is never overwritten or uploaded to GitHub.

### 2. Create the service
```bash
bash deploy/setup.sh
```

### 3. First admin (only if this database has no admin yet)
```bash
cd ~/apps/event-checkin/server && npm install --omit=dev && node src/scripts/seedAdmin.js
```
Skip this if `DB_NAME` is a database you already use (your admin exists).

### 4. Install the GitHub runner on this machine
On GitHub open your repo -> **Settings -> Actions -> Runners -> New self-hosted runner -> Linux**
and run the commands it shows. When it asks for labels and name, press Enter for the defaults. Then:
```bash
sudo ./svc.sh install $USER
sudo ./svc.sh start
```
It should show as **Idle** on that GitHub page.
(If the service refuses to start on Fedora, SELinux may be blocking it: run `./run.sh` in a terminal
meanwhile and send me the error.)

### 5. Point the tunnel at the live app
In `~/.cloudflared/config.yml` change the service to `http://localhost:5050`, then restart the tunnel.

## Everyday use
Just push to `main`. Watch it in the **Actions** tab. To deploy again by hand:
**Actions -> Deploy -> Run workflow**, or `bash deploy/deploy.sh` on the machine.

## Useful commands
```bash
systemctl --user status event-checkin
journalctl --user -u event-checkin -f
systemctl --user restart event-checkin
```

## Safety
- Keep the GitHub repository **private**. A self-hosted runner runs code on your machine.
- The deploy only starts after CI passes on a push to `main`, never from pull requests.
