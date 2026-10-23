import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { isEventAccessOpen } from '../utils.js';

function readToken(req) {
  const h = req.headers.authorization || '';
  
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function signToken(payload, expiresIn) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

export function requireAdmin(req, res, next) {
  try {

    const data = jwt.verify(readToken(req), config.jwtSecret);

    if (data.role !== 'admin') throw new Error('bad role');

    req.admin = data;
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again' });
  }
}

/** Scanner sessions are re-checked against the DB on every request,
 *  so deactivating an event cuts access instantly. */
export async function requireScanner(req, res, next) {
  let data;
  try {
    data = jwt.verify(readToken(req), config.jwtSecret);

    if (data.role !== 'scanner') {
      throw new Error('bad role');
    }
  } catch {
    return res.status(401).json({ error: 'Please log in again' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM events WHERE id = ?', [data.eventId]);
    const event = rows[0];

    if (!event || !isEventAccessOpen(event)) {
      return res.status(403).json({ error: 'Access to this event is closed' });
    }

    req.event = event;
    next();
  } catch (e) {
    next(e);
  }
}
