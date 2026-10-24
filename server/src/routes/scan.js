import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireScanner } from "../middleware/auth.js";
import { normalizeCode, capacityOf } from "../utils.js";
import { openStream, publish } from "../realtime.js";

const router = Router();
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
router.use(requireScanner);

const pub = (g) => {
  const capacity = capacityOf(g.card_type);

  return {
    code: g.code,
    full_name: g.full_name,
    phone: g.phone,
    category: g.category,
    table_no: g.table_no,
    card_type: g.card_type,
    capacity,
    admitted_count: g.admitted_count,
    remaining: Math.max(0, capacity - g.admitted_count),
    checked_in_at: g.checked_in_at,
  };
};

async function stats(eventId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cards,
            COALESCE(SUM(IF(card_type = 'double', 2, 1)), 0) AS total,
            COALESCE(SUM(admitted_count), 0) AS arrived
     FROM guests WHERE event_id = ?`,
    [eventId],
  );

  return {
    cards: Number(rows[0].cards),
    total: Number(rows[0].total),
    arrived: Number(rows[0].arrived),
  };
}

/** status: ok (nobody in yet) | partial (some in, spots left) | already (card fully used)
 *          not_found | wrong_event */
async function findGuest(rawCode, eventId) {

  const code = normalizeCode(rawCode);

  if (!code) return { status: "not_found" };
  const [rows] = await pool.query("SELECT * FROM guests WHERE code = ?", [
    code,
  ]);

  const g = rows[0];

  if (!g) return { status: "not_found", code };

  // ID exists but belongs to another event: reveal nothing about the guest
  if (g.event_id !== eventId) return { status: "wrong_event", code };

  const guest = pub(g);
  const status =
    guest.remaining <= 0
      ? "already"
      : guest.admitted_count > 0
        ? "partial"
        : "ok";
  return { status, code, guest };
}

// Live counters for the door staff (kept open by the app; see realtime.js)
router.get("/stream", (req, res) => openStream(req, res, req.event.id, "scanner"));

// Tell everyone watching, AFTER the scanner already has its answer (so it never slows a scan down)
async function announceCheckin(eventId, guest) {
  try {
    publish(
      eventId,
      {
        type: "checkin",
        code: guest.code,
        admitted_count: guest.admitted_count,
        checked_in_at: guest.checked_in_at,
        capacity: guest.capacity,
      },
      null,
    );
    publish(eventId, null, { type: "stats", ...(await stats(eventId)) });
  } catch (e) {
    console.warn("[live] could not announce a check-in:", e.message);
  }
}

router.get("/event", async (req, res, next) => {
  try {
    const { name, event_date, venue } = req.event;
    res.json({ name, event_date, venue, ...(await stats(req.event.id)) });
  } catch (e) {
    next(e);
  }
});

// Look up only (does not admit anyone)
router.post("/lookup", async (req, res, next) => {
  try {
    res.json(await findGuest(req.body?.code, req.event.id));

  } catch (e) {
    next(e);
  }
});

// Admit `count` people on this card. Enforced in SQL, so a card can never admit more than its capacity,
// even if two scanners act at the same moment.
router.post("/checkin", async (req, res, next) => {
  try {
    const count = Math.floor(Number(req.body?.count ?? 1));

    if (!Number.isInteger(count) || count < 1)
      return res.status(400).json({ error: "Invalid number of people" });

    const found = await findGuest(req.body?.code, req.event.id);

    if (!["ok", "partial"].includes(found.status)) return res.json(found);
    
    if (count > found.guest.remaining)
      return res.json({ ...found, status: "too_many" });

    const [r] = await pool.query(
      `UPDATE guests
         SET admitted_count = admitted_count + ?, checked_in_at = COALESCE(checked_in_at, NOW())
       WHERE code = ? AND event_id = ? AND admitted_count + ? <= IF(card_type = 'double', 2, 1)`,
      [count, found.code, req.event.id, count],
    );

    const after = await findGuest(found.code, req.event.id);
    if (r.affectedRows === 1) {
      res.json({ ...after, status: "checked_in", admitted_now: count });
      announceCheckin(req.event.id, after.guest);
      return;
    }
    res.json(
      after.status === "already" ? after : { ...after, status: "too_many" },
    );
  } catch (e) {
    next(e);
  }
});

export default router;
