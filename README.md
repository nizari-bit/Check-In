# Event Check-in System

Invitation IDs + QR codes + mobile scanner, for multiple events (up to 1000 guests each).

**Stack:** Node.js + Express · React + Vite · Tailwind CSS · MySQL

## How it works

1. **Admin** (laptop dashboard) creates an event → gets a **login link + PIN** for the host.
2. Admin adds guests (one by one or CSV import). Each guest gets an ID like `A3F-9C2` and a QR code.
   The QR contains **only the ID** – a random phone scanning it sees meaningless text.
3. Admin prints the QR + ID on invitation cards (QR ZIP download or printable sheet).
4. At the event, the host/scanner opens the event link on their phone, enters the PIN, and lands on the scanner:
   - **Scan QR** with the camera, or **Enter ID** manually (guests without smartphones).
   - Green = valid (details shown, tap *Confirm check-in*), Orange = already checked in, Red = not found / other event.
5. Scanners only see check-in results – never the guest list.

## Card types (single / double)

- **Single** = admits 1 person. **Double** = admits up to 2 people. You choose the type per guest (or via the `card_type` column in CSV).
- The server enforces the limit: a card can never admit more people than its capacity, even with several scanners at once.
- At the door the scanner sees **"Admit up to N"** and taps how many people are entering now. A couple can arrive separately
  (1 now, 1 later) and the card stays valid until all spots are used.
- Stats count **people** (a double card = 2 expected people). The 1000 limit counts cards.
- Upgrading an existing database? Run `npm run db:setup` again: it adds the new columns safely.

## Setup

Requirements: Node.js 18+ and MySQL 8 (or MariaDB 10.5+).

```bash
# 1. install everything
npm run install:all

# 2. configure
cp server/.env.example server/.env
#    edit server/.env  (DB credentials, JWT_SECRET, ADMIN_EMAIL / ADMIN_PASSWORD, PUBLIC_URL)

# 3. create database, tables and the first admin
npm run db:setup

# 4. run in development (API :5000, web :5173)
npm run dev
```

Open http://localhost:5173/admin/login and sign in with the admin from your `.env`.

### Testing the scanner on a phone
Phone cameras only work on **HTTPS** (or `localhost`). Options: deploy to a server with HTTPS, or use a tunnel
such as `cloudflared tunnel --url http://localhost:5173` / ngrok while testing. Set `PUBLIC_URL` in `server/.env`
to that public address so generated event links are correct.

## Production

```bash
npm run build     # builds client/dist
npm start         # Express serves the API AND the built React app on PORT
```
Put Nginx/Caddy in front for HTTPS and proxy to the Node port. Set `PUBLIC_URL` to your real domain.

## Security notes

- Event link = 48-char random token **plus** a 6-digit PIN (hashed). PIN is shown once; reset any time.
- Wrong PINs are rate-limited and lock an event login for 15 minutes after 10 failures.
- Scanner sessions are checked against the database on every request: switching access off cuts it instantly.
- Event links expire automatically at the end of the day after the event (`APP_TZ_OFFSET` sets the timezone).
- An ID from another event shows "Different event" and reveals no guest information.
- Check-in is atomic, so two scanners cannot both check in the same guest.
- Change `JWT_SECRET` and the default admin password before going live.

## CSV import format

```
full_name,phone,category,table_no
John Doe,255712345678,VIP,1
```
Only `full_name` is required. Excel users: *Save As → CSV (UTF-8)*.

## Project layout

```
server/   Express API (src/routes, src/middleware, src/schema.sql)
client/   React app (src/pages: admin dashboard, scanner)
```
