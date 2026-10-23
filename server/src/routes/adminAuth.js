import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { signToken, requireAdmin } from '../middleware/auth.js';

const router = Router();
const limiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  limit: 20, 
  standardHeaders: true, 
  legacyHeaders: false 
});

router.post('/login', limiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [String(email || '').trim().toLowerCase()]);
    const admin = rows[0];
    if (!admin || !(await bcrypt.compare(String(password || ''), admin.password_hash))) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    res.json({ token: signToken({ role: 'admin', id: admin.id }, '12h'), email: admin.email });
  } catch (e) { next(e); }
});

router.get('/me', requireAdmin, (req, res) => res.json({ ok: true }));

export default router;
