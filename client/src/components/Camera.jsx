import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function Camera({ onCode }) {
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState('');

  useEffect(() => {
    const scanner = new Html5Qrcode('qr-reader', { verbose: false });
    let handled = false;
    const started = scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
        (text) => { if (!handled) { handled = true; cb.current(text); } },
        () => {}
      )
      .catch(() => setError('Camera not available. Allow camera permission (HTTPS required), or use "Enter ID".'));

    return () => {
      handled = true;
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
