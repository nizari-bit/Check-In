// Draws a guest's invitation card from their event's uploaded template.
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
const SCALE = 3;
const NAME_COLOR = '#3b291e';
const QR_COLOR = '#1a1412';
const SHOW_ID = true;
const ID_TEXT = { baseline: 481, size: 7.5, spacing: 1.4, color: '#916461' };
const JPEG_QUALITY = 90;

GlobalFonts.registerFromPath(path.join(dir, 'fonts/CormorantGaramond_600SemiBold_Italic.ttf'), 'CardName');
GlobalFonts.registerFromPath(path.join(dir, 'fonts/SourceSans3_600SemiBold.ttf'), 'CardId');

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

export async function renderCard({ name, code, templatePath, layout = {} }) {
  if (!templatePath) throw new Error('Upload a card template for this event before generating cards');
  const resolvedLayout = normalizeLayout(layout);
  const sourceImage = await loadImage(path.resolve(templatePath));
  const width = sourceImage.width || CARD.w;
  const height = sourceImage.height || CARD.h;
  const fontFace = layout.card_name_font_family
    ? await registerGoogleFont(layout.card_name_font_family, layout.card_name_font_variant)
    : 'CardName';
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImage, 0, 0, width, height);

  const maxWidth = Number.isFinite(resolvedLayout.nameWidth) ? resolvedLayout.nameWidth : DEFAULT_LAYOUT.nameWidth;
  const { text, size } = fitName(ctx, name, maxWidth, resolvedLayout.nameSize, fontFace, Math.max(8, resolvedLayout.nameSize * 0.45));
  ctx.font = `${size}px "${fontFace}"`;
  ctx.fillStyle = NAME_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, resolvedLayout.nameX, resolvedLayout.nameY);

  drawQr(ctx, code, resolvedLayout.qrX, resolvedLayout.qrY, resolvedLayout.qrSize);

  if (SHOW_ID) {
    ctx.font = `${ID_TEXT.size}px CardId`;
    ctx.fillStyle = ID_TEXT.color;
    ctx.textAlign = 'left';
    drawSpaced(ctx, code, resolvedLayout.qrX + resolvedLayout.qrSize / 2, resolvedLayout.qrY + resolvedLayout.qrSize + 30, ID_TEXT.spacing);
  }

  return canvas.toBuffer('image/jpeg', JPEG_QUALITY);
}

export const cardFileName = (guest) => {
  const slug = String(guest.full_name || 'guest').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40) || 'guest';
  return `${guest.code}_${slug}.jpg`;
};
