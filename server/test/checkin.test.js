// Full check-in flow through the real API and a real MySQL/MariaDB database.
// Needs the database from server/.env (or DB_* variables) and an admin created by `npm run db:setup`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";

const PORT = process.env.TEST_PORT || "5077";
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe123!";
const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let server, adminToken, event, pin, scannerToken, accessToken;

async function call(method, url, { body, token } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}
const admin = (m, u, body) => call(m, u, { body, token: adminToken });
const scan = (m, u, body) => call(m, u, { body, token: scannerToken });

async function addGuest(card_type, name = "Test Guest") {
  const r = await admin("POST", `/admin/events/${event.id}/guests`, {
    full_name: name,
    card_type,
  });
  assert.equal(r.status, 201);
  return r.data.code;
}

async function uploadTemplate(eventId, color = "#f7f4ef") {
  const canvas = createCanvas(1191, 1677);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const form = new FormData();
  form.append("image", new Blob([canvas.toBuffer("image/png")], { type: "image/png" }), "template.png");
  for (const [key, value] of Object.entries({
    name_x: 623.1,
    name_y: 507.9,
    name_width: 600,
    name_font_size: 48,
    qr_x: 549,
    qr_y: 1250,
    qr_size: 165,
  })) {
    form.append(key, String(value));
  }

  const response = await fetch(`${BASE}/admin/events/${eventId}/card-template`, {
    method: "POST",
    headers: { Authorization: "Bearer " + adminToken },
    body: form,
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  assert.ok(data.event.card_template_path, JSON.stringify(data));
  assert.match(data.event.card_template_path, /^assets\/card\/event-/);
  return data.event;
}

before(async () => {
  server = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT, GOOGLE_FONTS: "", GOOGLE_FONTS_API_KEY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    // wait until the server answers
    try {
      await fetch(BASE + "/ping");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const login = await call("POST", "/admin/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  assert.equal(
    login.status,
    200,
    'admin login failed: did you run "npm run db:setup"?',
  );
  adminToken = login.data.token;

  const today = new Date().toISOString().slice(0, 10);
  const created = await admin("POST", "/admin/events", {
    name: `CI Test ${Date.now()}`,
    event_date: today,
  });
  assert.equal(created.status, 201);
  event = created.data.event;
  pin = created.data.pin;
  accessToken = event.access_token;
  event = await uploadTemplate(event.id);

  const sl = await call("POST", `/access/${accessToken}/login`, {
    body: { pin },
  });
  assert.equal(sl.status, 200);
  scannerToken = sl.data.token;
});

after(async () => {
  if (adminToken && event) await admin("DELETE", `/admin/events/${event.id}`);
  server?.kill();
});

test("unknown API paths return 404", async () => {
  assert.equal((await call("GET", "/nothing")).status, 404);
});

test("admin pages need a login", async () => {
  assert.equal((await call("GET", "/admin/events")).status, 401);
  assert.equal(
    (
      await call("POST", "/admin/login", {
        body: { email: ADMIN_EMAIL, password: "wrong" },
      })
    ).status,
    401,
  );
});

test("event needs a name and a valid date", async () => {
  assert.equal(
    (await admin("POST", "/admin/events", { event_date: "2030-01-01" })).status,
    400,
  );
  assert.equal(
    (
      await admin("POST", "/admin/events", {
        name: "X",
        event_date: "tomorrow",
      })
    ).status,
    400,
  );
});

test("scanner login: wrong PIN is refused, link and PIN are safe", async () => {
  assert.equal(
    (
      await call("POST", `/access/${accessToken}/login`, {
        body: { pin: "000000" },
      })
    ).status,
    401,
  );
  assert.equal((await call("GET", "/access/not-a-real-token")).status, 404);
  assert.equal(
    event.pin_hash,
    undefined,
    "pin hash must never be sent to the browser",
  );
});

test("scanner cannot use admin routes", async () => {
  assert.equal((await scan("GET", "/admin/events")).status, 401);
});

test("single card: valid once, then fully used", async () => {
  const code = await addGuest("single", "Single Guest");
  const look = await scan("POST", "/scan/lookup", { code });
  assert.equal(look.data.status, "ok");
  assert.equal(look.data.guest.remaining, 1);

  const inn = await scan("POST", "/scan/checkin", { code, count: 1 });
  assert.equal(inn.data.status, "checked_in");
  assert.equal(inn.data.admitted_now, 1);

  assert.equal(
    (await scan("POST", "/scan/lookup", { code })).data.status,
    "already",
  );
  assert.equal(
    (await scan("POST", "/scan/checkin", { code, count: 1 })).data.status,
    "already",
  );
});

test("single card cannot admit 2 people", async () => {
  const code = await addGuest("single");
  assert.equal(
    (await scan("POST", "/scan/checkin", { code, count: 2 })).data.status,
    "too_many",
  );
  assert.equal(
    (await scan("POST", "/scan/lookup", { code })).data.status,
    "ok",
  ); // nobody was let in
});

test("double card: couple can arrive separately, never more than 2", async () => {
  const code = await addGuest("double", "Double Guest");
  assert.equal(
    (await scan("POST", "/scan/checkin", { code, count: 1 })).data.status,
    "checked_in",
  );

  const mid = await scan("POST", "/scan/lookup", { code });
  assert.equal(mid.data.status, "partial");
  assert.equal(mid.data.guest.remaining, 1);

  assert.equal(
    (await scan("POST", "/scan/checkin", { code, count: 2 })).data.status,
    "too_many",
  );
  assert.equal(
    (await scan("POST", "/scan/checkin", { code, count: 1 })).data.status,
    "checked_in",
  );
  assert.equal(
    (await scan("POST", "/scan/lookup", { code })).data.status,
    "already",
  );
});

test("double card admits both people at once", async () => {
  const code = await addGuest("double");
  const r = await scan("POST", "/scan/checkin", { code, count: 2 });
  assert.equal(r.data.status, "checked_in");
  assert.equal(r.data.guest.remaining, 0);
});

test("two scanners at the same moment cannot both admit the same single card", async () => {
  const code = await addGuest("single");
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(() =>
      scan("POST", "/scan/checkin", { code, count: 1 }),
    ),
  );
  const admitted = results.filter((r) => r.data.status === "checked_in").length;
  assert.equal(admitted, 1);
});

test("IDs are accepted in any format and unknown IDs are not found", async () => {
  const code = await addGuest("single");
  const lower = code.replace("-", "").toLowerCase();
  assert.equal(
    (await scan("POST", "/scan/lookup", { code: lower })).data.status,
    "ok",
  );
  assert.equal(
    (await scan("POST", "/scan/lookup", { code: "ZZZ-999" })).data.status,
    "not_found",
  );
  assert.equal(
    (await scan("POST", "/scan/lookup", { code: "" })).data.status,
    "not_found",
  );
});

test('an ID from another event shows "wrong_event" and reveals nothing', async () => {
  const other = await admin("POST", "/admin/events", {
    name: "Other event",
    event_date: new Date().toISOString().slice(0, 10),
  });
  const otherId = other.data.event.id;
  const r = await admin("POST", `/admin/events/${otherId}/guests`, {
    full_name: "Secret Person",
    card_type: "single",
  });
  const look = await scan("POST", "/scan/lookup", { code: r.data.code });
  assert.equal(look.data.status, "wrong_event");
  assert.equal(look.data.guest, undefined);
  await admin("DELETE", `/admin/events/${otherId}`);
});

test("admin can undo a check-in", async () => {
  const code = await addGuest("single");
  await scan("POST", "/scan/checkin", { code, count: 1 });
  const guests = await admin("GET", `/admin/events/${event.id}/guests`);
  const g = guests.data.find((x) => x.code === code);
  assert.equal(
    (await admin("POST", `/admin/guests/${g.id}/undo-checkin`)).status,
    200,
  );
  assert.equal(
    (await scan("POST", "/scan/lookup", { code })).data.status,
    "ok",
  );
});

test("switching access off cuts the scanner off immediately", async () => {
  await admin("POST", `/admin/events/${event.id}/access`, { active: false });
  assert.equal((await scan("GET", "/scan/event")).status, 403);
  assert.equal((await call("GET", `/access/${accessToken}`)).status, 410);
  await admin("POST", `/admin/events/${event.id}/access`, { active: true });
  assert.equal((await scan("GET", "/scan/event")).status, 200);
});

test("event stats count people, not cards", async () => {
  const info = await scan("GET", "/scan/event");
  assert.ok(info.data.total >= info.data.cards);
  assert.ok(info.data.arrived <= info.data.total);
});

// ---------- CSV import: no duplicates ----------
async function importCsv(eventId, csv) {
  const fd = new FormData();
  fd.append("file", new Blob([csv], { type: "text/csv" }), "guests.csv");
  const res = await fetch(`${BASE}/admin/events/${eventId}/import`, {
    method: "POST",
    headers: { Authorization: "Bearer " + adminToken },
    body: fd,
  });
  return { status: res.status, data: await res.json() };
}
const guestCount = async (eventId) =>
  (await admin("GET", `/admin/events/${eventId}/guests`)).data.length;

test("importing the same CSV again does not add duplicates", async () => {
  const ev = (
    await admin("POST", "/admin/events", {
      name: "Import test",
      event_date: new Date().toISOString().slice(0, 10),
    })
  ).data.event;
  const csv =
    "full_name,phone,card_type\nAsha Juma,0712345678,single\nBaraka Said,0755111222,double\nNeema Peter,,single\n";

  const first = await importCsv(ev.id, csv);
  assert.equal(first.data.imported, 3);
  assert.equal(first.data.skipped.length, 0);

  for (let i = 0; i < 3; i++) {
    // 2nd, 3rd and 4th import
    const again = await importCsv(ev.id, csv);
    assert.equal(again.status, 200);
    assert.equal(again.data.imported, 0);
    assert.equal(again.data.skipped.length, 3);
    assert.match(
      again.data.skipped[0].reason,
      /Already on the list \(ID [0-9A-F]{3}-[0-9A-F]{3}\)/,
    );
  }
  assert.equal(await guestCount(ev.id), 3);
  await admin("DELETE", `/admin/events/${ev.id}`);
});

test("import adds only the new guests and spots the same person written differently", async () => {
  const ev = (
    await admin("POST", "/admin/events", {
      name: "Import test 2",
      event_date: new Date().toISOString().slice(0, 10),
    })
  ).data.event;
  await importCsv(ev.id, "full_name,phone\nAsha Juma,0712345678\n");

  const r = await importCsv(
    ev.id,
    [
      "full_name,phone",
      "ASHA   juma,+255 712 345 678", // same person, different writing -> skipped
      "Asha Juma,0755000111", // same name, different phone -> a different Asha -> added
      "Zawadi Ali,0700000001", // new -> added
      "Zawadi Ali,0700000001", // repeated inside the file -> skipped
    ].join("\n"),
  );
  assert.equal(r.data.imported, 2);
  assert.equal(r.data.skipped.length, 2);
  assert.equal(r.data.skipped[1].reason, "Appears more than once in this file");
  assert.equal(await guestCount(ev.id), 3);
  await admin("DELETE", `/admin/events/${ev.id}`);
});

test("the same name in two different events is not a duplicate", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const a = (
    await admin("POST", "/admin/events", { name: "Event A", event_date: day })
  ).data.event;
  const b = (
    await admin("POST", "/admin/events", { name: "Event B", event_date: day })
  ).data.event;
  const csv = "full_name,phone\nAsha Juma,0712345678\n";
  assert.equal((await importCsv(a.id, csv)).data.imported, 1);
  assert.equal((await importCsv(b.id, csv)).data.imported, 1);
  await admin("DELETE", `/admin/events/${a.id}`);
  await admin("DELETE", `/admin/events/${b.id}`);
});

test("a double-click (two imports at the same moment) still gives no duplicates", async () => {
  const ev = (
    await admin("POST", "/admin/events", {
      name: "Import test 3",
      event_date: new Date().toISOString().slice(0, 10),
    })
  ).data.event;
  const csv =
    "full_name,phone\n" +
    Array.from(
      { length: 40 },
      (_, i) => `Guest Number${i},07000000${String(i).padStart(2, "0")}`,
    ).join("\n");
  const results = await Promise.all([
    importCsv(ev.id, csv),
    importCsv(ev.id, csv),
    importCsv(ev.id, csv),
  ]);
  assert.ok(results.every((r) => r.status === 200 || r.status === 409));
  assert.equal(await guestCount(ev.id), 40);
  await admin("DELETE", `/admin/events/${ev.id}`);
});

// ---------- Invitation cards ----------
async function getBinary(url, token = adminToken) {
  const res = await fetch(BASE + url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    disposition: res.headers.get("content-disposition"),
    buf: Buffer.from(await res.arrayBuffer()),
  };
}
async function readQr(jpegBuffer) {
  // reads the QR code from a card image
  const img = await loadImage(jpegBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  return {
    text: jsQR(d.data, d.width, d.height)?.data,
    width: img.width,
    height: img.height,
  };
}
async function newGuest(eventId, name, card_type = "single") {
  const r = await admin("POST", `/admin/events/${eventId}/guests`, {
    full_name: name,
    card_type,
  });
  assert.equal(r.status, 201);
  return { id: r.data.id, code: r.data.code };
}
const today = () => new Date().toISOString().slice(0, 10);

test("invitation card: needs an admin login", async () => {
  const g = await newGuest(event.id, "Card Person");
  assert.equal(
    (await getBinary(`/admin/guests/${g.id}/card.jpg`, null)).status,
    401,
  );
  assert.equal(
    (await getBinary(`/admin/guests/${g.id}/card.jpg`, scannerToken)).status,
    401,
  );
});

test("invitation card: is a full-size JPEG whose QR code is the guest ID", async () => {
  const g = await newGuest(event.id, "Amina Salum", "double");
  const r = await getBinary(`/admin/guests/${g.id}/card.jpg`);
  assert.equal(r.status, 200);
  assert.match(r.type, /image\/jpeg/);
  assert.equal(r.buf[0], 0xff);
  assert.equal(r.buf[1], 0xd8); // JPEG signature
  const qr = await readQr(r.buf);
  assert.equal(qr.width, 1191);
  assert.equal(qr.height, 1677); // A6 at about 290 dpi
  assert.equal(qr.text, g.code, "the QR on the card must contain the guest ID");
});

test("invitation card: download option names the file with the ID and name", async () => {
  const g = await newGuest(event.id, "Neema Peter");
  const r = await getBinary(`/admin/guests/${g.id}/card.jpg?download=1`);
  assert.match(
    r.disposition,
    new RegExp(`attachment; filename="${g.code}_Neema_Peter\\.jpg"`),
  );
});

test("invitation card: very long names, accents and symbols still produce a scannable card", async () => {
  for (const name of [
    "Zéphyrine Ngô & Familia Yote Wapendwa Wa Kijiji Cha Mbezi Beach Dar es Salaam",
    "W".repeat(180),
    "Ali",
  ]) {
    const g = await newGuest(event.id, name);
    const r = await getBinary(`/admin/guests/${g.id}/card.jpg`);
    assert.equal(r.status, 200);
    assert.equal((await readQr(r.buf)).text, g.code);
  }
});

test("invitation card: changes when the guest name is edited", async () => {
  const g = await newGuest(event.id, "Old Name");
  const before = (await getBinary(`/admin/guests/${g.id}/card.jpg`)).buf;
  await admin("PUT", `/admin/guests/${g.id}`, {
    full_name: "New Name",
    card_type: "single",
  });
  const after = (await getBinary(`/admin/guests/${g.id}/card.jpg`)).buf;
  assert.notDeepEqual(before, after);
});

test("invitation card: unknown guest gives 404", async () => {
  assert.equal(
    (await getBinary("/admin/guests/99999999/card.jpg")).status,
    404,
  );
});

test("cards ZIP: one JPEG per guest, named with the ID", async () => {
  const ev = (
    await admin("POST", "/admin/events", {
      name: "Cards ZIP test",
      event_date: today(),
    })
  ).data.event;
  const noTemplate = await getBinary(`/admin/events/${ev.id}/cards.zip`);
  assert.equal(noTemplate.status, 400);
  const zipEvent = await uploadTemplate(ev.id, "#f0f4f8");
  assert.notEqual(zipEvent.card_template_path, event.card_template_path);
  const guests = [
    await newGuest(ev.id, "Asha Juma"),
    await newGuest(ev.id, "Baraka Said", "double"),
    await newGuest(ev.id, "Neema Peter"),
  ];
  const r = await getBinary(`/admin/events/${ev.id}/cards.zip`);
  assert.equal(r.status, 200);
  assert.match(r.type, /zip/);
  assert.equal(r.buf.subarray(0, 2).toString(), "PK");
  const eocd = r.buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); // end-of-zip record
  assert.equal(r.buf.readUInt16LE(eocd + 10), 3, "the ZIP should hold 3 cards");
  for (const g of guests)
    assert.ok(
      r.buf.includes(Buffer.from(`${g.code}_`)),
      `card for ${g.code} is missing`,
    );
  assert.equal(
    (await getBinary(`/admin/events/${ev.id}/cards.zip`, null)).status,
    401,
  );
  await admin("DELETE", `/admin/events/${ev.id}`);
});

test("cards ZIP: unknown event gives 404", async () => {
  assert.equal(
    (await getBinary("/admin/events/99999999/cards.zip")).status,
    404,
  );
});

// ---------- Fonts: friendly messages, and a font problem never stops a card ----------
async function saveLayout(eventId, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const res = await fetch(`${BASE}/admin/events/${eventId}/card-template`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  return { status: res.status, data: await res.json() };
}
const dayToday = () => new Date().toISOString().slice(0, 10);

test("fonts: when the font list is unavailable the message is short and friendly", async () => {
  const r = await admin("GET", "/admin/fonts");
  assert.equal(r.status, 503);
  assert.equal(r.data.code, "not_configured");
  assert.match(r.data.error, /default font/i);
  assert.doesNotMatch(r.data.error, /api key|googleapis|http|\d{3}|server/i, "no technical words in the message");
});

test("fonts: a chosen font is saved even if the list can't be reached, and the card still works", async () => {
  const ev = (await admin("POST", "/admin/events", { name: "Font test", event_date: dayToday() })).data.event;
  await uploadTemplate(ev.id);
  const saved = await saveLayout(ev.id, { name_font_family: "Pacifico", name_font_variant: "regular", name_font_size: 48 });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.event.card_name_font_family, "Pacifico");
  assert.match(saved.data.warning, /default font/i);

  const g = await newGuest(ev.id, "Amina Salum");
  const card = await getBinary(`/admin/guests/${g.id}/card.jpg`);
  assert.equal(card.status, 200);
  assert.equal((await readQr(card.buf)).text, g.code);
  await admin("DELETE", `/admin/events/${ev.id}`);
});

test("fonts: choosing only a font family or only a style is refused politely", async () => {
  const saved = await saveLayout(event.id, { name_font_family: "Pacifico" });
  assert.equal(saved.status, 400);
  assert.match(saved.data.error, /font/i);
});

// ---------- Cards: speed options and a missing template file ----------
test("card preview: ?w= gives a smaller, lighter picture; the download stays full size", async () => {
  const g = await newGuest(event.id, "Preview Person");
  const small = await getBinary(`/admin/guests/${g.id}/card.jpg?w=600`);
  const full = await getBinary(`/admin/guests/${g.id}/card.jpg`);
  assert.equal(small.status, 200);
  assert.equal((await readQr(full.buf)).width, 1191);
  const img = await loadImage(small.buf);
  assert.equal(img.width, 600);
  assert.ok(small.buf.length < full.buf.length, "the preview should be lighter than the full card");
  assert.equal((await getBinary(`/admin/guests/${g.id}/card.jpg?w=99999`)).status, 200); // silly sizes fall back to full size
});

test("card: the same card asked twice gives identical bytes (served from memory)", async () => {
  const g = await newGuest(event.id, "Cache Person");
  const a = await getBinary(`/admin/guests/${g.id}/card.jpg`);
  const b = await getBinary(`/admin/guests/${g.id}/card.jpg`);
  assert.deepEqual(a.buf, b.buf);
});

test("card: if the template file has gone missing, the message says what to do", async () => {
  const fs = await import("node:fs");
  const ev = (await admin("POST", "/admin/events", { name: "Missing template", event_date: dayToday() })).data.event;
  const withTemplate = await uploadTemplate(ev.id);
  const g = await newGuest(ev.id, "Lost Template");
  fs.unlinkSync(path.join(serverDir, withTemplate.card_template_path));

  const card = await getBinary(`/admin/guests/${g.id}/card.jpg`);
  assert.equal(card.status, 409);
  assert.match(card.buf.toString(), /upload it again/i);
  const zip = await getBinary(`/admin/events/${ev.id}/cards.zip`);
  assert.equal(zip.status, 409);
  await admin("DELETE", `/admin/events/${ev.id}`);
});

test("health check answers without logging in", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

// ---------- Live updates ----------
function openLive(url, token) {
  const controller = new AbortController();
  const messages = [];
  const state = { status: null, ended: false };
  (async () => {
    try {
      const res = await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      state.status = res.status;
      if (!res.ok) return;
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (line) messages.push(JSON.parse(line.slice(5)));
        }
      }
      state.ended = true;
    } catch { /* closed by the test */ }
  })();
  const waitFor = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = messages.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };
  return { messages, state, waitFor, close: () => controller.abort() };
}
async function connected(url, token) {
  const live = openLive(url, token);
  assert.ok(await live.waitFor((m) => m.type === "hello"), "the live connection should open");
  return live;
}

