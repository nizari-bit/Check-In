import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { config } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { newToken, newPin, clean, eventExpiry, isEventAccessOpen } from '../utils.js';
import { GoogleFontsError, listGoogleFonts } from '../googleFonts.js';
import { closeStreams } from '../realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../assets/card');
const legacyUploadDir = path.resolve(__dirname, '../../uploads/card-templates');
fs.mkdirSync(uploadDir, { recursive: true });

const router = Router();
router.use(requireAdmin);

function removeTemplateFile(relativePath) {
  if (!relativePath) return;
  const resolvedPath = path.resolve(process.cwd(), relativePath);
  const allowedDirs = [uploadDir, legacyUploadDir];
  if (!allowedDirs.some((dir) => resolvedPath.startsWith(`${dir}${path.sep}`))) return;
  if (fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);
}

const templateUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `event-${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname || '').toLowerCase());
    cb(ok ? null : new Error('Only JPG and PNG images are allowed'), ok);
  },
});

const present = (e) => {
  const { pin_hash, ...rest } = e;
  return {
    ...rest,
    card_template_path: e.card_template_path || null,
    card_name_x: e.card_name_x == null ? null : Number(e.card_name_x),
    card_name_y: e.card_name_y == null ? null : Number(e.card_name_y),
    card_name_width: e.card_name_width == null ? null : Number(e.card_name_width),
    card_name_font_size: e.card_name_font_size == null ? null : Number(e.card_name_font_size),
    card_qr_x: e.card_qr_x == null ? null : Number(e.card_qr_x),
    card_qr_y: e.card_qr_y == null ? null : Number(e.card_qr_y),
    card_qr_size: e.card_qr_size == null ? null : Number(e.card_qr_size),
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

router.get('/fonts', async (_req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=3600').json(await listGoogleFonts());
  } catch (error) {
    // Short and friendly for people; the technical reason is already in the server log
    const known = error instanceof GoogleFontsError;
    if (!known) console.error(error);
    res.set('Cache-Control', 'no-store').status(known ? error.status : 503).json({
      error: known ? error.message : new GoogleFontsError('unavailable').message,
      code: known ? error.code : 'unavailable',
    });
  }
});

async function loadEvent(id) {
  const [rows] = await pool.query(`${SELECT_WITH_STATS} WHERE e.id = ? GROUP BY e.id`, [id]);
  return rows[0];
}

function readBody(body = {}) {
  const name = clean(body.name);
  const date = clean(body.event_date, 10);

  if (!name) return { error: 'Event name is required' };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'A valid event date is required' };
  }

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
  } catch (e) { 
    next(e); 
  }
});

router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await loadEvent(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(present(event));
  } catch (e) { 
    next(e); 
  }
});

router.put('/events/:id', async (req, res, next) => {
  try {
    const { error, values } = readBody(req.body);

    if (error) {
      return res.status(400).json({ error });
    }

    await pool.query(
      `UPDATE events SET name=?, event_date=?, venue=?, host_name=?, host_phone=?, host_email=?, notes=? WHERE id=?`,
      [...values, req.params.id]
    );

    const event = await loadEvent(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(present(event));
  } catch (e) {
     next(e); 
    }
});

router.get('/events/:id/card-template', async (req, res, next) => {
  try {
    const event = await loadEvent(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!event.card_template_path) return res.status(404).json({ error: 'Upload a card template for this event' });
    const templatePath = path.resolve(process.cwd(), event.card_template_path);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Card template not found' });
    res.set('Cache-Control', 'no-store').sendFile(templatePath);
  } catch (e) {
    next(e);
  }
});

router.post('/events/:id/card-template', templateUpload.single('image'), async (req, res, next) => {
  try {
    const event = await loadEvent(req.params.id);

    if (!event) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Event not found' });
    }
    if (!req.file && !event.card_template_path) {
      return res.status(400).json({ error: 'Upload a template image for this event first' });
    }

    const nextLayout = {
      name_x: Number(req.body.name_x ?? event.card_name_x ?? 200),
      name_y: Number(req.body.name_y ?? event.card_name_y ?? 170),
      name_width: Number(req.body.name_width ?? event.card_name_width ?? 180),
      name_font_size: Number(req.body.name_font_size ?? event.card_name_font_size ?? 18),
      qr_x: Number(req.body.qr_x ?? event.card_qr_x ?? 180),
      qr_y: Number(req.body.qr_y ?? event.card_qr_y ?? 415),
      qr_size: Number(req.body.qr_size ?? event.card_qr_size ?? 80),
    };
    const fontFamily = clean(req.body.name_font_family, 100);
    const fontVariant = clean(req.body.name_font_variant, 32);
    if ((fontFamily && !fontVariant) || (!fontFamily && fontVariant)) {
      return res.status(400).json({ error: 'Choose both a Google font and its style' });
    }
    if (!Number.isFinite(nextLayout.name_font_size) || nextLayout.name_font_size < 8 || nextLayout.name_font_size > 160) {
      return res.status(400).json({ error: 'Guest name font size must be between 8 and 160 pixels' });
    }
    let warning = null;
    if (fontFamily) {
      let fonts = null;
      try {
        fonts = await listGoogleFonts();
      } catch (error) {
        if (!(error instanceof GoogleFontsError)) throw error;
        // The font list can't be reached right now. Save anyway: cards use the default font until the chosen one can be loaded.
        warning = 'Your settings were saved, but we could not check the chosen font just now. If it cannot be loaded, the default font is used on the cards.';
      }
      if (fonts) {
        const selectedFont = fonts.find((font) => font.family === fontFamily);
        if (!selectedFont?.variants.includes(fontVariant)) {
          return res.status(400).json({ error: 'That font style is not available. Please choose another style.' });
        }
      }
    }

    let relativePath = event.card_template_path;

    if (req.file) {
      relativePath = path.relative(path.resolve(process.cwd()), req.file.path).split(path.sep).join('/');
    }

    try {
      await pool.query(
        `UPDATE events SET card_template_path = ?, card_name_x = ?, card_name_y = ?, card_name_width = ?, card_name_font_size = ?, card_name_font_family = ?, card_name_font_variant = ?, card_qr_x = ?, card_qr_y = ?, card_qr_size = ? WHERE id = ?`,
        [
          relativePath,
          nextLayout.name_x,
          nextLayout.name_y,
          nextLayout.name_width,
          nextLayout.name_font_size,
          fontFamily,
          fontVariant,
          nextLayout.qr_x,
          nextLayout.qr_y,
          nextLayout.qr_size,
          req.params.id,
        ],
      );
    } catch (e) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      throw e;
    }

    if (req.file) {
      removeTemplateFile(event.card_template_path);
    }

    const updated = await loadEvent(req.params.id);
    res.json({ ok: true, event: present(updated), ...(warning ? { warning } : {}) });
  } catch (e) {
    next(e);
  }
});

router.post('/events/:id/card-template/reset', async (req, res, next) => {
  try {
    const event = await loadEvent(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (event.card_template_path) {
      removeTemplateFile(event.card_template_path);
    }

    await pool.query(
      `UPDATE events SET card_template_path = NULL, card_name_x = NULL, card_name_y = NULL, card_name_width = NULL, card_name_font_size = NULL, card_name_font_family = NULL, card_name_font_variant = NULL, card_qr_x = NULL, card_qr_y = NULL, card_qr_size = NULL WHERE id = ?`,
      [req.params.id],
    );

    res.json({ ok: true, event: present(await loadEvent(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.delete('/events/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT card_template_path FROM events WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
    removeTemplateFile(rows[0]?.card_template_path);
    closeStreams(req.params.id);

    res.json({ 
      ok: true 
    });
  } catch (e) { 
    next(e); 
  }
});

// Turn the host/scanner access on or off
router.post('/events/:id/access', async (req, res, next) => {
  try {
    await pool.query('UPDATE events SET access_active = ? WHERE id = ?', [req.body?.active ? 1 : 0, req.params.id]);
    if (!req.body?.active) closeStreams(req.params.id, 'scanner');

    res.json(present(await loadEvent(req.params.id)));

  } catch (e) {
     next(e); 
    }
});

// New PIN (shown once)
router.post('/events/:id/reset-pin', async (req, res, next) => {
  try {
    const pin = newPin();

    await pool.query('UPDATE events SET pin_hash = ? WHERE id = ?', [await bcrypt.hash(pin, 10), req.params.id]);

    res.json({ 
      event: present(await loadEvent(req.params.id)), 
      pin 
    });

  } catch (e) { 
    next(e); 
  }
});

// New link (old link stops working immediately)
router.post('/events/:id/regenerate-link', async (req, res, next) => {
  try {
    await pool.query('UPDATE events SET access_token = ? WHERE id = ?', [newToken(), req.params.id]);
    closeStreams(req.params.id, 'scanner');

    res.json(present(await loadEvent(req.params.id)));

  } catch (e) { 
    next(e); 
  }
});

export default router;
