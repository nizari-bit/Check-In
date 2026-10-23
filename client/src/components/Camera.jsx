import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Short "beep" generated with the Web Audio API (no audio file needed)
function makeBeeper() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { beep: () => {}, unlock: () => {}, close: () => {} };
  let ctx = null;
  const get = () => { if (!ctx) ctx = new Ctx(); return ctx; };

  const unlock = () => {
    try { const c = get(); if (c.state === 'suspended') c.resume(); } catch {}
  };

  const beep = () => {
    try {
      const c = get();
      if (c.state === 'suspended') c.resume();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1000;               // pitch in Hz
      const t = c.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);   // volume
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch {}
    try { navigator.vibrate?.(80); } catch {}   // small vibration on phones that support it
  };

  const close = () => { try { ctx?.close(); } catch {} };
  return { beep, unlock, close };
}

export default function Camera({ onCode }) {
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState('');

  useEffect(() => {
    const beeper = makeBeeper();
    // Browsers only allow sound after a user touch, so unlock on the first interaction
    const events = ['pointerdown', 'touchstart', 'click'];
    events.forEach((e) => document.addEventListener(e, beeper.unlock, { once: true, passive: true }));
    beeper.unlock();

    const scanner = new Html5Qrcode('qr-reader', { verbose: false });
    let handled = false;
    const started = scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
        (text) => { if (!handled) { handled = true; beeper.beep(); cb.current(text); } },
        () => {}
      )
      .catch(() => setError('Camera not available. Allow camera permission (HTTPS required), or use "Enter ID".'));

    return () => {
      handled = true;
      events.forEach((e) => document.removeEventListener(e, beeper.unlock));
      beeper.close();
      started.then(() => scanner.stop()).then(() => scanner.clear()).catch(() => {});
    };
  }, []);

  return (
    <div>
      <div id="qr-reader" className="min-h-[300px] w-full overflow-hidden rounded-lg bg-black" />
      {error && <p className="mt-3 rounded-lg bg-warn-light p-3 text-sm text-ink">{error}</p>}
      {!error && <p className="mt-3 text-center text-sm text-steel">Point the camera at the guest's QR code</p>}
    </div>
  );
}