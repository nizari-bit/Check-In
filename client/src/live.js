// Live updates from the server (see server/src/realtime.js).
// Keeps one small connection open, reconnects by itself, and tells the page when to catch up.
import { adminSession, scannerSession } from './api.js';

/**
 * openLive('/admin/events/5/stream', 'admin', { onMessage, onStatus, onOpen })
 *   onMessage(m)  - a change arrived (m.type: checkin, undo, refresh, stats...)
 *   onStatus(s)   - 'connecting' | 'live' | 'reconnecting' | 'denied'
 *   onOpen()      - the connection just (re)opened: reload anything you might have missed
 * Returns a function that stops it.
 */
export function openLive(path, auth, { onMessage, onStatus, onOpen } = {}) {
  let stopped = false;
  let controller = null;
  let watchdog = null;
  let retryMs = 1000;

  const connect = async () => {
    if (stopped) return;
    controller = new AbortController();
    const token = auth === 'admin' ? adminSession.get() : scannerSession.get()?.token;
    onStatus?.(retryMs > 1000 ? 'reconnecting' : 'connecting');
    try {
      const res = await fetch(`/api${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if ([401, 403, 410].includes(res.status)) { // logged out or access closed: the normal pages handle that
        stopped = true;
        onStatus?.('denied');
        return;
      }
      if (!res.ok || !res.body) throw new Error('not open');

      retryMs = 1000;
      onStatus?.('live');
      onOpen?.();

      // The server sends a small "ping" every 20 s. If nothing arrives for 50 s the connection is dead: reconnect.
      const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => controller.abort(), 50000); };
      arm();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue; // a ping
          let message;
          try { message = JSON.parse(line.slice(5)); } catch { continue; }
          if (message.type === 'closed') { stopped = true; onStatus?.('denied'); return; }
          if (message.type !== 'hello') onMessage?.(message);
        }
      }
    } catch { /* dropped or aborted: fall through and reconnect */ }
    finally { clearTimeout(watchdog); }

    if (!stopped) {
      onStatus?.('reconnecting');
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    }
  };

  connect();
  return () => { stopped = true; clearTimeout(watchdog); controller?.abort(); };
}
