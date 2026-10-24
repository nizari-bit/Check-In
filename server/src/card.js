// Draws a guest's invitation card from their event's uploaded template.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import QRCode from 'qrcode';
import { registerGoogleFont } from './googleFonts.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/card');

const DEFAULT_LAYOUT = {
  nameX: 623.1,
  nameY: 507.9,
  nameWidth: 600,
  nameSize: 48,
  qrX: 549,
  qrY: 1250,
  qrSize: 165,
};

const CARD = { w: 397, h: 559 };
const NAME_COLOR = '#3b291e';
const QR_COLOR = '#1a1412';
const SHOW_ID = true;
// Sizes below are for a template 1191 px wide; they scale with the template so the ID stays readable on any size
const REFERENCE_WIDTH = 1191;
const ID_TEXT = { size: 22.5, spacing: 4.2, offset: 30, color: '#916461' };
const JPEG_QUALITY = 90;
const PREVIEW_QUALITY = 82;

// The two fonts that ship with the app. If a file is missing we say so in the log and carry on.
function registerBundledFont(file, alias) {
  const fontPath = path.join(dir, 'fonts', file);
  if (!fs.existsSync(fontPath)) {
    console.warn(`[card] bundled font is missing: assets/card/fonts/${file} (make sure it is committed to git)`);
    return false;
  }
  return GlobalFonts.registerFromPath(fontPath, alias);
}
registerBundledFont('CormorantGaramond_600SemiBold_Italic.ttf', 'CardName');
registerBundledFont('SourceSans3_600SemiBold.ttf', 'CardId');

export class TemplateMissingError extends Error {
  constructor() {
    super("This event's card template file is no longer on the server. Please open “Card template” and upload it again.");
    this.code = 'TEMPLATE_MISSING';
    this.status = 409;
  }
}

// ---- Speed: remember the decoded template and recently drawn cards ----
const templateCache = new Map(); // "path|modified-time" -> decoded image (the last 4 templates)
async function loadTemplate(templatePath) {
  const absolute = path.resolve(templatePath);
  let stat;
  try {
    stat = await fs.promises.stat(absolute);
  } catch {
    throw new TemplateMissingError();
  }
  const key = `${absolute}|${stat.mtimeMs}`;
  if (templateCache.has(key)) {
    const image = templateCache.get(key);
    templateCache.delete(key);
    templateCache.set(key, image); // mark as recently used
    return { image, key };
  }
  const image = await loadImage(absolute);
  templateCache.set(key, image);
  while (templateCache.size > 4) templateCache.delete(templateCache.keys().next().value);
  return { image, key };
}

const cardCache = new Map(); // recent finished cards (JPEG bytes)
const CARD_CACHE_MAX_ITEMS = 80;
const CARD_CACHE_MAX_BYTES = 48 * 1024 * 1024;
let cardCacheBytes = 0;
function rememberCard(key, buffer) {
  if (cardCache.has(key)) cardCacheBytes -= cardCache.get(key).length;
  cardCache.delete(key);
  cardCache.set(key, buffer);
  cardCacheBytes += buffer.length;
  while (cardCache.size > CARD_CACHE_MAX_ITEMS || cardCacheBytes > CARD_CACHE_MAX_BYTES) {
    const oldest = cardCache.keys().next().value;
    cardCacheBytes -= cardCache.get(oldest).length;
    cardCache.delete(oldest);
  }
}

function normalizeLayout(layout = {}) {
  const values = { ...DEFAULT_LAYOUT, ...(layout || {}) };
  return {
    nameX: Number(values.card_name_x ?? values.nameX ?? DEFAULT_LAYOUT.nameX),
    nameY: Number(values.card_name_y ?? values.nameY ?? DEFAULT_LAYOUT.nameY),
    nameWidth: Number(values.card_name_width ?? values.nameWidth ?? DEFAULT_LAYOUT.nameWidth),
    nameSize: Number(values.card_name_font_size ?? values.nameSize ?? DEFAULT_LAYOUT.nameSize),
    qrX: Number(values.card_qr_x ?? values.qrX ?? DEFAULT_LAYOUT.qrX),
    qrY: Number(values.card_qr_y ?? values.qrY ?? DEFAULT_LAYOUT.qrY),
    qrSize: Number(values.card_qr_size ?? values.qrSize ?? DEFAULT_LAYOUT.qrSize),
  };
}