test("live: you need to be logged in, and the right kind of login", async () => {
  const nobody = openLive(`/admin/events/${event.id}/stream`, "nope");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(nobody.state.status, 401);
  const wrongRole = openLive(`/admin/events/${event.id}/stream`, scannerToken);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(wrongRole.state.status, 401);
  const noScanner = openLive("/scan/stream", adminToken);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(noScanner.state.status, 401);
});

test("live: a scan reaches the admin list and the door counters immediately", async () => {
  const adminLive = await connected(`/admin/events/${event.id}/stream`, adminToken);
  const doorLive = await connected("/scan/stream", scannerToken);
  const g = await newGuest(event.id, "Live Person", "double");
  await adminLive.waitFor((m) => m.type === "refresh"); // adding a guest tells the list to reload

  const r = await scan("POST", "/scan/checkin", { code: g.code, count: 1 });
  assert.equal(r.data.status, "checked_in");

  const got = await adminLive.waitFor((m) => m.type === "checkin" && m.code === g.code);
  assert.ok(got, "the admin list should hear about the scan");
  assert.equal(got.admitted_count, 1);
  assert.equal(got.capacity, 2);
  assert.ok(got.checked_in_at);

  const stats = await doorLive.waitFor((m) => m.type === "stats");
  assert.ok(stats, "door staff should get fresh counters");
  assert.ok(stats.arrived >= 1 && stats.total >= stats.arrived && stats.cards >= 1);
  assert.equal(doorLive.messages.some((m) => m.code), false, "door staff never receive guest codes");

  adminLive.close(); doorLive.close();
});

