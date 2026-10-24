import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import archiver from "archiver";
import QRCode from "qrcode";
import { parse } from "csv-parse/sync";
import { pool } from "../db.js";
import { config } from "../config.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  generateCode,
  clean,
  capacityOf,
  parseCardType,
  normName,
  normPhone,
} from "../utils.js";
import { renderCard, cardFileName } from "../card.js";
import { openStream, publish } from "../realtime.js";

const router = Router();
router.use(requireAdmin);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const QR_OPTS = { width: 480, margin: 2, errorCorrectionLevel: "M" };
const slug = (s) =>
  String(s || "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "guest";
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const presentGuest = (g) => ({
  id: g.id,
  code: g.code,
  event_id: g.event_id,
  full_name: g.full_name,
  phone: g.phone,
  category: g.category,
  table_no: g.table_no,
  card_type: g.card_type,
  capacity: capacityOf(g.card_type),
  admitted_count: g.admitted_count,
  checked_in_at: g.checked_in_at,
});

async function eventExists(id) {
  const [rows] = await pool.query("SELECT id, name, card_template_path FROM events WHERE id = ?", [
    id,
  ]);
  return rows[0];
}

async function guestCount(eventId) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS c FROM guests WHERE event_id = ?",
    [eventId],
  );
  return Number(rows[0].c);
}

/** Inserts a guest with a fresh unique ID (retries on the very rare collision) */
export async function insertGuest(
  eventId,
  { full_name, phone, category, table_no, card_type },
) {
  for (let i = 0; i < 25; i++) {
    const code = generateCode();
    try {
      const [r] = await pool.query(
        "INSERT INTO guests (code, event_id, full_name, phone, category, table_no, card_type) VALUES (?,?,?,?,?,?,?)",
        [code, eventId, full_name, phone, category, table_no, card_type],
      );
      return { id: r.insertId, code };
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") continue;
      throw e;
    }
  }
  throw new Error("Could not generate a unique ID");
}

function readGuest(body = {}) {
  const full_name = clean(body.full_name);
  if (!full_name) return { error: "Full name is required" };
  return {
    guest: {
      full_name,
      phone: clean(body.phone, 50),
      category: clean(body.category, 80),
      table_no: clean(body.table_no, 40),
      card_type: parseCardType(body.card_type),
    },
  };
}

// Live updates for the admin guest list (kept open by the app; see realtime.js)
router.get("/events/:id/stream", async (req, res, next) => {
  try {
    if (!(await eventExists(req.params.id)))
      return res.status(404).json({ error: "Event not found" });
    openStream(req, res, req.params.id, "admin");
  } catch (e) {
    next(e);
  }
});

// "Something about the guest list changed: reload it" (add, edit, delete, import)
const announceChange = (eventId) => publish(eventId, { type: "refresh" }, { type: "refresh" });

router.get("/events/:id/guests", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM guests WHERE event_id = ? ORDER BY full_name ASC",
      [req.params.id],
    );
    res.json(rows.map(presentGuest));
  } catch (e) {
    next(e);
  }
});

router.delete("/events/:id/guests", async (req, res, next) => {
  try {
    const ids = req.body?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > config.maxGuests ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    ) {
      return res.status(400).json({ error: "A valid list of guest IDs is required" });
    }

    if (!(await eventExists(req.params.id))) {
      return res.status(404).json({ error: "Event not found" });
    }

    const [result] = await pool.query(
      "DELETE FROM guests WHERE event_id = ? AND id IN (?)",
      [req.params.id, [...new Set(ids)]],
    );
    if (result.affectedRows) announceChange(req.params.id);
    res.json({ ok: true, deleted: result.affectedRows });
  } catch (e) {
    next(e);
  }
});

