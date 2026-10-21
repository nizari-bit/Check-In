import { Router } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import QRCode from 'qrcode';
import { parse } from 'csv-parse/sync';
import { pool } from '../db.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { generateCode, clean, capacityOf, parseCardType } from '../utils.js';

const router = Router();
router.use(requireAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const QR_OPTS = { width: 480, margin: 2, errorCorrectionLevel: 'M' };
const slug = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40) || 'guest';
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const presentGuest = (g) => ({
  id: g.id, code: g.code, event_id: g.event_id, full_name: g.full_name, phone: g.phone,
  category: g.category, table_no: g.table_no, card_type: g.card_type, capacity: capacityOf(g.card_type),
  admitted_count: g.admitted_count, checked_in_at: g.checked_in_at,
});

async function eventExists(id) {
  const [rows] = await pool.query('SELECT id, name FROM events WHERE id = ?', [id]);
  return rows[0];
}

async function guestCount(eventId) {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM guests WHERE event_id = ?', [eventId]);
  return Number(rows[0].c);
}

/** Inserts a guest with a fresh unique ID (retries on the very rare collision) */
export async function insertGuest(eventId, { full_name, phone, category, table_no, card_type }) {
  for (let i = 0; i < 25; i++) {
    const code = generateCode();
    try {
      const [r] = await pool.query(
        'INSERT INTO guests (code, event_id, full_name, phone, category, table_no, card_type) VALUES (?,?,?,?,?,?,?)',
        [code, eventId, full_name, phone, category, table_no, card_type]
      );
      return { id: r.insertId, code };
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') continue;
      throw e;
    }
  }
  throw new Error('Could not generate a unique ID');
}

function readGuest(body = {}) {
  const full_name = clean(body.full_name);
  if (!full_name) return { error: 'Full name is required' };
  return { guest: { full_name, phone: clean(body.phone, 50), category: clean(body.category, 80), table_no: clean(body.table_no, 40), card_type: parseCardType(body.card_type) } };
}

router.get('/events/:id/guests', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM guests WHERE event_id = ? ORDER BY full_name ASC', [req.params.id]);
    res.json(rows.map(presentGuest));
  } catch (e) { next(e); }
});

router.post('/events/:id/guests', async (req, res, next) => {
  try {
    if (!(await eventExists(req.params.id))) return res.status(404).json({ error: 'Event not found' });
    const { error, guest } = readGuest(req.body);
    if (error) return res.status(400).json({ error });
    if ((await guestCount(req.params.id)) >= config.maxGuests) {
      return res.status(400).json({ error: `Limit of ${config.maxGuests} guests per event reached` });
    }
    const { id, code } = await insertGuest(req.params.id, guest);
    res.status(201).json({ id, code, ...guest });
  } catch (e) { next(e); }
});

router.put('/guests/:id', async (req, res, next) => {
  try {
    const { error, guest } = readGuest(req.body);
    if (error) return res.status(400).json({ error });
    const [cur] = await pool.query('SELECT admitted_count FROM guests WHERE id = ?', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'Guest not found' });
    if (cur[0].admitted_count > capacityOf(guest.card_type)) {
      return res.status(400).json({ error: `${cur[0].admitted_count} people already entered on this card. Undo the check-in before changing it to Single.` });
    }
    await pool.query('UPDATE guests SET full_name=?, phone=?, category=?, table_no=?, card_type=? WHERE id=?',
      [guest.full_name, guest.phone, guest.category, guest.table_no, guest.card_type, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/guests/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM guests WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/guests/:id/undo-checkin', async (req, res, next) => {
  try {
    await pool.query('UPDATE guests SET checked_in_at = NULL, admitted_count = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- CSV import ----------
const HEADER_MAP = {
  full_name: 'full_name', fullname: 'full_name', name: 'full_name', guest: 'full_name', guest_name: 'full_name',
  phone: 'phone', phone_number: 'phone', mobile: 'phone', tel: 'phone', telephone: 'phone',
  category: 'category', group: 'category',
  card_type: 'card_type', card: 'card_type', type: 'card_type', ticket: 'card_type',
  table: 'table_no', table_no: 'table_no', table_number: 'table_no', seat: 'table_no',
};

router.post('/events/:id/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!(await eventExists(req.params.id))) return res.status(404).json({ error: 'Event not found' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a CSV file' });

    let records;
    try {
      records = parse(req.file.buffer, {
        columns: (headers) => headers.map((h) => HEADER_MAP[String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')] || null),
        skip_empty_lines: true, trim: true, bom: true, relax_column_count: true,
      });
    } catch {
      return res.status(400).json({ error: 'Could not read that file. Please upload a valid CSV.' });
    }
    if (!records.length) return res.status(400).json({ error: 'The file has no rows' });
    if (!('full_name' in records[0])) {
      return res.status(400).json({ error: 'The first row must contain a "full_name" (or "name") column' });
    }

    const existing = await guestCount(req.params.id);
    if (existing + records.length > config.maxGuests) {
      return res.status(400).json({ error: `This would exceed the ${config.maxGuests}-guest limit (you have ${existing}, file has ${records.length}).` });
    }

    let imported = 0;
    const skipped = [];
    for (let i = 0; i < records.length; i++) {
      const { error, guest } = readGuest(records[i]);
      if (error) { skipped.push({ row: i + 2, reason: error }); continue; }
      await insertGuest(req.params.id, guest);
      imported++;
    }
    res.json({ imported, skipped });
  } catch (e) { next(e); }
});

// ---------- QR codes (the QR contains ONLY the ID) ----------
router.get('/guests/:id/qr.png', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT code FROM guests WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Guest not found' });
    res.type('png').send(await QRCode.toBuffer(rows[0].code, QR_OPTS));
  } catch (e) { next(e); }
});

router.get('/events/:id/qr.zip', async (req, res, next) => {
  try {
    const event = await eventExists(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [guests] = await pool.query('SELECT code, full_name FROM guests WHERE event_id = ? ORDER BY full_name', [req.params.id]);
    res.attachment(`${slug(event.name)}_qr_codes.zip`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', next);
    archive.pipe(res);
    for (const g of guests) {
      archive.append(await QRCode.toBuffer(g.code, QR_OPTS), { name: `${g.code}_${slug(g.full_name)}.png` });
    }
    await archive.finalize();
  } catch (e) { next(e); }
});

router.get('/events/:id/export.csv', async (req, res, next) => {
  try {
    const event = await eventExists(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [guests] = await pool.query('SELECT * FROM guests WHERE event_id = ? ORDER BY full_name', [req.params.id]);
    const lines = [['id', 'full_name', 'phone', 'category', 'table_no', 'card_type', 'admitted_count', 'checked_in_at'].join(',')];
    for (const g of guests) lines.push([g.code, g.full_name, g.phone, g.category, g.table_no, g.card_type, g.admitted_count, g.checked_in_at].map(csvCell).join(','));
    res.attachment(`${slug(event.name)}_guests.csv`).type('text/csv').send('\uFEFF' + lines.join('\n'));
  } catch (e) { next(e); }
});

export default router;
