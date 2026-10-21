import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import AdminLayout from '../components/AdminLayout.jsx';
import Modal from '../components/Modal.jsx';
import EventForm from '../components/EventForm.jsx';
import CopyField from '../components/CopyField.jsx';

export default function Events() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);

  const load = () => api.get('/admin/events', 'admin').then(setEvents).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (form) => {
    const r = await api.post('/admin/events', form, 'admin');
    setCreating(false); setCreated(r); load();
  };

  return (
    <AdminLayout>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Events</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New event</button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-bad-light p-3 text-sm text-bad">{error}</p>}
      {!events && !error && <p className="text-steel">Loading…</p>}
      {events?.length === 0 && (
        <div className="card p-10 text-center text-steel">No events yet. Create your first one to start adding guests.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events?.map((e) => {
          const pct = e.total_guests ? Math.round((e.arrived / e.total_guests) * 100) : 0;
          return (
            <Link key={e.id} to={`/admin/events/${e.id}`} className="card block p-4 transition hover:border-teal hover:shadow">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold leading-tight">{e.name}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${e.access_open ? 'bg-ok-light text-ok' : 'bg-mist text-steel-dark'}`}>
                  {e.access_open ? 'Link active' : 'Link closed'}
                </span>
              </div>
              <p className="mt-1 text-sm text-steel">{fmtDate(e.event_date)}{e.venue ? ` · ${e.venue}` : ''}</p>
              {e.host_name && <p className="text-sm text-steel">Host: {e.host_name}</p>}
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-mist-100"><div className="h-full bg-ok" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1 text-xs text-steel">{e.arrived} of {e.total_guests} people arrived · {e.total_cards} cards</p>
            </Link>
          );
        })}
      </div>

      {creating && (
        <Modal title="New event" onClose={() => setCreating(false)} wide>
          <EventForm onSubmit={create} onCancel={() => setCreating(false)} submitLabel="Create event" />
        </Modal>
      )}

      {created && (
        <Modal title="Event created" onClose={() => setCreated(null)}>
          <p className="mb-4 text-sm text-steel-dark">Give the host this link and PIN. <b>The PIN is shown only once</b> — you can reset it later if lost.</p>
          <div className="space-y-3">
            <CopyField label="Login link" value={created.event.access_url} />
            <CopyField label="PIN" value={created.pin} />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setCreated(null)}>Close</button>
            <Link to={`/admin/events/${created.event.id}`} className="btn btn-primary">Open event →</Link>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
