import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api, downloadFile, fetchBlobUrl, fmtDate, fmtTime } from '../api.js';
import CardModal from '../components/CardModal.jsx';
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

function NudgeControls({ label, onMove }) {
  const directions = [
    { key: 'ArrowUp', label: `Move ${label} up`, dx: 0, dy: -1, position: 'col-start-2 row-start-1' },
    { key: 'ArrowLeft', label: `Move ${label} left`, dx: -1, dy: 0, position: 'col-start-1 row-start-2' },
    { key: 'ArrowDown', label: `Move ${label} down`, dx: 0, dy: 1, position: 'col-start-2 row-start-2' },
    { key: 'ArrowRight', label: `Move ${label} right`, dx: 1, dy: 0, position: 'col-start-3 row-start-2' },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-steel-dark">{label}</span>
      <div className="grid grid-cols-3 grid-rows-2 gap-1">
        {directions.map(({ key, label: buttonLabel, dx, dy, position }) => (
          <button
            key={key}
            type="button"
            className={`btn btn-secondary h-8 w-8 p-0 ${position}`}
            aria-label={buttonLabel}
            title={`${buttonLabel} 1 image pixel (Shift: 10 pixels)`}
            onClick={(e) => onMove(dx * (e.shiftKey ? 10 : 1), dy * (e.shiftKey ? 10 : 1))}
          >
            {key === 'ArrowUp' ? '↑' : key === 'ArrowDown' ? '↓' : key === 'ArrowLeft' ? '←' : '→'}
          </button>
        ))}
      </div>
    </div>
  );
}

function fontVariantLabel(variant) {
  const italic = variant.endsWith('italic');
  const weight = variant === 'regular' || variant === 'italic'
    ? 400
    : Number(variant.replace('italic', '')) || 400;
  const weightName = ({
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  })[weight] || `Weight ${weight}`;
  return `${weightName}${italic ? ' Italic' : ''}`;
}

function fontCssUrl(family, variant) {
  const italic = variant.endsWith('italic');
  const weight = variant === 'regular' || variant === 'italic'
    ? 400
    : Number(variant.replace('italic', '')) || 400;
  const query = new URLSearchParams({ family: `${family}:ital,wght@${italic ? 1 : 0},${weight}`, display: 'swap' });
  return `https://fonts.googleapis.com/css2?${query.toString()}`;
}

