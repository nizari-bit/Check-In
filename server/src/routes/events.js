import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { newToken, newPin, clean, eventExpiry, isEventAccessOpen } from '../utils.js';

const router = Router();
router.use(requireAdmin);

const present = (e) => {
  const { pin_hash, ...rest } = e;
  return {
    ...rest,
    total_cards: Number(e.total_cards || 0),
    total_guests: Number(e.total_guests || 0),
    arrived: Number(e.arrived || 0),
    access_active: !!e.access_active,
    access_url: `${config.publicUrl}/e/${e.access_token}`,
    access_open: isEventAccessOpen(e),
    access_expires_at: eventExpiry(e).toISOString(),
  };
};

const SELECT_WITH_STATS = `
  SELECT e.*, COUNT(g.id) AS total_cards,
         COALESCE(SUM(CASE WHEN g.card_type = 'double' THEN 2 ELSE 1 END), 0) AS total_guests,
         COALESCE(SUM(g.admitted_count), 0) AS arrived
  FROM events e LEFT JOIN guests g ON g.event_id = e.id`;

async function loadEvent(id) {
  const [rows] = await pool.query(`${SELECT_WITH_STATS} WHERE e.id = ? GROUP BY e.id`, [id]);
  return rows[0];
}

function readBody(body = {}) {
  const name = clean(body.name);
  const date = clean(body.event_date, 10);
  if (!name) return { error: 'Event name is required' };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'A valid event date is required' };
  return {
    values: [name, date, clean(body.venue, 255), clean(body.host_name), clean(body.host_phone, 50), clean(body.host_email), clean(body.notes, 5000)],
  };
}

router.get('/events', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`${SELECT_WITH_STATS} GROUP BY e.id ORDER BY e.event_date DESC, e.id DESC`);
    res.json(rows.map(present));
  } catch (e) { next(e); }
});

router.post('/events', async (req, res, next) => {
  try {
    const { error, values } = readBody(req.body);
    if (error) return res.status(400).json({ error });
    const pin = newPin();
    const [r] = await pool.query(
      `INSERT INTO events (name, event_date, venue, host_name, host_phone, host_email, notes, access_token, pin_hash)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [...values, newToken(), await bcrypt.hash(pin, 10)]
    );
    res.status(201).json({ event: present(await loadEvent(r.insertId)), pin });
  } catch (e) { next(e); }
});

router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await loadEvent(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(present(event));
  } catch (e) { next(e); }
});

router.put('/events/:id', async (req, res, next) => {
  try {
    const { error, values } = readBody(req.body);
    if (error) return res.status(400).json({ error });
    await pool.query(
      `UPDATE events SET name=?, event_date=?, venue=?, host_name=?, host_phone=?, host_email=?, notes=? WHERE id=?`,
      [...values, req.params.id]
    );
    const event = await loadEvent(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(present(event));
  } catch (e) { next(e); }
});

router.delete('/events/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Turn the host/scanner access on or off
router.post('/events/:id/access', async (req, res, next) => {
  try {
    await pool.query('UPDATE events SET access_active = ? WHERE id = ?', [req.body?.active ? 1 : 0, req.params.id]);
    res.json(present(await loadEvent(req.params.id)));
  } catch (e) { next(e); }
});

// New PIN (shown once)
router.post('/events/:id/reset-pin', async (req, res, next) => {
  try {
    const pin = newPin();
    await pool.query('UPDATE events SET pin_hash = ? WHERE id = ?', [await bcrypt.hash(pin, 10), req.params.id]);
    res.json({ event: present(await loadEvent(req.params.id)), pin });
  } catch (e) { next(e); }
});

// New link (old link stops working immediately)
router.post('/events/:id/regenerate-link', async (req, res, next) => {
  try {
    await pool.query('UPDATE events SET access_token = ? WHERE id = ?', [newToken(), req.params.id]);
    res.json(present(await loadEvent(req.params.id)));
  } catch (e) { next(e); }
});

export default router;
