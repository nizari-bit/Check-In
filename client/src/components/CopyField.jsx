import { useState } from 'react';
import { copyText } from '../api.js';

export default function CopyField({ label, value, mono = true }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className={`input ${mono ? 'font-mono' : ''}`} />
        <button type="button" className="btn btn-secondary shrink-0" onClick={async () => { await copyText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
