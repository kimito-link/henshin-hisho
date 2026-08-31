#!/usr/bin/env node
import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadAppConfig } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const config = loadAppConfig();

const ASSETS_DIR = path.join(ROOT, 'assets');
const STORE_ICON = path.join(ROOT, 'store-assets', 'appstore', 'app-icon-1024.png');
const ASSETS_ICON = path.join(ASSETS_DIR, 'icon-only.png');
const SPLASH = path.join(ASSETS_DIR, 'splash.png');
const SPLASH_DARK = path.join(ASSETS_DIR, 'splash-dark.png');
const SIZE = 2732;
const ICON_SIZE = 1024;
const BG = '#0A0A0F';

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function svgText() {
  const primary = config.brand?.primaryColor || '#1d4ed8';
  const accent = config.brand?.accentColor || '#0f766e';
  const name = config.identity?.displayName || 'AI返信秘書';
  return `
  <svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${primary}"/>
        <stop offset="100%" stop-color="${accent}"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#020617" flood-opacity="0.32"/>
      </filter>
    </defs>
    <rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="224" fill="url(#bg)"/>
    <g filter="url(#shadow)">
      <rect x="188" y="240" width="648" height="496" rx="96" fill="#ffffff"/>
      <path d="M292 374h440M292 498h340M292 622h232" stroke="${primary}" stroke-width="52" stroke-linecap="round"/>
      <circle cx="724" cy="652" r="86" fill="${accent}"/>
      <path d="M684 652l30 30 58-70" fill="none" stroke="#ffffff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="512" y="892" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif" font-size="72" font-weight="800" fill="#ffffff">${name}</text>
  </svg>`;
}

async function ensureIcon() {
  await mkdir(path.dirname(STORE_ICON), { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });
  if (!(await exists(STORE_ICON))) {
    const png = await sharp(Buffer.from(svgText())).png().toBuffer();
    await writeFile(STORE_ICON, png);
    console.log(`wrote ${STORE_ICON}`);
  }
  await copyFile(STORE_ICON, ASSETS_ICON);
  console.log(`wrote ${ASSETS_ICON}`);
}

async function buildSplash() {
  const icon = await sharp(STORE_ICON)
    .resize({ width: Math.round(SIZE * 0.34), withoutEnlargement: false })
    .png()
    .toBuffer();
  const composed = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toBuffer();

  await writeFile(SPLASH, composed);
  await writeFile(SPLASH_DARK, composed);
  console.log(`wrote ${SPLASH}`);
  console.log(`wrote ${SPLASH_DARK}`);
}

async function main() {
  await ensureIcon();
  if (!fs.existsSync(STORE_ICON)) throw new Error(`icon not found: ${STORE_ICON}`);
  await buildSplash();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
