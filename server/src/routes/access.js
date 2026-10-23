import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { signToken } from '../middleware/auth.js';
import { isEventAccessOpen } from '../utils.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

// Extra protection: lock an event's login for 30 minutes after 10 wrong PINs
const failures = new Map();
const LOCK_MS = 13 * 60 * 1000;

async function findByToken(token) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;


  const [rows] = await pool.query('SELECT * FROM events WHERE access_token = ?', [token]);

  return rows[0] || null;
}

// Safe public info so the login page can show the event name
router.get('/:token', async (req, res, next) => {
  try {
    const event = await findByToken(req.params.token);

    if (!event) {
      return res.status(404).json({ error: 'This link is not valid' });
    }

    if (!isEventAccessOpen(event)) {
      return res.status(410).json({ error: 'This link is no longer active' });
    }

    res.json({ name: event.name, event_date: event.event_date, venue: event.venue });
  } catch (e) { next(e); }
});

router.post('/:token/login', limiter, async (req, res, next) => {
  try {
    const event = await findByToken(req.params.token);
    if (!event) {
      return res.status(404).json({ error: 'This link is not valid' });
    }
    if (!isEventAccessOpen(event)) {
      return res.status(410).json({ error: 'This link is no longer active' });
    }

    const f = failures.get(event.id);
    if (f && f.count >= 10 && Date.now() < f.until) {
      return res.status(429).json({ error: 'Too many wrong PINs. Please wait 15 minutes.' });
    }

    const ok = await bcrypt.compare(String(req.body?.pin || ''), event.pin_hash);
    if (!ok) {
      const count = (f && Date.now() < f.until ? f.count : 0) + 1;
      failures.set(event.id, { count, until: Date.now() + LOCK_MS });
      return res.status(401).json({ error: 'Wrong PIN' });
    }
    failures.delete(event.id);
    res.json({
      token: signToken({ role: 'scanner', eventId: event.id }, '16h'),
      event: { name: event.name, event_date: event.event_date },
    });
  } catch (e) { next(e); }
});

export default router;
