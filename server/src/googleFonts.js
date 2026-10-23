import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GlobalFonts } from '@napi-rs/canvas';
import { config } from './config.js';

const fontCacheDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/card/fonts/google');
const catalogUrl = 'https://www.googleapis.com/webfonts/v1/webfonts';
const catalogTtl = 6 * 60 * 60 * 1000;
let catalogCache;
let catalogExpiresAt = 0;
let catalogRequest;
const registeredFonts = new Map();

export class GoogleFontsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function loadCatalog() {
  if (!config.googleFontsApiKey) {
    throw new GoogleFontsError('Google Fonts API key is not configured on the server', 503);
  }
  if (catalogCache && Date.now() < catalogExpiresAt) return catalogCache;
  if (catalogRequest) return catalogRequest;

  catalogRequest = (async () => {
    const url = new URL(catalogUrl);
    url.searchParams.set('key', config.googleFontsApiKey);
    url.searchParams.set('sort', 'popularity');
    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new GoogleFontsError('Could not reach the Google Fonts API');
    }
    if (!response.ok) {
      throw new GoogleFontsError(`Google Fonts API request failed (${response.status})`);
    }
    const data = await response.json();
    if (!Array.isArray(data.items)) {
      throw new GoogleFontsError('Google Fonts API returned an invalid font list');
    }
    catalogCache = data.items;
    catalogExpiresAt = Date.now() + catalogTtl;
    return catalogCache;
  })();

  try {
    return await catalogRequest;
  } finally {
    catalogRequest = null;
  }
}

export async function listGoogleFonts() {
  const catalog = await loadCatalog();
  return catalog.map(({ family, variants }) => ({ family, variants }));
}

export async function registerGoogleFont(family, variant) {
  const catalog = await loadCatalog();
  const font = catalog.find((item) => item.family === family);
  const urlString = font?.files?.[variant];
  if (!urlString) {
    throw new GoogleFontsError('The selected Google font or style is not available', 400);
  }

  const url = new URL(urlString);
  if (url.protocol !== 'https:' || url.hostname !== 'fonts.gstatic.com') {
    throw new GoogleFontsError('Google Fonts returned an invalid font URL');
  }

  const key = `${family}:${variant}`;
  if (registeredFonts.has(key)) return registeredFonts.get(key);

  await fs.promises.mkdir(fontCacheDir, { recursive: true });
  const filename = `${crypto.createHash('sha256').update(key).digest('hex')}${path.extname(url.pathname) || '.ttf'}`;
  const fontPath = path.join(fontCacheDir, filename);

  try {
    await fs.promises.access(fontPath);
  } catch {
    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new GoogleFontsError('Could not download the selected Google font');
    }
    if (!response.ok) {
      throw new GoogleFontsError(`Could not download the selected Google font (${response.status})`);
    }
    const fontData = Buffer.from(await response.arrayBuffer());
    if (!fontData.length || fontData.length > 10 * 1024 * 1024) {
      throw new GoogleFontsError('The selected Google font file has an invalid size');
    }
    await fs.promises.writeFile(fontPath, fontData, { flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }

  const alias = `GuestName-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  if (!GlobalFonts.registerFromPath(fontPath, alias)) {
    throw new GoogleFontsError('The selected Google font format is not supported by the card renderer');
  }
  registeredFonts.set(key, alias);
  return alias;
}
