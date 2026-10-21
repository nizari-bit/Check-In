import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, adminSession } from '../api.js';
import Brand from '../components/Brand.jsx';

export default function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (adminSession.get()) return <Navigate to="/admin" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.post('/admin/login', { email, password });
      adminSession.set(r.token);
      nav('/admin', { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-teal p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-mist-50 p-6">
        <div className="text-center"><Brand className="text-2xl" /><p className="mt-1 text-sm text-steel">Admin sign in</p></div>
        {error && <p className="rounded-md bg-bad-light p-2 text-center text-sm text-bad">{error}</p>}
        <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        <div><label className="label">Password</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <button className="btn btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