function TemplateModal({ event, onClose, onSave, onReset }) {
  const defaults = {
    name_x: event?.card_name_x ?? 623,
    name_y: event?.card_name_y ?? 508,
    name_width: event?.card_name_width ?? 600,
    name_font_size: event?.card_name_font_size ?? 48,
    name_font_family: event?.card_name_font_family ?? '',
    name_font_variant: event?.card_name_font_variant ?? '',
    qr_x: event?.card_qr_x ?? 549,
    qr_y: event?.card_qr_y ?? 1250,
    qr_size: event?.card_qr_size ?? 165,
  };
  const [form, setForm] = useState(defaults);
  const [file, setFile] = useState(null);
  const [templateUrl, setTemplateUrl] = useState('');
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState('');
  const [loadingTemplate, setLoadingTemplate] = useState(Boolean(event?.card_template_path));
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });
  const [zoom, setZoom] = useState(1);
  const [fontOptions, setFontOptions] = useState([]);
  const [loadingFonts, setLoadingFonts] = useState(true);
  const [fontError, setFontError] = useState('');
  const [fontSearch, setFontSearch] = useState(defaults.name_font_family);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [activeFontIndex, setActiveFontIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const imageRef = useRef(null);
  const previewViewportRef = useRef(null);
  const dragRef = useRef(null);
  const hasLayout = event?.card_name_x != null;
  const selectedFont = fontOptions.find((font) => font.family === form.name_font_family);
  const matchingFonts = fontOptions
    .filter((font) => font.family.toLowerCase().includes(fontSearch.trim().toLowerCase()))
    .slice(0, 100);
  const previewFontFamily = form.name_font_family || 'Cormorant Garamond';
  const previewFontVariant = form.name_font_variant || '600italic';
  const previewFontItalic = previewFontVariant.endsWith('italic');
  const previewFontWeight = previewFontVariant === 'regular' || previewFontVariant === 'italic'
    ? 400
    : Number(previewFontVariant.replace('italic', '')) || 400;

  useEffect(() => {
    let active = true;
    api.get('/admin/fonts', 'admin')
      .then((fonts) => { if (active) setFontOptions(fonts); })
      .catch((err) => { if (active) setFontError(err.message); })
      .finally(() => { if (active) setLoadingFonts(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontCssUrl(previewFontFamily, previewFontVariant);
    document.head.appendChild(link);
    return () => link.remove();
  }, [previewFontFamily, previewFontVariant]);

  useEffect(() => {
    if (!event.card_template_path) {
      setLoadingTemplate(false);
      return undefined;
    }
    let active = true;
    let objectUrl;
    setLoadingTemplate(true);
    fetchBlobUrl(`/admin/events/${event.id}/card-template`)
      .then((url) => {
        if (active) {
          objectUrl = url;
          setTemplateUrl(url);
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoadingTemplate(false); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [event.id, event.card_template_path]);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setUploadPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const image = imageRef.current;
    const viewport = previewViewportRef.current;
    if (!image || !viewport) return undefined;
    const updateSize = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const maxWidth = Math.max(1, viewport.clientWidth - 24);
      const maxHeight = window.innerHeight * 0.5;
      const fit = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
      setPreviewSize({
        width: image.naturalWidth * fit,
        height: image.naturalHeight * fit,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [templateUrl, uploadPreviewUrl]);

  useEffect(() => {
    if (!previewSize.naturalWidth || hasLayout) return;
    const { naturalWidth: w, naturalHeight: h } = previewSize;
    if (w === 1191 && h === 1677) return;
    setForm((current) => ({
      ...current,
      name_x: w * 0.5,
      name_y: h * 0.28,
      name_width: w * 0.55,
      name_font_size: w * 0.045,
      qr_x: w * 0.425,
      qr_y: h * 0.72,
      qr_size: w * 0.15,
    }));
  }, [previewSize.naturalWidth, previewSize.naturalHeight, hasLayout]);

  const startDrag = (type) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    dragRef.current = { type, startX: e.clientX, startY: e.clientY, initial: form };
  };

  const moveOverlay = (type, dx, dy) => {
    setForm((current) => {
      if (type === 'name') {
        return {
          ...current,
          name_x: Math.max(current.name_width / 2, Math.min(previewSize.naturalWidth - current.name_width / 2, current.name_x + dx)),
          name_y: Math.max(current.name_font_size, Math.min(previewSize.naturalHeight, current.name_y + dy)),
        };
      }
      return {
        ...current,
        qr_x: Math.max(0, Math.min(previewSize.naturalWidth - current.qr_size, current.qr_x + dx)),
        qr_y: Math.max(0, Math.min(previewSize.naturalHeight - current.qr_size, current.qr_y + dy)),
      };
    });
  };

  const onOverlayKeyDown = (type) => (e) => {
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[e.key];
    if (!direction) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    moveOverlay(type, direction[0] * step, direction[1] * step);
  };

  useEffect(() => {
    const move = (e) => {
      const drag = dragRef.current;
      if (!drag || !previewSize.naturalWidth || !previewSize.naturalHeight) return;
      const rect = imageRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      const dx = (e.clientX - drag.startX) * previewSize.naturalWidth / rect.width;
      const dy = (e.clientY - drag.startY) * previewSize.naturalHeight / rect.height;
      const { initial, type } = drag;
      setForm((current) => {
        if (type === 'name') {
          return {
            ...current,
            name_x: Math.max(initial.name_width / 2, Math.min(previewSize.naturalWidth - initial.name_width / 2, initial.name_x + dx)),
            name_y: Math.max(initial.name_font_size, Math.min(previewSize.naturalHeight, initial.name_y + dy)),
          };
        }
        if (type === 'qr') {
          return {
            ...current,
            qr_x: Math.max(0, Math.min(previewSize.naturalWidth - initial.qr_size, initial.qr_x + dx)),
            qr_y: Math.max(0, Math.min(previewSize.naturalHeight - initial.qr_size, initial.qr_y + dy)),
          };
        }
        if (type === 'resize-qr') {
          const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
          const size = Math.max(36, Math.min(
            Math.min(previewSize.naturalWidth - initial.qr_x, previewSize.naturalHeight - initial.qr_y),
            initial.qr_size + delta,
          ));
          return { ...current, qr_size: size };
        }
        const width = Math.max(60, Math.min(previewSize.naturalWidth, initial.name_width + dx * 2));
        return {
          ...current,
          name_width: width,
          name_font_size: Math.max(12, Math.min(160, initial.name_font_size * width / initial.name_width)),
        };
      });
    };
    const end = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [previewSize.naturalWidth, previewSize.naturalHeight]);

  const onImageLoad = (e) => {
    const image = e.currentTarget;
    setPreviewLoaded(true);
    const viewport = previewViewportRef.current;
    const maxWidth = Math.max(1, (viewport?.clientWidth || image.naturalWidth) - 24);
    const maxHeight = window.innerHeight * 0.5;
    const fit = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    setPreviewSize({
      width: image.naturalWidth * fit,
      height: image.naturalHeight * fit,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await onReset();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      if (file) fd.append('image', file);
      Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
      await onSave(fd);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Card template" onClose={onClose} extraWide mobileFullScreen>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-lg bg-bad-light p-2 text-sm text-bad">{error}</p>}

        <div>
          <label className="label">Template image</label>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            className="input"
            onChange={(e) => {
              setPreviewLoaded(false);
              setFile(e.target.files?.[0] || null);
            }}
          />
          <p className="mt-1 text-xs text-steel">Drag the name and QR to position them. Drag a corner handle to resize.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <label className="label" htmlFor="guest-name-font">Font Family</label>
            <input
              id="guest-name-font"
              className="input"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={fontMenuOpen}
              aria-controls="guest-name-font-options"
              aria-activedescendant={fontMenuOpen && matchingFonts.length
                ? `guest-name-font-option-${activeFontIndex}`
                : undefined}
              autoComplete="off"
              placeholder={loadingFonts ? 'Loading Google Fonts…' : 'Type to search Google Fonts'}
              value={fontSearch}
              disabled={loadingFonts}
              onFocus={(e) => {
                setFontMenuOpen(true);
                e.currentTarget.select();
              }}
              onBlur={() => setFontMenuOpen(false)}
              onChange={(e) => {
                setFontSearch(e.target.value);
                setActiveFontIndex(0);
                setFontMenuOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFontSearch(form.name_font_family);
                  setFontMenuOpen(false);
                } else if (e.key === 'ArrowDown' && matchingFonts.length) {
                  e.preventDefault();
                  setFontMenuOpen(true);
                  setActiveFontIndex((index) => Math.min(index + 1, matchingFonts.length - 1));
                } else if (e.key === 'ArrowUp' && matchingFonts.length) {
                  e.preventDefault();
                  setActiveFontIndex((index) => Math.max(index - 1, 0));
                } else if (e.key === 'Enter' && fontMenuOpen) {
                  e.preventDefault();
                  const font = matchingFonts[activeFontIndex];
                  if (font) {
                    const variant = font.variants.includes('600italic')
                      ? '600italic'
                      : font.variants.includes('regular')
                        ? 'regular'
                        : font.variants[0] || '';
                    setForm((current) => ({ ...current, name_font_family: font.family, name_font_variant: variant }));
                    setFontSearch(font.family);
                    setFontMenuOpen(false);
                  } else if (!fontSearch.trim()) {
                    setForm((current) => ({ ...current, name_font_family: '', name_font_variant: '' }));
                    setFontMenuOpen(false);
                  }
                }
              }}
            />
            {fontMenuOpen && (
              <div
                id="guest-name-font-options"
                role="listbox"
                aria-label="Google Fonts"
                className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-mist-300 bg-white py-1 text-left shadow-lg"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!form.name_font_family}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-mist-100 ${!form.name_font_family ? 'bg-mist-100 font-semibold' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setForm((current) => ({ ...current, name_font_family: '', name_font_variant: '' }));
                    setFontSearch('');
                    setFontMenuOpen(false);
                  }}
                >
                  Cormorant Garamond (default)
                </button>
                {matchingFonts.map((font, index) => (
                  <button
                    id={`guest-name-font-option-${index}`}
                    key={font.family}
                    type="button"
                    role="option"
                    aria-selected={form.name_font_family === font.family}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-mist-100 ${activeFontIndex === index ? 'bg-mist-100' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveFontIndex(index)}
                    onClick={() => {
                      const variant = font.variants.includes('600italic')
                        ? '600italic'
                        : font.variants.includes('regular')
                          ? 'regular'
                          : font.variants[0] || '';
                      setForm((current) => ({ ...current, name_font_family: font.family, name_font_variant: variant }));
                      setFontSearch(font.family);
                      setFontMenuOpen(false);
                    }}
                  >
                    {font.family}
                  </button>
                ))}
                {!matchingFonts.length && (
                  <p className="px-3 py-2 text-sm text-steel">No fonts match “{fontSearch}”.</p>
                )}
                {matchingFonts.length === 100 && (
                  <p className="px-3 py-2 text-xs text-steel">Showing the first 100 matches. Type more to narrow the list.</p>
                )}
              </div>
            )}
            {!loadingFonts && !fontError && <p className="mt-1 text-xs text-steel">{fontOptions.length} Google Fonts available</p>}
          </div>
          <div>
            <label className="label" htmlFor="guest-name-font-style">Font Variant</label>
            <select
              id="guest-name-font-style"
              className="input"
              value={form.name_font_variant}
              disabled={!selectedFont}
              onChange={(e) => setForm((current) => ({ ...current, name_font_variant: e.target.value }))}
            >
              {selectedFont?.variants.map((variant) => (
                <option key={variant} value={variant}>{fontVariantLabel(variant)}</option>
              ))}
              {!selectedFont && <option value="">Default font variant</option>}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="guest-name-font-size">Font size (image pixels)</label>
            <input
              id="guest-name-font-size"
              type="number"
              min="8"
              max="160"
              step="any"
              className="input"
              value={form.name_font_size}
              onChange={(e) => setForm((current) => ({ ...current, name_font_size: Number(e.target.value) }))}
              required
            />
          </div>
          {fontError && <p className="text-sm text-bad sm:col-span-3">{fontError}. The existing default font can still be used.</p>}
        </div>

        <div ref={previewViewportRef} className="max-h-[40dvh] overflow-auto rounded-lg border border-mist bg-mist-100 p-2 text-center sm:max-h-[55vh] sm:p-3">
          {uploadPreviewUrl || templateUrl ? (
            <div
              className="relative mx-auto inline-block align-top"
              style={{ width: `${previewSize.width * zoom}px`, height: `${previewSize.height * zoom}px` }}
            >
              <img
                ref={imageRef}
                src={uploadPreviewUrl || templateUrl}
                alt="Card template preview"
                className="pointer-events-none absolute left-0 top-0 block max-w-none select-none"
                style={{ width: `${previewSize.width * zoom}px`, height: `${previewSize.height * zoom}px` }}
                draggable="false"
                onLoad={onImageLoad}
              />
              {previewSize.width > 0 && (
                <>
                  <div
                    role="group"
                    tabIndex={0}
                    aria-label="Guest name position. Use arrow keys to move one image pixel, or Shift plus an arrow to move ten pixels. Drag to position; drag the corner to resize."
                    onKeyDown={onOverlayKeyDown('name')}
                    onPointerDown={startDrag('name')}
                    className="absolute flex cursor-move select-none touch-none items-center justify-center border-2 border-dashed border-teal bg-teal/15 text-ink shadow-sm"
                    style={{
                      left: `${form.name_x * previewSize.width * zoom / previewSize.naturalWidth}px`,
                      top: `${form.name_y * previewSize.height * zoom / previewSize.naturalHeight}px`,
                      width: `${form.name_width * previewSize.width * zoom / previewSize.naturalWidth}px`,
                      height: `${form.name_font_size * 1.5 * previewSize.height * zoom / previewSize.naturalHeight}px`,
                      transform: 'translate(-50%, -100%)',
                      fontSize: `${form.name_font_size * previewSize.height * zoom / previewSize.naturalHeight}px`,
                      lineHeight: 1,
                    }}
                  >
                    <span
                      className="pointer-events-none overflow-hidden text-ellipsis whitespace-nowrap px-1"
                      style={{ fontFamily: `"${previewFontFamily}"`, fontStyle: previewFontItalic ? 'italic' : 'normal', fontWeight: previewFontWeight }}
                    >
                      Guest Name
                    </span>
                    <button
                      type="button"
                      aria-label="Resize guest name"
                      onPointerDown={startDrag('resize-name')}
                      className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-teal shadow"
                    />
                  </div>
                  <div
                    role="group"
                    tabIndex={0}
                    aria-label="QR code position. Use arrow keys to move one image pixel, or Shift plus an arrow to move ten pixels. Drag to position; drag the corner to resize."
                    onKeyDown={onOverlayKeyDown('qr')}
                    onPointerDown={startDrag('qr')}
                    className="absolute cursor-move touch-none border-2 border-dashed border-violet-600 bg-white/70 shadow-sm"
                    style={{
                      left: `${form.qr_x * previewSize.width * zoom / previewSize.naturalWidth}px`,
                      top: `${form.qr_y * previewSize.height * zoom / previewSize.naturalHeight}px`,
                      width: `${form.qr_size * previewSize.width * zoom / previewSize.naturalWidth}px`,
                      height: `${form.qr_size * previewSize.height * zoom / previewSize.naturalHeight}px`,
                    }}
                  >
                    <QRCodeSVG value="GUEST-QR" className="pointer-events-none h-full w-full p-[8%]" />
                    <button
                      type="button"
                      aria-label="Resize QR code"
                      onPointerDown={startDrag('resize-qr')}
                      className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-violet-600 shadow"
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="p-10 text-sm text-steel">
              {loadingTemplate ? 'Loading card preview…' : 'Upload an image above to preview and edit this event’s card template.'}
            </p>
          )}
        </div>

        {previewLoaded && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-steel-dark">Preview zoom</span>
                <button type="button" className="btn btn-secondary px-3" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}>−</button>
                <span className="min-w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
                <button type="button" className="btn btn-secondary px-3" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}>+</button>
                <button type="button" className="text-sm text-teal-dark hover:underline" onClick={() => setZoom(1)}>Reset</button>
              </div>
              <p className="text-xs text-steel">Focus a name or QR overlay and use arrow keys: 1 image pixel per press, Shift + arrow for 10.</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <NudgeControls label="Move name" onMove={(dx, dy) => moveOverlay('name', dx, dy)} />
              <NudgeControls label="Move QR" onMove={(dx, dy) => moveOverlay('qr', dx, dy)} />
            </div>
          </div>
        )}

        <p className="text-xs text-steel">The QR overlay is a preview marker; generated cards will contain each guest’s actual scannable QR code.</p>
        <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-mist bg-white/95 px-4 pb-2 pt-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <button type="button" className="btn btn-secondary min-h-11 w-full text-bad sm:w-auto" disabled={busy || !event?.card_template_path} onClick={reset}>Reset template</button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary min-h-11 flex-1 sm:flex-none" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary min-h-11 flex-1 sm:flex-none" disabled={busy || !previewLoaded || !(uploadPreviewUrl || templateUrl)}>{busy ? 'Saving…' : 'Save settings'}</button>
          </div>
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState([]);
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

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageGuests = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageGuestIds = pageGuests.map((g) => g.id);
  const allPageSelected = pageGuestIds.length > 0 && pageGuestIds.every((guestId) => selectedIds.includes(guestId));

  useEffect(() => {
    setPage(1);
  }, [search, filter, pageSize]);

  useEffect(() => {
    const guestIds = new Set(guests.map((g) => g.id));
    setSelectedIds((current) => current.filter((guestId) => guestIds.has(guestId)));
  }, [guests]);

  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { alert(e.message); } finally { setBusy(''); } };

  const togglePageSelection = (checked) => {
    setSelectedIds((current) => {
      const currentIds = new Set(current);
      pageGuestIds.forEach((guestId) => checked ? currentIds.add(guestId) : currentIds.delete(guestId));
      return [...currentIds];
    });
  };

  const deleteSelected = () => {
    const count = selectedIds.length;
    if (!count || !confirm(`Delete ${count} selected ${count === 1 ? 'guest' : 'guests'}? This cannot be undone.`)) return;
    run('bulkDelete', async () => {
      await api.del(`/admin/events/${id}/guests`, 'admin', { ids: selectedIds });
      setSelectedIds([]);
      await load();
    });
  };

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
          <button className="btn btn-secondary" onClick={() => setModal({ type: 'template' })}>Card template</button>
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
          <button className="btn btn-secondary" disabled={!guests.length || busy === 'cards'} onClick={() => run('cards', () => downloadFile(`/admin/events/${id}/cards.zip`, 'invitation_cards.zip'))}>{busy === 'cards' ? 'Preparing…' : 'Cards ZIP'}</button>
          <Link to={`/admin/events/${id}/print`} className={`btn btn-secondary ${!guests.length ? 'pointer-events-none opacity-50' : ''}`}>Print sheet</Link>
          <button className="btn btn-secondary" disabled={!guests.length} onClick={() => run('csv', () => downloadFile(`/admin/events/${id}/export.csv`, 'guests.csv'))}>Export CSV</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-mist p-4">
          <input className="input max-w-xs" placeholder="Search name, phone or ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {['all', 'arrived', 'pending'].map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${filter === k ? 'bg-ink text-mist-50' : 'bg-mist-100 text-steel-dark hover:bg-mist'}`}>{k === 'pending' ? 'Not arrived' : k}</button>
          ))}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-steel">{selectedIds.length} selected</span>
              <button className="btn btn-secondary text-bad" disabled={busy === 'bulkDelete'} onClick={deleteSelected}>
                {busy === 'bulkDelete' ? 'Deleting…' : 'Delete selected'}
              </button>
              <button className="text-sm text-steel-dark hover:underline" onClick={() => setSelectedIds([])}>Clear</button>
            </div>
          )}
          <button onClick={downloadTemplate} className="ml-auto text-sm text-teal-dark hover:underline">CSV template</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-mist-50 text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-2"><input type="checkbox" aria-label="Select all guests on this page" checked={allPageSelected} onChange={(e) => togglePageSelection(e.target.checked)} /></th>
                <th className="px-4 py-2">ID</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Phone</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Table</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {pageGuests.map((g) => (
                <tr key={g.id} className="hover:bg-mist-50">
                  <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${g.full_name}`} checked={selectedIds.includes(g.id)} onChange={(e) => setSelectedIds((current) => e.target.checked ? [...new Set([...current, g.id])] : current.filter((guestId) => guestId !== g.id))} /></td>
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
                    <button className="px-2 text-teal-dark hover:underline" onClick={() => setModal({ type: 'card', guest: g })}>Card</button>
                    <button className="px-2 text-teal-dark hover:underline" onClick={() => setModal({ type: 'guest', guest: g })}>Edit</button>
                    {g.admitted_count > 0 && <button className="px-2 text-warn hover:underline" onClick={() => confirm(`Undo check-in for ${g.full_name}?`) && run('undo', async () => { await api.post(`/admin/guests/${g.id}/undo-checkin`, {}, 'admin'); load(); })}>Undo</button>}
                    <button className="px-2 text-bad hover:underline" onClick={() => confirm(`Delete ${g.full_name}?`) && run('gdel', async () => { await api.del(`/admin/guests/${g.id}`, 'admin'); load(); })}>Delete</button>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-steel">{guests.length ? 'No guests match your search.' : 'No guests yet. Add one or import a CSV.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist p-4 text-sm">
          <p className="text-steel">
            {shown.length ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, shown.length)} of ${shown.length}` : 'Showing 0 guests'}
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-steel-dark">
              Per page
              <select className="input w-auto py-1" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                <option value={10}>10</option>
                <option value={15}>15</option>
              </select>
            </label>
            <button className="btn btn-secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span className="text-steel-dark">Page {currentPage} of {pageCount}</span>
            <button className="btn btn-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
          </div>
        </div>
      </section>

      {/* Modals */}
      {modal?.type === 'guest' && <GuestModal guest={modal.guest} onSave={saveGuest} onClose={() => setModal(null)} />}

      {modal?.type === 'template' && (
        <TemplateModal
          event={event}
          onClose={() => setModal(null)}
          onSave={async (fd) => {
            const data = await api.upload(`/admin/events/${id}/card-template`, fd, 'admin');
            setEvent(data.event); setModal(null);
          }}
          onReset={async () => {
            const data = await api.post(`/admin/events/${id}/card-template/reset`, {}, 'admin');
            setEvent(data.event); setModal(null);
          }}
        />
      )}

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
            <button className="btn btn-secondary" onClick={() => setModal({ type: 'card', guest: modal.guest })}>View card</button>
            <button className="btn btn-primary" onClick={() => setModal(null)}>Done</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'card' && <CardModal guest={modal.guest} onClose={() => setModal(null)} />}

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
