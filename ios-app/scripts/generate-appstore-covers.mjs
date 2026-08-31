// App Store 訴求カバー生成: キャラ「君斗りんく」＋キャッチコピー。
// 実スクショ(受信箱/設定)の前に差し込む「表紙」3枚を、2デバイスサイズで出力。
//
// 出力: store-assets/covers/iphone-67-0{a,b,c}.png (1290x2796)
//       store-assets/covers/iphone-65-0{a,b,c}.png (1242x2688)
// ファイル名の "0a/0b/0c" は capture 後に ios-screenshots/ へコピーされ、
// アップローダ(lib/asc-screenshot-upload.mjs)の .sort() で slot1(=..-1) より前に並ぶ。
//
// 生成物はリポにコミットするので、CI では sharp 不要(このスクリプトはローカル生成専用)。
// 実行例(sharp のある環境で): node scripts/generate-appstore-covers.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHAR = path.join(ROOT, 'store-assets', 'cover-assets', 'link.png');
const OUT_DIR = path.join(ROOT, 'store-assets', 'covers');

const DEVICES = [
  { prefix: 'iphone-67', W: 1290, H: 2796 },
  { prefix: 'iphone-65', W: 1242, H: 2688 },
];

// 3枚のコピー(悩み→解決の順)。headlineは{}内を強調色にする。
const COVERS = [
  {
    id: '0a',
    line1: 'メール返信、',
    line2: '秘書に丸投げ。',
    sub: '貼るだけ。あなたのトーンで下書きまで。',
  },
  {
    id: '0b',
    line1: '危ない返信は、',
    line2: '送る前に止める。',
    sub: '高リスクなメールをAIが先に警告します。',
  },
  {
    id: '0c',
    line1: '朝の「要返信」を、',
    line2: 'ひと目で。',
    sub: '通知とバッジで、確認漏れをゼロへ。',
  },
];

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 背景＋テキスト帯のSVG(キャラは後段でラスタ合成)
function bgSvg(W, H, cover) {
  const titleY = Math.round(H * 0.16);
  const lineGap = Math.round(W * 0.12);
  const titleSize = Math.round(W * 0.105);
  const subSize = Math.round(W * 0.042);
  return `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="55%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
    <radialGradient id="h" cx="50%" cy="72%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="70%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <style>
      .t { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; font-weight: 800; }
      .s { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; font-weight: 600; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#h)"/>
  <text x="${Math.round(W / 2)}" y="${titleY}" class="t" font-size="${titleSize}"
        fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${esc(cover.line1)}</text>
  <text x="${Math.round(W / 2)}" y="${titleY + lineGap}" class="t" font-size="${titleSize}"
        fill="#a5f3fc" text-anchor="middle" dominant-baseline="middle">${esc(cover.line2)}</text>
  <text x="${Math.round(W / 2)}" y="${titleY + lineGap + Math.round(W * 0.085)}" class="s" font-size="${subSize}"
        fill="rgba(255,255,255,0.9)" text-anchor="middle" dominant-baseline="middle">${esc(cover.sub)}</text>
  <rect x="${Math.round(W / 2) - 70}" y="${titleY + lineGap + Math.round(W * 0.12)}"
        width="140" height="8" rx="4" fill="#0f766e"/>
</svg>`;
}

// メール吹き出し(キャラの上に添える)。アイコンと同系のモチーフ。
function bubbleSvg(bw, bh) {
  return `
<svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0b1a3a" flood-opacity="0.4"/>
    </filter>
  </defs>
  <g filter="url(#ds)">
    <rect x="20" y="14" width="360" height="220" rx="42" fill="#ffffff"/>
    <path d="M96 232 L64 300 L150 226 Z" fill="#ffffff"/>
  </g>
  <g transform="translate(120,66)">
    <rect x="0" y="0" width="160" height="112" rx="16" fill="#eef4ff" stroke="#1d4ed8" stroke-width="9"/>
    <path d="M6 14 L80 68 L154 14" fill="none" stroke="#1d4ed8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g transform="translate(236,150)">
    <circle cx="36" cy="36" r="42" fill="#0f766e" stroke="#ffffff" stroke-width="6"/>
    <path d="M48 18 L24 36 L48 54" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M24 36 H58" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  </g>
</svg>`;
}

async function buildOne(dev, cover, outPath) {
  const { W, H } = dev;
  const bg = await sharp(Buffer.from(bgSvg(W, H, cover))).png().toBuffer();

  // キャラ: 下半分中央に大きく配置
  const charW = Math.round(W * 0.72);
  const charBuf = await sharp(CHAR)
    .resize({ width: charW, height: charW, fit: 'inside' })
    .toBuffer();
  const cm = await sharp(charBuf).metadata();
  const charLeft = Math.round((W - cm.width) / 2);
  const charTop = Math.round(H * 0.60 - cm.height / 2);

  // キャラの影
  const alphaBlur = await sharp(charBuf)
    .ensureAlpha().extractChannel('alpha').blur(18).linear(0.5, 0).toBuffer();
  const charShadow = await sharp({
    create: { width: cm.width, height: cm.height, channels: 3, background: { r: 10, g: 15, b: 35 } },
  }).joinChannel(alphaBlur).png().toBuffer();

  // 吹き出し: キャラの右上に重ねる
  const bw = Math.round(W * 0.34);
  const bh = Math.round(bw * 0.75);
  const bubble = await sharp(Buffer.from(bubbleSvg(bw, bh))).png().toBuffer();
  const bubLeft = Math.round(W * 0.54);
  const bubTop = Math.round(charTop - bh * 0.55);

  const composed = await sharp(bg)
    .composite([
      { input: charShadow, left: charLeft + 10, top: charTop + 18 },
      { input: charBuf, left: charLeft, top: charTop },
      { input: bubble, left: bubLeft, top: Math.max(0, bubTop) },
    ])
    .flatten({ background: { r: 29, g: 78, b: 216 } })
    .png()
    .toFile(outPath);
  return composed;
}

async function main() {
  if (!fs.existsSync(CHAR)) throw new Error(`character asset not found: ${CHAR}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const dev of DEVICES) {
    for (const cover of COVERS) {
      const out = path.join(OUT_DIR, `${dev.prefix}-${cover.id}.png`);
      await buildOne(dev, cover, out);
      console.log(`wrote ${path.relative(ROOT, out)} (${dev.W}x${dev.H})`);
    }
  }
  console.log('\nAll covers generated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
