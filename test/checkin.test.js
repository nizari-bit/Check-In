// Full check-in flow through the real API and a real MySQL/MariaDB database.
// Needs the database from server/.env (or DB_* variables) and an admin created by `npm run db:setup`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = process.env.TEST_PORT || '5077';
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server, adminToken, event, pin, scannerToken, accessToken;

async function call(method, url, { body, token } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}
const admin = (m, u, body) => call(m, u, { body, token: adminToken });
const scan = (m, u, body) => call(m, u, { body, token: scannerToken });

async function addGuest(card_type, name = 'Test Guest') {
  const r = await admin('POST', `/admin/events/${event.id}/guests`, { full_name: name, card_type });
  assert.equal(r.status, 201);
  return r.data.code;
}

before(async () => {
  server = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {                                   // wait until the server answers
    try { await fetch(BASE + '/ping'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  const login = await call('POST', '/admin/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, 'admin login failed: did you run "npm run db:setup"?');
  adminToken = login.data.token;

  const today = new Date().toISOString().slice(0, 10);
  const created = await admin('POST', '/admin/events', { name: `CI Test ${Date.now()}`, event_date: today });
  assert.equal(created.status, 201);
  event = created.data.event;
  pin = created.data.pin;
  accessToken = event.access_token;

  const sl = await call('POST', `/access/${accessToken}/login`, { body: { pin } });
  assert.equal(sl.status, 200);
  scannerToken = sl.data.token;
});

after(async () => {
  if (adminToken && event) await admin('DELETE', `/admin/events/${event.id}`);
  server?.kill();
});

test('unknown API paths return 404', async () => {
  assert.equal((await call('GET', '/nothing')).status, 404);
});

test('admin pages need a login', async () => {
  assert.equal((await call('GET', '/admin/events')).status, 401);
  assert.equal((await call('POST', '/admin/login', { body: { email: ADMIN_EMAIL, password: 'wrong' } })).status, 401);
});

test('event needs a name and a valid date', async () => {
  assert.equal((await admin('POST', '/admin/events', { event_date: '2030-01-01' })).status, 400);
  assert.equal((await admin('POST', '/admin/events', { name: 'X', event_date: 'tomorrow' })).status, 400);
});

test('scanner login: wrong PIN is refused, link and PIN are safe', async () => {
  assert.equal((await call('POST', `/access/${accessToken}/login`, { body: { pin: '000000' } })).status, 401);
  assert.equal((await call('GET', '/access/not-a-real-token')).status, 404);
  assert.equal(event.pin_hash, undefined, 'pin hash must never be sent to the browser');
});

test('scanner cannot use admin routes', async () => {
  assert.equal((await scan('GET', '/admin/events')).status, 401);
});

test('single card: valid once, then fully used', async () => {
  const code = await addGuest('single', 'Single Guest');
  const look = await scan('POST', '/scan/lookup', { code });
  assert.equal(look.data.status, 'ok');
  assert.equal(look.data.guest.remaining, 1);

  const inn = await scan('POST', '/scan/checkin', { code, count: 1 });
  assert.equal(inn.data.status, 'checked_in');
  assert.equal(inn.data.admitted_now, 1);

  assert.equal((await scan('POST', '/scan/lookup', { code })).data.status, 'already');
  assert.equal((await scan('POST', '/scan/checkin', { code, count: 1 })).data.status, 'already');
});

test('single card cannot admit 2 people', async () => {
  const code = await addGuest('single');
  assert.equal((await scan('POST', '/scan/checkin', { code, count: 2 })).data.status, 'too_many');
  assert.equal((await scan('POST', '/scan/lookup', { code })).data.status, 'ok'); // nobody was let in
});

test('double card: couple can arrive separately, never more than 2', async () => {
  const code = await addGuest('double', 'Double Guest');
  assert.equal((await scan('POST', '/scan/checkin', { code, count: 1 })).data.status, 'checked_in');

  const mid = await scan('POST', '/scan/lookup', { code });
  assert.equal(mid.data.status, 'partial');
  assert.equal(mid.data.guest.remaining, 1);

  assert.equal((await scan('POST', '/scan/checkin', { code, count: 2 })).data.status, 'too_many');
  assert.equal((await scan('POST', '/scan/checkin', { code, count: 1 })).data.status, 'checked_in');
  assert.equal((await scan('POST', '/scan/lookup', { code })).data.status, 'already');
});

test('double card admits both people at once', async () => {
  const code = await addGuest('double');
  const r = await scan('POST', '/scan/checkin', { code, count: 2 });
  assert.equal(r.data.status, 'checked_in');
  assert.equal(r.data.guest.remaining, 0);
});

test('two scanners at the same moment cannot both admit the same single card', async () => {
  const code = await addGuest('single');
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => scan('POST', '/scan/checkin', { code, count: 1 })));
  const admitted = results.filter((r) => r.data.status === 'checked_in').length;
  assert.equal(admitted, 1);
});

test('IDs are accepted in any format and unknown IDs are not found', async () => {
  const code = await addGuest('single');
  const lower = code.replace('-', '').toLowerCase();
  assert.equal((await scan('POST', '/scan/lookup', { code: lower })).data.status, 'ok');
  assert.equal((await scan('POST', '/scan/lookup', { code: 'ZZZ-999' })).data.status, 'not_found');
  assert.equal((await scan('POST', '/scan/lookup', { code: '' })).data.status, 'not_found');
});

test('an ID from another event shows "wrong_event" and reveals nothing', async () => {
  const other = await admin('POST', '/admin/events', { name: 'Other event', event_date: new Date().toISOString().slice(0, 10) });
  const otherId = other.data.event.id;
  const r = await admin('POST', `/admin/events/${otherId}/guests`, { full_name: 'Secret Person', card_type: 'single' });
  const look = await scan('POST', '/scan/lookup', { code: r.data.code });
  assert.equal(look.data.status, 'wrong_event');
  assert.equal(look.data.guest, undefined);
  await admin('DELETE', `/admin/events/${otherId}`);
});

test('admin can undo a check-in', async () => {
  const code = await addGuest('single');
  await scan('POST', '/scan/checkin', { code, count: 1 });
  const guests = await admin('GET', `/admin/events/${event.id}/guests`);
  const g = guests.data.find((x) => x.code === code);
  assert.equal((await admin('POST', `/admin/guests/${g.id}/undo-checkin`)).status, 200);
  assert.equal((await scan('POST', '/scan/lookup', { code })).data.status, 'ok');
});

test('switching access off cuts the scanner off immediately', async () => {
  await admin('POST', `/admin/events/${event.id}/access`, { active: false });
  assert.equal((await scan('GET', '/scan/event')).status, 403);
  assert.equal((await call('GET', `/access/${accessToken}`)).status, 410);
  await admin('POST', `/admin/events/${event.id}/access`, { active: true });
  assert.equal((await scan('GET', '/scan/event')).status, 200);
});

test('event stats count people, not cards', async () => {
  const info = await scan('GET', '/scan/event');
  assert.ok(info.data.total >= info.data.cards);
  assert.ok(info.data.arrived <= info.data.total);
});
