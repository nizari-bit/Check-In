import { Link, useNavigate } from 'react-router-dom';
import { adminSession } from '../api.js';
import Brand from './Brand.jsx';

export default function AdminLayout({ children, back }) {
  const nav = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="bg-teal text-white print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/admin"><Brand /></Link>
          <button className="rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10" onClick={() => { adminSession.clear(); nav('/admin/login'); }}>Log out</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {back && <Link to={back.to} className="mb-3 inline-block text-sm font-medium text-teal-dark hover:underline print:hidden">← {back.label}</Link>}
        {children}
      </main>
    </div>
  );
}
