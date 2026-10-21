const ADMIN_KEY = 'ec_admin_token';
const SCANNER_KEY = 'ec_scanner_session';

export const adminSession = {
  get: () => localStorage.getItem(ADMIN_KEY),
  set: (t) => localStorage.setItem(ADMIN_KEY, t),
  clear: () => localStorage.removeItem(ADMIN_KEY),
};

export const scannerSession = {
  get: () => { try { return JSON.parse(localStorage.getItem(SCANNER_KEY)); } catch { return null; } },
  set: (s) => localStorage.setItem(SCANNER_KEY, JSON.stringify(s)),
  clear: () => localStorage.removeItem(SCANNER_KEY),
};

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

function authHeader(kind) {
  const token = kind === 'admin' ? adminSession.get() : scannerSession.get()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = 'GET', body, form, auth, raw } = {}) {
  const headers = auth ? authHeader(auth) : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try { res = await fetch(`/api${path}`, { method, headers, body: payload }); }
  catch { throw new ApiError('Cannot reach the server. Check your connection.', 0); }

  if (res.ok) return raw ? res : res.json();

  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (auth === 'admin' && res.status === 401) {
    adminSession.clear();
    location.href = '/admin/login';
  }
  if (auth === 'scanner' && [401, 403, 410].includes(res.status)) {
    const s = scannerSession.get();
    scannerSession.clear();
    location.href = s?.accessToken ? `/e/${s.accessToken}` : '/';
  }
  throw new ApiError(data?.error || 'Something went wrong', res.status, data);
}

export const api = {
  get: (p, auth) => request(p, { auth }),
  post: (p, body, auth) => request(p, { method: 'POST', body: body ?? {}, auth }),
  put: (p, body, auth) => request(p, { method: 'PUT', body, auth }),
  del: (p, auth) => request(p, { method: 'DELETE', auth }),
  upload: (p, form, auth) => request(p, { method: 'POST', form, auth }),
};

export async function downloadFile(path, filename) {
  const res = await request(path, { auth: 'admin', raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fmtDate = (d) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';

export const fmtTime = (dt) =>
  dt ? new Date(String(dt).replace(' ', 'T')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
