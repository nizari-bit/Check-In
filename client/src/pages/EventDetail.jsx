import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api, downloadFile, fmtDate, fmtTime } from '../api.js';
import AdminLayout from '../components/AdminLayout.jsx';
import Modal from '../components/Modal.jsx';
import EventForm from '../components/EventForm.jsx';
import CopyField from '../components/CopyField.jsx';

const Stat = ({ label, value, tone = 'text-ink' }) => (
  <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-steel">{label}</p><p className={`mt-1 text-3xl font-bold ${tone}`}>{value}</p></div>
);

function GuestModal({ guest, onSave, onClose }) {
  const [f, setF] = useState({ full_name: '', phone: '', category: '', table_no: '', card_type: 'single', ...(guest || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await onSave(f); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={guest ? 'Edit guest' : 'Add guest'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="rounded-lg bg-bad-light p-2 text-sm text-bad">{error}</p>}
        <div><label className="label">Full name *</label><input className="input" value={f.full_name} onChange={set('full_name')} required autoFocus /></div>
        <div>
          <label className="label">Card type</label>
          <div className="grid grid-cols-2 gap-2">
            {[['single', 'Single', '1 person'], ['double', 'Double', 'Up to 2 people']].map(([v, title, sub]) => (
              <button type="button" key={v} onClick={() => setF({ ...f, card_type: v })}
                className={`rounded-md border-2 p-3 text-left transition ${f.card_type === v ? 'border-teal bg-teal-light' : 'border-mist-300 bg-white hover:bg-mist-50'}`}>
                <span className="block font-semibold">{title}</span><span className="text-xs text-steel">{sub}</span>
              </button>
            ))}
          </div>
        </div>
        <div><label className="label">Phone number</label><input className="input" inputMode="tel" value={f.phone || ''} onChange={set('phone')} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Category</label><input className="input" placeholder="VIP, Family…" value={f.category || ''} onChange={set('category')} /></div>
          <div><label className="label">Table</label><input className="input" value={f.table_no || ''} onChange={set('table_no')} /></div>
        </div>
        {!guest && <p className="text-xs text-steel">A unique ID and QR code are created automatically when you save.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // {type, ...}
  const [newPin, setNewPin] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const [e, g] = await Promise.all([api.get(`/admin/events/${id}`, 'admin'), api.get(`/admin/events/${id}/guests`, 'admin')]);
      setEvent(e); setGuests(g);
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [id]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests.filter((g) => {
      if (filter === 'arrived' && g.admitted_count < 1) return false;
      if (filter === 'pending' && g.admitted_count > 0) return false;
      if (!q) return true;
      return [g.full_name, g.phone, g.code, g.category, g.table_no].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [guests, search, filter]);

  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { alert(e.message); } finally { setBusy(''); } };

  const saveGuest = async (form) => {
    if (modal.guest) await api.put(`/admin/guests/${modal.guest.id}`, form, 'admin');
    else {
      const r = await api.post(`/admin/events/${id}/guests`, form, 'admin');
      await load(); setModal({ type: 'qr', guest: r }); return;
    }
    setModal(null); load();
  };

  const onImport = (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    run('import', async () => {
      const fd = new FormData(); fd.append('file', file);
      setImportResult(await api.upload(`/admin/events/${id}/import`, fd, 'admin')); load();
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob(['full_name,phone,category,table_no,card_type\nJohn Doe,255712345678,VIP,1,double\nJane Roe,255755555555,,2,single\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'guest_import_template.csv'; a.click();
  };

  if (error) return <AdminLayout back={{ to: '/admin', label: 'All events' }}><p className="rounded-lg bg-bad-light p-3 text-bad">{error}</p></AdminLayout>;
  if (!event) return <AdminLayout><p className="text-steel">Loading…</p></AdminLayout>;

  const pct = event.total_guests ? Math.round((event.arrived / event.total_guests) * 100) : 0;

  return (
    <AdminLayout back={{ to: '/admin', label: 'All events' }}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-steel">{fmtDate(event.event_date)}{event.venue ? ` · ${event.venue}` : ''}</p>
          {(event.host_name || event.host_phone) && <p className="text-sm text-steel">Host: {[event.host_name, event.host_phone, event.host_email].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setModal({ type: 'editEvent' })}>Edit event</button>
          <button className="btn btn-secondary text-bad" onClick={() => { if (confirm(`Delete "${event.name}" and all its guests? This cannot be undone.`)) run('del', async () => { await api.del(`/admin/events/${id}`, 'admin'); nav('/admin'); }); }}>Delete</button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cards" value={event.total_cards} />
        <Stat label="Expected people" value={event.total_guests} />
        <Stat label="Arrived" value={event.arrived} tone="text-ok" />
        <Stat label="Remaining" value={event.total_guests - event.arrived} tone="text-warn" />
      </div>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-mist"><div className="h-full bg-ok transition-all" style={{ width: `${pct}%` }} /></div>

      {/* Access panel */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Host / scanner access</h2>
            <p className="text-xs text-steel">
              {event.access_open ? 'Active' : event.access_active ? 'Expired' : 'Switched off'} · link expires {new Date(event.access_expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <button className={`btn ${event.access_active ? 'btn-secondary' : 'btn-primary'}`} onClick={() => run('access', async () => setEvent(await api.post(`/admin/events/${id}/access`, { active: !event.access_active }, 'admin')))}>
            {event.access_active ? 'Switch access off' : 'Switch access on'}
          </button>
        </div>
        <CopyField value={event.access_url} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-secondary" disabled={busy === 'pin'} onClick={() => confirm('Create a new PIN? The old one stops working.') && run('pin', async () => { const r = await api.post(`/admin/events/${id}/reset-pin`, {}, 'admin'); setEvent(r.event); setNewPin(r.pin); })}>Reset PIN</button>
          <button className="btn btn-secondary" disabled={busy === 'link'} onClick={() => confirm('Create a new link? The old link stops working immediately.') && run('link', async () => setEvent(await api.post(`/admin/events/${id}/regenerate-link`, {}, 'admin')))}>New link</button>
        </div>
      </section>

      {/* Guests */}
      <section className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-mist p-4">
          <h2 className="mr-auto font-bold">Guests</h2>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'guest' })}>+ Add guest</button>
          <button className="btn btn-secondary" disabled={busy === 'import'} onClick={() => fileRef.current.click()}>{busy === 'import' ? 'Importing…' : 'Import CSV'}</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
          <button className="btn btn-secondary" disabled={!guests.length || busy === 'zip'} onClick={() => run('zip', () => downloadFile(`/admin/events/${id}/qr.zip`, 'qr_codes.zip'))}>{busy === 'zip' ? 'Preparing…' : 'QR ZIP'}</button>
          <Link to={`/admin/events/${id}/print`} className={`btn btn-secondary ${!guests.length ? 'pointer-events-none opacity-50' : ''}`}>Print sheet</Link>
          <button className="btn btn-secondary" disabled={!guests.length} onClick={() => run('csv', () => downloadFile(`/admin/events/${id}/export.csv`, 'guests.csv'))}>Export CSV</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-mist p-4">
          <input className="input max-w-xs" placeholder="Search name, phone or ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {['all', 'arrived', 'pending'].map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${filter === k ? 'bg-ink text-mist-50' : 'bg-mist-100 text-steel-dark hover:bg-mist'}`}>{k === 'pending' ? 'Not arrived' : k}</button>
          ))}
          <button onClick={downloadTemplate} className="ml-auto text-sm text-teal-dark hover:underline">CSV template</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-mist-50 text-xs uppercase tracking-wide text-steel">
              <tr><th className="px-4 py-2">ID</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Phone</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Table</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {shown.map((g) => (
                <tr key={g.id} className="hover:bg-mist-50">
                  <td className="px-4 py-2 font-mono font-semibold">{g.code}</td>
                  <td className="px-4 py-2 font-medium">{g.full_name}</td>
                  <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${g.card_type === 'double' ? 'bg-teal-light text-teal-dark' : 'bg-mist-100 text-steel-dark'}`}>{g.card_type}</span></td>
                  <td className="px-4 py-2">{g.phone}</td>
                  <td className="px-4 py-2">{g.category}</td>
                  <td className="px-4 py-2">{g.table_no}</td>
                  <td className="px-4 py-2">
                    {g.admitted_count > 0
                      ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.admitted_count >= g.capacity ? 'bg-ok-light text-ok' : 'bg-warn-light text-ink'}`}>{g.admitted_count}/{g.capacity} in · {fmtTime(g.checked_in_at)}</span>
                      : <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs font-semibold text-steel">Pending</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button className="px-2 text-teal-dark hover:underline" onClick={() => setModal({ type: 'qr', guest: g })}>QR</button>
                    <button className="px-2 text-teal-dark hover:underline" onClick={() => setModal({ type: 'guest', guest: g })}>Edit</button>
                    {g.admitted_count > 0 && <button className="px-2 text-warn hover:underline" onClick={() => confirm(`Undo check-in for ${g.full_name}?`) && run('undo', async () => { await api.post(`/admin/guests/${g.id}/undo-checkin`, {}, 'admin'); load(); })}>Undo</button>}
                    <button className="px-2 text-bad hover:underline" onClick={() => confirm(`Delete ${g.full_name}?`) && run('gdel', async () => { await api.del(`/admin/guests/${g.id}`, 'admin'); load(); })}>Delete</button>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-steel">{guests.length ? 'No guests match your search.' : 'No guests yet. Add one or import a CSV.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modals */}
      {modal?.type === 'guest' && <GuestModal guest={modal.guest} onSave={saveGuest} onClose={() => setModal(null)} />}

      {modal?.type === 'editEvent' && (
        <Modal title="Edit event" onClose={() => setModal(null)} wide>
          <EventForm initial={event} submitLabel="Save changes" onCancel={() => setModal(null)}
            onSubmit={async (f) => { setEvent(await api.put(`/admin/events/${id}`, f, 'admin')); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'qr' && (
        <Modal title="Invitation ID" onClose={() => setModal(null)}>
          <div className="text-center">
            <div className="mx-auto inline-block rounded-lg border border-mist bg-white p-3"><QRCodeSVG value={modal.guest.code} size={200} marginSize={2} /></div>
            <p className="mt-3 font-mono text-3xl font-bold tracking-widest">{modal.guest.code}</p>
            <p className="mt-1 font-medium">{modal.guest.full_name}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-teal-dark">{modal.guest.card_type === 'double' ? 'Double card · admits 2' : 'Single card · admits 1'}</p>
            <p className="mt-2 text-xs text-steel">The QR contains only this ID. Print both the QR and the ID on the card.</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => downloadFile(`/admin/guests/${modal.guest.id}/qr.png`, `${modal.guest.code}.png`)}>Download PNG</button>
            <button className="btn btn-primary" onClick={() => setModal(null)}>Done</button>
          </div>
        </Modal>
      )}

      {newPin && (
        <Modal title="New PIN" onClose={() => setNewPin(null)}>
          <p className="mb-3 text-sm text-steel-dark">Share this PIN with the host. It is shown only once.</p>
          <CopyField value={newPin} />
          <div className="mt-4 text-right"><button className="btn btn-primary" onClick={() => setNewPin(null)}>Done</button></div>
        </Modal>
      )}

      {importResult && (
        <Modal title="Import finished" onClose={() => setImportResult(null)}>
          <p className="text-sm"><b className="text-ok">{importResult.imported}</b> guests imported{importResult.skipped.length ? <>, <b className="text-bad">{importResult.skipped.length}</b> skipped</> : '.'}</p>
          {importResult.skipped.length > 0 && (
            <ul className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-mist-50 p-3 text-sm">
              {importResult.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}
            </ul>
          )}
          <div className="mt-4 text-right"><button className="btn btn-primary" onClick={() => setImportResult(null)}>Done</button></div>
        </Modal>
      )}
    </AdminLayout>
  );
}
