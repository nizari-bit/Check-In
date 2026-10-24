import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GlobalFonts } from '@napi-rs/canvas';
import { config } from './config.js';

const fontCacheDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/card/fonts/google');
const catalogUrl = 'https://www.googleapis.com/webfonts/v1/webfonts';
const catalogTtl = 6 * 60 * 60 * 1000;      // keep the font list for 6 hours
const staleRetry = 5 * 60 * 1000;           // if Google is down, keep using the old list and retry in 5 minutes
const NETWORK_TIMEOUT_MS = 8000;            // never let a slow connection hang the page
let catalogCache;
let catalogExpiresAt = 0;
let catalogRequest;
const registeredFonts = new Map();

// What people see is always short and friendly. The technical reason stays in `detail` and goes to the server log only.
const FRIENDLY = {
  not_configured: "Custom fonts aren't set up yet, so the default font will be used for guest names.",
  unavailable: "We couldn't load the font list right now. The default font will be used for now, so please try again in a little while.",
  font_unavailable: "That font style isn't available. Please choose another style.",
};

export class GoogleFontsError extends Error {
  constructor(code = 'unavailable', status = 503, detail = '') {
    super(FRIENDLY[code] || FRIENDLY.unavailable);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const timeout = () => AbortSignal.timeout(NETWORK_TIMEOUT_MS);

async function loadCatalog() {
  if (!config.googleFontsApiKey) throw new GoogleFontsError('not_configured', 503, 'GOOGLE_FONTS key is not set');
  if (catalogCache && Date.now() < catalogExpiresAt) return catalogCache;
  if (catalogRequest) return catalogRequest;

  catalogRequest = (async () => {
    try {
      const url = new URL(catalogUrl);
      url.searchParams.set('key', config.googleFontsApiKey);
      url.searchParams.set('sort', 'popularity');
      let response;
      try {
        response = await fetch(url, { signal: timeout() });
      } catch (err) {
        throw new GoogleFontsError('unavailable', 503, `font list request failed (${err.name})`);
      }
      if (!response.ok) throw new GoogleFontsError('unavailable', 503, `font list request returned HTTP ${response.status}`);
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.items)) throw new GoogleFontsError('unavailable', 503, 'font list had an unexpected format');
      catalogCache = data.items;
      catalogExpiresAt = Date.now() + catalogTtl;
      return catalogCache;
    } catch (err) {
      console.warn('[fonts]', err.detail || err.message);
      if (catalogCache) {            // better an older list than no list
        catalogExpiresAt = Date.now() + staleRetry;
        return catalogCache;
      }
      throw err;
    }
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
  if (!urlString) throw new GoogleFontsError('font_unavailable', 400, `${family} / ${variant} is not in the font list`);

  const url = new URL(urlString);
  if (url.protocol !== 'https:' || url.hostname !== 'fonts.gstatic.com') {
    throw new GoogleFontsError('unavailable', 503, 'font file came from an unexpected address');
  }

  const key = `${family}:${variant}`;
  if (registeredFonts.has(key)) return registeredFonts.get(key);

  await fs.promises.mkdir(fontCacheDir, { recursive: true });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const fontPath = path.join(fontCacheDir, `${hash}${path.extname(url.pathname) || '.ttf'}`);

  try {
    await fs.promises.access(fontPath);
  } catch {
    let response;
    try {
      response = await fetch(url, { signal: timeout() });
    } catch (err) {
      throw new GoogleFontsError('unavailable', 503, `font download failed (${err.name})`);
    }
    if (!response.ok) throw new GoogleFontsError('unavailable', 503, `font download returned HTTP ${response.status}`);
    const fontData = Buffer.from(await response.arrayBuffer());
    if (!fontData.length || fontData.length > 10 * 1024 * 1024) {
      throw new GoogleFontsError('unavailable', 503, 'font file has an invalid size');
    }
    await fs.promises.writeFile(fontPath, fontData, { flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }

  const alias = `GuestName-${hash.slice(0, 16)}`;
  if (!GlobalFonts.registerFromPath(fontPath, alias)) {
    throw new GoogleFontsError('unavailable', 503, 'font file format is not supported');
  }
  registeredFonts.set(key, alias);
  return alias;
}
