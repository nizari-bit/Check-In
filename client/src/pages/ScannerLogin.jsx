import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, scannerSession } from '../api.js';
import Brand from '../components/Brand.jsx';

export default function ScannerLogin() {
  const { token } = useParams();
  const nav = useNavigate();
  const [event, setEvent] = useState(null);
  const [fatal, setFatal] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Already logged in to this event on this phone? Go straight in.
    if (scannerSession.get()?.accessToken === token) { nav('/scan', { replace: true }); return; }
    api.get(`/access/${token}`).then(setEvent).catch((e) => setFatal(e.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api.post(`/access/${token}/login`, { pin });
      scannerSession.set({ token: r.token, accessToken: token, eventName: r.event.name });
      nav('/scan', { replace: true });
    } catch (err) { setError(err.message); setPin(''); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-teal p-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 text-center text-white"><Brand /></div>
        <div className="rounded-lg bg-mist-50 p-6">
          {fatal ? (
            <div className="text-center"><h1 className="text-xl font-bold">Link unavailable</h1><p className="mt-2 text-sm text-steel">{fatal}. Please contact the organiser.</p></div>
          ) : !event ? (
            <p className="text-center text-steel">Loading…</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-teal-dark">Guest check-in</p>
                <h1 className="mt-1 text-2xl font-bold leading-tight">{event.name}</h1>
                <p className="mt-1 text-sm text-steel">{fmtDate(event.event_date)}</p>
              </div>
              {error && <p className="rounded-md bg-bad-light p-2 text-center text-sm text-bad">{error}</p>}
              <div>
                <label className="label">Enter PIN</label>
                <input className="input text-center font-mono text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} autoFocus />
              </div>
              <button className="btn btn-primary w-full py-3 text-base" disabled={busy || pin.length < 4}>{busy ? 'Checking…' : 'Open scanner'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
