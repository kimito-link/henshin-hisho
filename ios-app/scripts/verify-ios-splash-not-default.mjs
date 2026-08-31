#!/usr/bin/env node
// iOS スプラッシュ「Capacitor デフォルト出荷事故」防止ゲート（直接証拠方式）。
//
// 背景:
//   `cap add ios` は青×ロゴの Capacitor デフォルトスプラッシュを置く。
//   スプラッシュ用マスター画像が無いと @capacitor/assets はスプラッシュを生成せず、
//   そのデフォルトがそのまま出荷される（実際に Exosome で踏んだ事故）。
//   さらに @capacitor/assets は旧ファイルを上書きせず「新ファイル名で書いて
//   Contents.json を差し替える」ため、固定ファイル名のハッシュ比較では検証できない。
//
// このスクリプトの方式（出典: Exosome ios-appstore-release.yml で実証）:
//   1. `@capacitor/assets generate` を呼ぶ「前」に、Splash.imageset/Contents.json が
//      参照する画像（= Capacitor デフォルト）の sha256 集合を記録（--snapshot）。
//   2. 生成「後」に、Contents.json が参照する画像が全て存在し、かつ手順1で記録した
//      デフォルトのハッシュ集合に1つも含まれないことを確認（--verify）。
//      1つでも一致＝ブランド素材に差し替わっていない → 非ゼロ終了でビルドを止める。
//
// 使い方（CI のスプラッシュ生成ステップを挟む形で2回呼ぶ）:
//   node scripts/verify-ios-splash-not-default.mjs --snapshot
//   npx @capacitor/assets generate --ios ...   # 既存の生成ステップ
//   node scripts/verify-ios-splash-not-default.mjs --verify
//
// オプション:
//   --imageset <path>  既定: ios/App/App/Assets.xcassets/Splash.imageset
//   --state <path>     スナップショット保存先 既定: .splash-default-hashes.json
//
// 注意: アプリ固有値は持たない（パスは Capacitor 標準構成のみ）。完全に汎用。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const MODE = process.argv.includes('--snapshot') ? 'snapshot'
  : process.argv.includes('--verify') ? 'verify' : null;
const IMAGESET = arg('--imageset', path.join('ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset'));
const STATE = arg('--state', '.splash-default-hashes.json');

function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

function referenced(imageset) {
  const contents = path.join(imageset, 'Contents.json');
  if (!fs.existsSync(contents)) fail(`${contents} が存在しません（Splash.imageset が壊れています）。`);
  const json = JSON.parse(fs.readFileSync(contents, 'utf8'));
  return (json.images || []).map((i) => i.filename).filter(Boolean);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (!MODE) fail('--snapshot か --verify を指定してください。');

if (MODE === 'snapshot') {
  const files = referenced(IMAGESET);
  const hashes = [...new Set(files.map((f) => sha256(path.join(IMAGESET, f))))].sort();
  fs.writeFileSync(STATE, JSON.stringify({ defaultHashes: hashes }, null, 2));
  console.log(`snapshot: ${hashes.length} 個のデフォルトスプラッシュ画像ハッシュを記録 → ${STATE}`);
  process.exit(0);
}

// verify
if (!fs.existsSync(STATE)) fail(`${STATE} がありません。先に --snapshot を実行してください。`);
const { defaultHashes } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const defaults = new Set(defaultHashes || []);
const files = referenced(IMAGESET);
if (files.length === 0) fail('生成後の Splash.imageset/Contents.json が画像を参照していません。');

for (const f of files) {
  const p = path.join(IMAGESET, f);
  if (!fs.existsSync(p)) fail(`Contents.json が参照する ${f} が存在しません（壊れた imageset が出荷されます）。`);
  const h = sha256(p);
  if (defaults.has(h)) {
    fail(`${f} が Capacitor デフォルトのスプラッシュのままです（ブランド素材に差し替わっていません）。`);
  }
  console.log(`splash OK: ${f} (sha256: ${h})`);
}
console.log('スプラッシュ検証: OK（Capacitor デフォルトは出荷されません）');