test("live: undo, edit, delete and import all update the list", async () => {
  const adminLive = await connected(`/admin/events/${event.id}/stream`, adminToken);
  const g = await newGuest(event.id, "Undo Person");
  await scan("POST", "/scan/checkin", { code: g.code, count: 1 });
  await adminLive.waitFor((m) => m.type === "checkin" && m.code === g.code);

  await admin("POST", `/admin/guests/${g.id}/undo-checkin`);
  const undo = await adminLive.waitFor((m) => m.type === "undo" && m.code === g.code);
  assert.ok(undo);
  assert.equal(undo.admitted_count, 0);
  assert.equal(undo.checked_in_at, null);

  const before = adminLive.messages.filter((m) => m.type === "refresh").length;
  await admin("PUT", `/admin/guests/${g.id}`, { full_name: "Undo Renamed", card_type: "single" });
  await admin("DELETE", `/admin/guests/${g.id}`);
  await importCsv(event.id, "full_name\nLive Import One\n");
  for (let i = 0; i < 40 && adminLive.messages.filter((m) => m.type === "refresh").length < before + 3; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(adminLive.messages.filter((m) => m.type === "refresh").length >= before + 3, "edit, delete and import should each trigger a reload");
  adminLive.close();
});

test("live: another event's scans never show up", async () => {
  const other = (await admin("POST", "/admin/events", { name: "Other live", event_date: dayToday() })).data.event;
  const otherLive = await connected(`/admin/events/${other.id}/stream`, adminToken);
  const g = await newGuest(event.id, "Not For Other");
  await scan("POST", "/scan/checkin", { code: g.code, count: 1 });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(otherLive.messages.filter((m) => m.type !== "hello").length, 0);
  otherLive.close();
  await admin("DELETE", `/admin/events/${other.id}`);
});

test("live: switching access off ends the door staff's live connection", async () => {
  const doorLive = await connected("/scan/stream", scannerToken);
  const adminLive = await connected(`/admin/events/${event.id}/stream`, adminToken);
  await admin("POST", `/admin/events/${event.id}/access`, { active: false });
  assert.ok(await doorLive.waitFor((m) => m.type === "closed"), "the door connection should be told it was closed");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(doorLive.state.ended, true);
  assert.equal(adminLive.state.ended, false, "the admin keeps their live connection");
  await admin("POST", `/admin/events/${event.id}/access`, { active: true });
  adminLive.close();
});