function fitName(ctx, rawName, maxWidth, maxSize, fontFace, minSize = 8) {
  let text = String(rawName || '').replace(/\s+/g, ' ').trim();
  for (let size = maxSize; size >= minSize; size -= 0.25) {
    ctx.font = `${size}px "${fontFace}"`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
  }
  ctx.font = `${minSize}px "${fontFace}"`;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1).trimEnd();
  return { text: `${text}…`, size: minSize };
}

function drawQr(ctx, code, qrX, qrY, qrSize) {
  const qr = QRCode.create(code, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const boxPx = qrSize - 3;
  const cell = Math.max(2, Math.floor(boxPx / (n + 4)));
  const total = cell * n;
  const startX = Math.round(qrX + qrSize / 2 - total / 2);
  const startY = Math.round(qrY + qrSize / 2 - total / 2);
  ctx.fillStyle = QR_COLOR;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(startX + c * cell, startY + r * cell, cell, cell);
    }
  }
}

function drawSpaced(ctx, text, centerX, y, spacing) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = centerX - total / 2;
  [...text].forEach((ch, i) => { ctx.fillText(ch, x, y); x += widths[i] + spacing; });
}

/**
 * Draws one card and returns JPEG bytes.
 *   maxWidth  - optional: a smaller picture (for on-screen previews). Leave out for the full-size card.
 *   useCache  - set false for bulk jobs (ZIP) so they don't push everything else out of the cache.
 * A font problem never stops a card: the default font is used instead.
 */
export async function renderCard({ name, code, templatePath, layout = {}, maxWidth, useCache = true }) {
  if (!templatePath) throw new Error('Upload a card template for this event before generating cards');
  const resolvedLayout = normalizeLayout(layout);
  const { image: sourceImage, key: templateKey } = await loadTemplate(templatePath);
  const width = sourceImage.width || CARD.w;
  const height = sourceImage.height || CARD.h;

  const scale = maxWidth && maxWidth < width ? maxWidth / width : 1;
  const cacheKey = JSON.stringify([name, code, templateKey, resolvedLayout, layout.card_name_font_family || '', layout.card_name_font_variant || '', scale]);
  if (useCache && cardCache.has(cacheKey)) {
    const hit = cardCache.get(cacheKey);
    cardCache.delete(cacheKey);
    cardCache.set(cacheKey, hit);
    return hit;
  }

  let fontFace = 'CardName';
  let cacheable = true;
  if (layout.card_name_font_family) {
    try {
      fontFace = await registerGoogleFont(layout.card_name_font_family, layout.card_name_font_variant);
    } catch (err) {
      console.warn('[card] using the default font instead:', err.detail || err.message);
      cacheable = false; // try the chosen font again next time
    }
  }

  const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  if (scale !== 1) ctx.scale(scale, scale); // from here on we draw in the template's own pixels

  const nameMax = Number.isFinite(resolvedLayout.nameWidth) ? resolvedLayout.nameWidth : DEFAULT_LAYOUT.nameWidth;
  const { text, size } = fitName(ctx, name, nameMax, resolvedLayout.nameSize, fontFace, Math.max(8, resolvedLayout.nameSize * 0.45));
  ctx.font = `${size}px "${fontFace}"`;
  ctx.fillStyle = NAME_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, resolvedLayout.nameX, resolvedLayout.nameY);

  drawQr(ctx, code, resolvedLayout.qrX, resolvedLayout.qrY, resolvedLayout.qrSize);

  if (SHOW_ID) {
    const k = width / REFERENCE_WIDTH;
    ctx.font = `${ID_TEXT.size * k}px CardId`;
    ctx.fillStyle = ID_TEXT.color;
    ctx.textAlign = 'left';
    drawSpaced(ctx, code, resolvedLayout.qrX + resolvedLayout.qrSize / 2, resolvedLayout.qrY + resolvedLayout.qrSize + ID_TEXT.offset * k, ID_TEXT.spacing * k);
  }

  const jpeg = canvas.toBuffer('image/jpeg', scale === 1 ? JPEG_QUALITY : PREVIEW_QUALITY);
  if (useCache && cacheable) rememberCard(cacheKey, jpeg);
  return jpeg;
}

export const cardFileName = (guest) => {
  const slug = String(guest.full_name || 'guest').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40) || 'guest';
  return `${guest.code}_${slug}.jpg`;
};
