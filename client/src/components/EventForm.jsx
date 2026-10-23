import { useState } from "react";

const empty = {
  name: "",
  event_date: "",
  venue: "",
  host_name: "",
  host_phone: "",
  host_email: "",
  notes: "",
};

export default function EventForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}) {
  const [f, setF] = useState({
    ...empty,
    ...(initial || {}),
    event_date: String(initial?.event_date || "").slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(f);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <p className="rounded-lg bg-bad-light p-2 text-sm text-bad">{error}</p>
      )}
      <div>
        <label className="label">Event name *</label>
        <input
          className="input"
          value={f.name}
          onChange={set("name")}
          required
          autoFocus
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Date *</label>
          <input
            type="date"
            className="input"
            value={f.event_date}
            onChange={set("event_date")}
            required
          />
        </div>
        <div>
          <label className="label">Venue</label>
          <input
            className="input"
            value={f.venue || ""}
            onChange={set("venue")}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Host name</label>
          <input
            className="input"
            value={f.host_name || ""}
            onChange={set("host_name")}
          />
        </div>
        <div>
          <label className="label">Host phone</label>
          <input
            className="input"
            value={f.host_phone || ""}
            onChange={set("host_phone")}
          />
        </div>
      </div>
      <div>
        <label className="label">Host email</label>
        <input
          type="email"
          className="input"
          value={f.host_email || ""}
          onChange={set("host_email")}
        />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea
          rows={2}
          className="input"
          value={f.notes || ""}
          onChange={set("notes")}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
