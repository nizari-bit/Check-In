// Live updates (Server-Sent Events): the browser keeps one small connection open and the server
// pushes a message the moment something changes (a scan, an undo, a new guest...).
// This lives in the server's memory, which is right for a single server (Render's normal setup).
const HEARTBEAT_MS = 20000;   // a tiny "still here" line so proxies don't close an idle connection
const MAX_CLIENTS_PER_EVENT = 100;

const channels = new Map();   // eventId -> Set of { res, role }

const key = (eventId) => String(eventId);
const send = (res, text) => { try { res.write(text); } catch { /* connection already gone */ } };

/** Keeps this request open as a live stream. role: 'admin' | 'scanner' */
export function openStream(req, res, eventId, role) {
  const set = channels.get(key(eventId)) || new Set();
  if (set.size >= MAX_CLIENTS_PER_EVENT) return res.status(429).json({ error: 'Too many live connections for this event' });
  channels.set(key(eventId), set);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',   // tell nginx-style proxies not to hold the messages back
  });
  res.flushHeaders?.();
  req.socket?.setTimeout?.(0);
  req.socket?.setKeepAlive?.(true);

  send(res, 'retry: 3000\n\n');
  send(res, `data: ${JSON.stringify({ type: 'hello' })}\n\n`);

  const client = { res, role };
  set.add(client);
  const beat = setInterval(() => send(res, ': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(beat);
    set.delete(client);
    if (!set.size && channels.get(key(eventId)) === set) channels.delete(key(eventId));
  });
}

/**
 * Sends a message to everyone watching this event.
 * Admins get `forAdmin`; scanners get `forScanner` (less detail: scanners only need the counters).
 */
export function publish(eventId, forAdmin, forScanner = forAdmin) {
  const set = channels.get(key(eventId));
  if (!set) return;
  const adminText = forAdmin ? `data: ${JSON.stringify(forAdmin)}\n\n` : null;
  const scannerText = forScanner ? `data: ${JSON.stringify(forScanner)}\n\n` : null;
  for (const client of set) {
    const text = client.role === 'admin' ? adminText : scannerText;
    if (text) send(client.res, text);   // pass null to skip an audience
  }
}

/** Ends the live connections of an event (role 'scanner' = only door staff, otherwise everyone) */
export function closeStreams(eventId, role = null) {
  const set = channels.get(key(eventId));
  if (!set) return;
  for (const client of [...set]) {
    if (role && client.role !== role) continue;
    send(client.res, `data: ${JSON.stringify({ type: 'closed' })}\n\n`);
    try { client.res.end(); } catch { /* ignore */ }
    set.delete(client);
  }
}

export const liveClientCount = (eventId) => channels.get(key(eventId))?.size || 0;