router.post("/events/:id/guests", async (req, res, next) => {
  try {
    if (!(await eventExists(req.params.id)))
      return res.status(404).json({ error: "Event not found" });
    const { error, guest } = readGuest(req.body);
    if (error) return res.status(400).json({ error });
    if ((await guestCount(req.params.id)) >= config.maxGuests) {
      return res
        .status(400)
        .json({
          error: `Limit of ${config.maxGuests} guests per event reached`,
        });
    }
    const { id, code } = await insertGuest(req.params.id, guest);
    announceChange(req.params.id);
    res.status(201).json({ id, code, ...guest });
  } catch (e) {
    next(e);
  }
});

router.put("/guests/:id", async (req, res, next) => {
  try {
    const { error, guest } = readGuest(req.body);
    if (error) return res.status(400).json({ error });
    const [cur] = await pool.query(
      "SELECT admitted_count, event_id FROM guests WHERE id = ?",
      [req.params.id],
    );
    if (!cur[0]) return res.status(404).json({ error: "Guest not found" });
    if (cur[0].admitted_count > capacityOf(guest.card_type)) {
      return res
        .status(400)
        .json({
          error: `${cur[0].admitted_count} people already entered on this card. Undo the check-in before changing it to Single.`,
        });
    }
    await pool.query(
      "UPDATE guests SET full_name=?, phone=?, category=?, table_no=?, card_type=? WHERE id=?",
      [
        guest.full_name,
        guest.phone,
        guest.category,
        guest.table_no,
        guest.card_type,
        req.params.id,
      ],
    );
    announceChange(cur[0].event_id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/guests/:id", async (req, res, next) => {
  try {
    const [cur] = await pool.query("SELECT event_id FROM guests WHERE id = ?", [req.params.id]);
    await pool.query("DELETE FROM guests WHERE id = ?", [req.params.id]);
    if (cur[0]) announceChange(cur[0].event_id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/guests/:id/undo-checkin", async (req, res, next) => {
  try {
    const [cur] = await pool.query("SELECT code, event_id, card_type FROM guests WHERE id = ?", [req.params.id]);
    await pool.query(
      "UPDATE guests SET checked_in_at = NULL, admitted_count = 0 WHERE id = ?",
      [req.params.id],
    );
    if (cur[0]) {
      publish(
        cur[0].event_id,
        { type: "undo", code: cur[0].code, admitted_count: 0, checked_in_at: null, capacity: capacityOf(cur[0].card_type) },
        { type: "refresh" },
      );
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- CSV import ----------
const HEADER_MAP = {
  full_name: "full_name",
  fullname: "full_name",
  name: "full_name",
  guest: "full_name",
  guest_name: "full_name",
  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
  tel: "phone",
  telephone: "phone",
  category: "category",
  group: "category",
  card_type: "card_type",
  card: "card_type",
  type: "card_type",
  ticket: "card_type",
  table: "table_no",
  table_no: "table_no",
  table_number: "table_no",
  seat: "table_no",
};

// Events that are being imported right now (stops a double-click from importing twice)
const importing = new Set();

router.post(
  "/events/:id/import",
  upload.single("file"),
  
  async (req, res, next) => {
    const eventId = String(req.params.id);
    let locked = false;
    try {

      if (!(await eventExists(eventId)))
        return res.status(404).json({ error: "Event not found" });

      if (!req.file)
        return res.status(400).json({ error: "Please choose a CSV file" });

      let records;
      try {
        records = parse(req.file.buffer, {
          columns: (headers) =>
            headers.map(
              (h) =>
                HEADER_MAP[
                  String(h)
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                ] || null,
            ),
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: true,
        });
      } catch {
        return res
          .status(400)
          .json({
            error: "Could not read that file. Please upload a valid CSV.",
          });
      }
      if (!records.length)
        return res.status(400).json({ error: "The file has no rows" });
      if (!("full_name" in records[0])) {
        return res
          .status(400)
          .json({
            error:
              'The first row must contain a "full_name" (or "name") column',
          });
      }

      if (importing.has(eventId)) {
        return res
          .status(409)
          .json({
            error:
              "An import for this event is already running. Please wait a moment.",
          });
      }
      importing.add(eventId);
      locked = true;

      // Everyone already on this event's list, grouped by name, so duplicates are skipped
      const [existingRows] = await pool.query(
        "SELECT code, full_name, phone FROM guests WHERE event_id = ?",
        [eventId],
      );

      const seen = new Map(); // normalised name -> [{ phone, code }]

      const remember = (g, code) => {
        const key = normName(g.full_name);

        if (!seen.has(key)) seen.set(key, []);

        seen.get(key).push({ phone: normPhone(g.phone), code });
      };

      existingRows.forEach((g) => remember(g, g.code));
      // same name AND (same phone, or a phone is missing on either side)
      const findDuplicate = (g) => {
        const phone = normPhone(g.phone);
        return (seen.get(normName(g.full_name)) || []).find(
          (x) => !phone || !x.phone || x.phone === phone,
        );
      };

      const skipped = [];
      const fresh = [];

      for (let i = 0; i < records.length; i++) {
        const { error, guest } = readGuest(records[i]);
        if (error) {
          skipped.push({ row: i + 2, reason: error });
          continue;
        }

        const dup = findDuplicate(guest);
        if (dup) {
          skipped.push({
            row: i + 2,
            reason: dup.code
              ? `Already on the list (ID ${dup.code})`
              : "Appears more than once in this file",
          });
          continue;
        }

        remember(guest, null); // so repeats inside the same file are caught too
        fresh.push(guest);
      }

      // The limit only counts the NEW guests, so re-importing the same file never trips it
      if (existingRows.length + fresh.length > config.maxGuests) {
        return res
          .status(400)
          .json({
            error: `This would exceed the ${config.maxGuests}-guest limit (you have ${existingRows.length}, the file adds ${fresh.length} new).`,
          });
      }

      for (const guest of fresh) await insertGuest(eventId, guest);
      if (fresh.length) announceChange(eventId);
      res.json({ imported: fresh.length, skipped });
    } catch (e) {
      next(e);
    } finally {
      if (locked) importing.delete(eventId);
    }
  },
);

// ---------- QR codes (the QR contains ONLY the ID) ----------
router.get("/guests/:id/qr.png", async (req, res, next) => {
  try {
    const [rows] = await pool.query("SELECT code FROM guests WHERE id = ?", [
      req.params.id,
    ]);

    if (!rows[0]) return res.status(404).json({ error: "Guest not found" });

    res.type("png").send(await QRCode.toBuffer(rows[0].code, QR_OPTS));

  } catch (e) {
    next(e);
  }
});

router.get("/events/:id/qr.zip", async (req, res, next) => {
  try {
    const event = await eventExists(req.params.id);

    if (!event) return res.status(404).json({ error: "Event not found" });
    const [guests] = await pool.query(
      "SELECT code, full_name FROM guests WHERE event_id = ? ORDER BY full_name",
      [req.params.id],
    );

    res.attachment(`${slug(event.name)}_qr_codes.zip`);

    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("error", next);
    archive.pipe(res);

    for (const g of guests) {
      archive.append(await QRCode.toBuffer(g.code, QR_OPTS), {
        name: `${g.code}_${slug(g.full_name)}.png`,
      });
    }
    await archive.finalize();
  } catch (e) {
    next(e);
  }
});

// ---------- Invitation cards (design + guest name + QR) ----------
router.get("/guests/:id/card.jpg", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT g.code, g.full_name, e.card_template_path, e.card_name_x, e.card_name_y, e.card_name_width, e.card_name_font_size, e.card_name_font_family, e.card_name_font_variant, e.card_qr_x, e.card_qr_y, e.card_qr_size FROM guests g LEFT JOIN events e ON e.id = g.event_id WHERE g.id = ?",
      [req.params.id],
    );

    if (!rows[0]) return res.status(404).json({ error: "Guest not found" });
    if (!rows[0].card_template_path) {
      return res.status(400).json({ error: "Upload a card template for this event before generating cards" });
    }

    // ?w=640 gives a small, quick picture for on-screen previews; without it you get the full-size card
    const width = Math.round(Number(req.query.w));
    const maxWidth = Number.isFinite(width) && width >= 200 && width <= 2400 ? width : undefined;

    const jpg = await renderCard({
      maxWidth,
      name: rows[0].full_name,
      code: rows[0].code,
      templatePath: rows[0].card_template_path ? path.resolve(process.cwd(), rows[0].card_template_path) : null,
      layout: {
        card_name_x: rows[0].card_name_x,
        card_name_y: rows[0].card_name_y,
        card_name_width: rows[0].card_name_width,
        card_name_font_size: rows[0].card_name_font_size,
        card_name_font_family: rows[0].card_name_font_family,
        card_name_font_variant: rows[0].card_name_font_variant,
        card_qr_x: rows[0].card_qr_x,
        card_qr_y: rows[0].card_qr_y,
        card_qr_size: rows[0].card_qr_size,
      },
    });

    res.set("Cache-Control", "no-store");

    if (req.query.download) res.attachment(cardFileName(rows[0]));

    res.type("jpeg").send(jpg);
  } catch (e) {
    if (e.code === "TEMPLATE_MISSING") return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.get("/events/:id/cards.zip", async (req, res, next) => {
  try {
    const event = await eventExists(req.params.id);

    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.card_template_path) {
      return res.status(400).json({ error: "Upload a card template for this event before generating cards" });
    }

    if (!fs.existsSync(path.resolve(process.cwd(), event.card_template_path))) {
      return res.status(409).json({ error: "This event's card template file is no longer on the server. Please open “Card template” and upload it again." });
    }

    const [guests] = await pool.query(
      "SELECT g.code, g.full_name, e.card_template_path, e.card_name_x, e.card_name_y, e.card_name_width, e.card_name_font_size, e.card_name_font_family, e.card_name_font_variant, e.card_qr_x, e.card_qr_y, e.card_qr_size FROM guests g LEFT JOIN events e ON e.id = g.event_id WHERE g.event_id = ? ORDER BY g.full_name",
      [req.params.id],
    );

    res.attachment(`${slug(event.name)}_invitation_cards.zip`);

    const archive = archiver("zip", { store: true });
    archive.on("error", next);
    archive.pipe(res);

    for (const g of guests) {
      if (res.destroyed) break;
      const jpg = await renderCard({
        useCache: false,
        name: g.full_name,
        code: g.code,
        templatePath: g.card_template_path ? path.resolve(process.cwd(), g.card_template_path) : null,
        layout: {
          card_name_x: g.card_name_x,
          card_name_y: g.card_name_y,
          card_name_width: g.card_name_width,
          card_name_font_size: g.card_name_font_size,
          card_name_font_family: g.card_name_font_family,
          card_name_font_variant: g.card_name_font_variant,
          card_qr_x: g.card_qr_x,
          card_qr_y: g.card_qr_y,
          card_qr_size: g.card_qr_size,
        },
      });
      const added = new Promise((resolve) => archive.once("entry", resolve));
      archive.append(jpg, { name: cardFileName(g) });
      await added;
    }
    await archive.finalize();

  } catch (e) {
    next(e);
  }
});

router.get("/events/:id/export.csv", async (req, res, next) => {
  try {
    const event = await eventExists(req.params.id);

    if (!event) return res.status(404).json({ error: "Event not found" });
    const [guests] = await pool.query(
      "SELECT * FROM guests WHERE event_id = ? ORDER BY full_name",
      [req.params.id],
    );

    const lines = [
      [
        "id",
        "full_name",
        "phone",
        "category",
        "table_no",
        "card_type",
        "admitted_count",
        "checked_in_at",
      ].join(","),
    ];

    for (const g of guests)
      lines.push(
        [
          g.code,
          g.full_name,
          g.phone,
          g.category,
          g.table_no,
          g.card_type,
          g.admitted_count,
          g.checked_in_at,
        ]
          .map(csvCell)
          .join(","),
      );
    res
      .attachment(`${slug(event.name)}_guests.csv`)
      .type("text/csv")
      .send("\uFEFF" + lines.join("\n"));
  } catch (e) {
    next(e);
  }
});

export default router;
