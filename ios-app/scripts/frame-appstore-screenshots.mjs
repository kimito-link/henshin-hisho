#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/frame-appstore-screenshots.mjs
//   (リバースハック固有のキャプション文・mock ダッシュボード SVG を除去し、
//    ブランド色を app.config.json から、キャプションを screenshot-plan.json から取得。
//    mock は1種類の汎用プレースホルダに簡素化)。
//
// 生の App Store スクショを「グラデ背景 + 日本語キャプション + 角丸+影付き実機画像」の
// 仕上げショットに加工する。純粋な画像処理(sharp)のみ — ブラウザ/ネットワーク/外部 upload なし
// (reviewer ダッシュボードのデータが機外に出ない。SaaS GUI でなく in-repo で組む理由)。
//
// In/out:
//   IN_DIR  (既定 ios-screenshots)         raw iphone-{67,65}-{N}.png
//   OUT_DIR (既定 ios-screenshots-framed)   仕上げ済み・同一ピクセル寸法
// 出力は入力と同じ寸法(1290x2796 / 1242x2688)を保つので asc-screenshot-upload.mjs がそのまま受理する。
//
// ★キャプションはコードを触らず screenshot-plan.json の framedCaptions で与える:
//   { "framedCaptions": { "1": { "headline": "…{強調}…", "sub": "…" }, "2": {…} } }
//   headline 内の {波括弧} はアクセント色になる。\n で改行。無ければ slot 1 のを流用、それも無ければ無地。
//
// MOCK=1 で実スクショ前にフレーミング/デザインをプレビュー(汎用プレースホルダを合成)。
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MOCK = process.env.MOCK === '1';
const IN_DIR = process.env.IN_DIR || (MOCK ? '.preview-raw' : 'ios-screenshots');
const OUT_DIR = process.env.OUT_DIR || (MOCK ? 'ios-screenshots-framed-preview' : 'ios-screenshots-framed');

// --- DESIGN(自由に調整。compositing ロジックは触らなくてよい) ---
const DESIGN = {
  bgTop: '#0E2747',
  bgBottom: '#1E4E8C',
  headlineColor: '#FFFFFF',
  headlineAccent: cfg('brand.primaryColor', '#43C251'), // app.config.json brand.primaryColor
  subColor: '#B9CCE6',
  fontFamily:
    "'Yu Gothic UI','Yu Gothic','Hiragino Kaku Gothic ProN','Noto Sans CJK JP','Meiryo','MS PGothic',sans-serif",
  headlineSizeRatio: 0.052,
  subSizeRatio: 0.027,
  headlineLineHeight: 1.3,
  firstBaselineRatio: 0.062,
  deviceTopRatio: 0.155,
  deviceBottomMarginRatio: 0.032,
  cornerRadiusRatio: 0.05,
  shadowBlur: 38,
  shadowAlpha: 0.34,
  shadowDy: 24,
};

// キャプションは screenshot-plan.json の framedCaptions から(コードを触らない)。
function loadCaptions() {
  const candidates = [process.env.SCREENSHOT_PLAN, path.join(ROOT, 'store-assets', 'screenshot-plan.json')].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const plan = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (plan.framedCaptions) return plan.framedCaptions;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}
const CAPTIONS = loadCaptions();
const appName = cfg('identity.displayName') || cfg('identity.displayNameEn') || 'App';

const SIZES = [
  { prefix: 'iphone-67', w: 1290, h: 2796 },
  { prefix: 'iphone-65', w: 1242, h: 2688 },
];
// --------------------------------------------------------------------------

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function headlineTspans(line) {
  return line
    .split(/(\{[^}]*\})/)
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^\{([^}]*)\}$/);
      return m ? `<tspan fill="${DESIGN.headlineAccent}">${xml(m[1])}</tspan>` : `<tspan>${xml(p)}</tspan>`;
    })
    .join('');
}

function backgroundSvg(W, H, caption) {
  const hSize = Math.round(W * DESIGN.headlineSizeRatio);
  const sSize = Math.round(W * DESIGN.subSizeRatio);
  const lineH = Math.round(hSize * DESIGN.headlineLineHeight);
  const cx = Math.round(W / 2);
  const first = Math.round(H * DESIGN.firstBaselineRatio);
  const lines = (caption.headline || '').split('\n');
  const headlineEls = lines
    .map(
      (ln, i) =>
        `<text x="${cx}" y="${first + i * lineH}" text-anchor="middle" font-family="${DESIGN.fontFamily}" font-size="${hSize}" font-weight="800" fill="${DESIGN.headlineColor}">${headlineTspans(ln)}</text>`,
    )
    .join('');
  const subY = first + lines.length * lineH + Math.round(sSize * 0.2);
  const subEl = caption.sub
    ? `<text x="${cx}" y="${subY}" text-anchor="middle" font-family="${DESIGN.fontFamily}" font-size="${sSize}" font-weight="500" fill="${DESIGN.subColor}">${xml(caption.sub)}</text>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${DESIGN.bgTop}"/>
        <stop offset="1" stop-color="${DESIGN.bgBottom}"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      ${headlineEls}${subEl}
    </svg>`,
  );
}

const roundedRectSvg = (w, h, r, fill) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"/></svg>`,
  );

async function frameOne(inputPath, outPath, caption) {
  const meta = await sharp(inputPath).metadata();
  const W = meta.width;
  const H = meta.height;
  const availH = Math.round(H * (1 - DESIGN.deviceTopRatio - DESIGN.deviceBottomMarginRatio));
  const dh = availH;
  const dw = Math.round((dh * W) / H);
  const radius = Math.round(dw * DESIGN.cornerRadiusRatio);
  const deviceTop = Math.round(H * DESIGN.deviceTopRatio);
  const deviceLeft = Math.round((W - dw) / 2);

  const resized = await sharp(inputPath).resize({ width: dw, height: dh, fit: 'fill' }).toBuffer();
  const rounded = await sharp(resized)
    .composite([{ input: roundedRectSvg(dw, dh, radius, '#ffffff'), blend: 'dest-in' }])
    .png()
    .toBuffer();

  const pad = DESIGN.shadowBlur * 3;
  const shadow = await sharp({
    create: { width: dw + pad * 2, height: dh + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: roundedRectSvg(dw, dh, radius, `rgba(0,0,0,${DESIGN.shadowAlpha})`), left: pad, top: pad }])
    .blur(DESIGN.shadowBlur)
    .png()
    .toBuffer();

  await sharp(backgroundSvg(W, H, caption))
    .composite([
      { input: shadow, left: deviceLeft - pad, top: deviceTop - pad + DESIGN.shadowDy },
      { input: rounded, left: deviceLeft, top: deviceTop },
    ])
    .png()
    .toFile(outPath);
}

// --- MOCK: 汎用プレースホルダ(実スクショ前にフレーミングを確認するためだけのダミー) ---
function mockSvg(W, H, slot) {
  const F = DESIGN.fontFamily;
  const pad = Math.round(W * 0.07);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#101826"/><stop offset="1" stop-color="#1B2A44"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#h)"/>
      <rect x="${pad}" y="${Math.round(H * 0.2)}" width="${W - pad * 2}" height="${Math.round(H * 0.5)}" rx="28" fill="#FFFFFF10" stroke="#FFFFFF22"/>
      <text x="${Math.round(W / 2)}" y="${Math.round(H * 0.43)}" text-anchor="middle" font-family="${F}" font-size="${Math.round(W * 0.05)}" font-weight="800" fill="#ffffff">${xml(appName)}</text>
      <text x="${Math.round(W / 2)}" y="${Math.round(H * 0.49)}" text-anchor="middle" font-family="${F}" font-size="${Math.round(W * 0.028)}" fill="#9FB3D1">screen ${slot}</text>
      <text x="${Math.round(W / 2)}" y="${H - 40}" text-anchor="middle" font-family="${F}" font-size="${Math.round(W * 0.02)}" fill="#7B8BA6">[ MOCK — placeholder ]</text>
    </svg>`,
  );
}

async function generateMockInputs() {
  fs.mkdirSync(IN_DIR, { recursive: true });
  const mockSlots = Object.keys(CAPTIONS).map(Number).filter((n) => !Number.isNaN(n));
  const slots = mockSlots.length > 0 ? mockSlots : [1, 2, 3];
  let n = 0;
  for (const { prefix, w, h } of SIZES) {
    for (const slot of slots) {
      const dest = path.join(IN_DIR, `${prefix}-${slot}.png`);
      if (fs.existsSync(dest)) continue; // 実スクショは残す
      await sharp(mockSvg(w, h, slot)).png().toFile(dest);
      n += 1;
    }
  }
  console.log(`[mock] wrote ${n} placeholder captures to ${IN_DIR}/ (existing real captures kept)`);
}
// --------------------------------------------------------------------------

if (MOCK) await generateMockInputs();

if (!fs.existsSync(IN_DIR)) {
  console.error(`[frame] input dir not found: ${IN_DIR} (capture step を先に実行、または MOCK=1)`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs
  .readdirSync(IN_DIR)
  .filter((f) => /^iphone-\d+-\d+\.png$/i.test(f))
  .sort();
if (files.length === 0) {
  console.error(`[frame] no iphone-*-N.png files in ${IN_DIR}`);
  process.exit(1);
}

const fallbackCaption = CAPTIONS['1'] || { headline: '', sub: '' };
for (const file of files) {
  const slot = Number(file.match(/-(\d+)\.png$/i)[1]);
  const caption = CAPTIONS[String(slot)] || fallbackCaption;
  const out = path.join(OUT_DIR, file);
  await frameOne(path.join(IN_DIR, file), out, caption);
  console.log(`  framed ${file} (slot ${slot}: ${(caption.headline || '(no caption)').replace(/\n/g, ' ')})`);
}
console.log(`\nDone. Framed ${files.length} screenshot(s) -> ${OUT_DIR}/`);
