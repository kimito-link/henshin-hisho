/**
 * 【採用発明B】配信前ゲートの「直接証拠」スキャナ。
 * 発明会議(golden-pattern-inventions-council, total 37・全会一致採用)で採択。
 *
 * 目的: ios-blackscreen-check は既に simlog(log stream)を取得しているのに、配信可否は
 * 輝度(luma)だけで判定し、ログの直接証拠を捨てている。本スクリプトはその simlog から
 * 「WKWebView が生成されたか」「server.url にHTTPが飛んだか」を抽出し、判定に補強情報を渡す。
 * 富士山 POSTMORTEM 行26「WKWebViewログ0行・対象URLへのHTTP0行＝WKWebView未生成」=
 * 当時人間が真因を確定させた決め手そのものをゲート化する(原則5「推測で配信しない」強化)。
 *
 * ## 設計の絶対条件(会議の全会一致ガード・厳守)
 *  1. luma を判定主軸に据え置く。このスクリプトは exit を握らない(常に exit 0)。
 *  2. ログは2用途のみ: (1) luma赤のときの真因ラベル (2) luma緑だが痕跡ゼロのときの疑義warning。
 *  3. 不在(negative)で即断しない。出現は確実なシグナル、不在は取りこぼし/タイミングで起こりうる。
 *     総ログ行数が極小なら不在判定を無効化(観測失敗とバグ無しを区別)。
 *  4. HTTPホストは固定文字列でなく env SERVER_URL_HOST で動的に渡す(値ズレ空振り防止)。
 *  5. 語彙は iOS/Xcode version 耐性のため広く OR。
 *
 * ## 入出力
 *  入力: argv[2]=simlogパス(既定 logs/ios-blackscreen/simlog.txt)
 *        env SERVER_URL_HOST(例 app.web-health-check.link)
 *        env LUMA_OUTCOME(輝度チェックの success/failure。ラベル文言の出し分けに使う)
 *  出力: $GITHUB_OUTPUT に webview= / http= / fatal= / loglines= / verdict_label=
 *        標準出力に人間可読サマリ。exit code は常に 0(観測のみ)。
 *
 * Node 単体で動く純ロジック。Mac 不要でテストできる(simlog を食わせるだけ)。
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const LOG_PATH = process.argv[2] || 'logs/ios-blackscreen/simlog.txt';
const SERVER_URL_HOST = (process.env.SERVER_URL_HOST || '').trim();
const LUMA_OUTCOME = (process.env.LUMA_OUTCOME || '').trim(); // 'success' | 'failure' | ''

// WKWebView 生成の痕跡(version 耐性で広く OR)。出現=確実な肯定証拠。
const WEBVIEW_PATTERNS = [
  /WKWebView/i,
  /WebContent/i,
  /com\.apple\.WebKit/i,
  /GPUProcess/i,
  /didStartProvisionalNavigation/i,
  /didCommit(?:Navigation)?/i,
  /loadRequest|loadFileURL/i,
];

// 致命シグナル(出たら真因ラベルになる positive な悪シグナル)。
const FATAL_PATTERNS = [
  /\bcrash(?:ed)?\b/i,
  /\bexception\b/i,
  /\bkilled\b/i,
  /\bfatal\b/i,
  /App-?Bound/i,
  /did ?fail provisional/i,
  /NSError.*-100\d/i,
];

// HTTP がネットワーク文脈で出ているか(ホスト名 + 通信語の共起)。
const NET_CONTEXT = /(NSURLSession|TCP|Connection|\bGET\b|provisional|nw_|boringssl|quic)/i;

function scan(text) {
  const lines = text.split(/\r?\n/);
  const logLines = lines.length;
  let webview = false;
  let http = false;
  let fatal = false;

  for (const line of lines) {
    if (!webview && WEBVIEW_PATTERNS.some((re) => re.test(line))) webview = true;
    if (!fatal && FATAL_PATTERNS.some((re) => re.test(line))) fatal = true;
    if (!http && SERVER_URL_HOST && line.includes(SERVER_URL_HOST) && NET_CONTEXT.test(line)) {
      http = true;
    }
  }
  return { webview, http, fatal, logLines };
}

function buildLabel({ webview, http, fatal, logLines }) {
  // 総ログが極小 = 観測失敗。不在判定を無効化(バグ無しと区別できない)。
  const observationReliable = logLines >= 30;
  const lumaRed = LUMA_OUTCOME === 'failure';

  if (lumaRed && observationReliable && !webview && !http) {
    return {
      level: 'error',
      label:
        '黒画面 確度【高】: 輝度赤 かつ WKWebView生成ログ無し・server.url不達 ' +
        '(POSTMORTEM 行26 と同一シグネチャ=WKWebView未生成)。配信しないこと。',
    };
  }
  if (lumaRed && fatal) {
    return {
      level: 'error',
      label: '輝度赤 かつ 致命シグナル検出(crash/App-Bound 等)。simlog の fatal 行を確認。',
    };
  }
  if (lumaRed) {
    return {
      level: 'error',
      label: '輝度赤(直接証拠は判定保留: ログ取りこぼしの可能性)。luma 判定に従い配信停止。',
    };
  }
  // luma 緑だが痕跡ゼロ = 疑義 warning(緑のまま、exit は握らない)
  if (observationReliable && !webview) {
    return {
      level: 'warning',
      label:
        '輝度は緑だが WKWebView 生成ログが見当たらない。偽緑(luma フリーク)の可能性。' +
        'simlog を目視確認推奨(配信は止めない)。',
    };
  }
  return { level: 'notice', label: '直接証拠: WKWebView 生成痕跡あり。輝度緑と整合。' };
}

function main() {
  if (!existsSync(LOG_PATH)) {
    console.log(`[ios-sim-logscan] simlog 無し (${LOG_PATH}) — スキップ(観測のみ・判定しない)`);
    writeOutputs({ webview: false, http: false, fatal: false, logLines: 0 }, {
      level: 'notice',
      label: 'simlog 無し(観測スキップ)',
    });
    return;
  }
  const text = readFileSync(LOG_PATH, 'utf8');
  const sig = scan(text);
  const verdict = buildLabel(sig);

  console.log('[ios-sim-logscan] 直接証拠スキャン結果:');
  console.log(`  WKWebView生成: ${sig.webview}`);
  console.log(`  server.url(${SERVER_URL_HOST || '未指定'})到達: ${sig.http}`);
  console.log(`  致命シグナル: ${sig.fatal}`);
  console.log(`  総ログ行数: ${sig.logLines}`);
  console.log(`  luma: ${LUMA_OUTCOME || '未指定'}`);
  console.log(`  → [${verdict.level}] ${verdict.label}`);

  // GitHub Actions のアノテーション(exit は握らない)
  if (verdict.level === 'error') console.log(`::error::${verdict.label}`);
  else if (verdict.level === 'warning') console.log(`::warning::${verdict.label}`);

  writeOutputs(sig, verdict);
}

function writeOutputs(sig, verdict) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = [
    `webview=${sig.webview}`,
    `http=${sig.http}`,
    `fatal=${sig.fatal}`,
    `loglines=${sig.logLines}`,
    `verdict_level=${verdict.level}`,
    `verdict_label=${verdict.label.replace(/\n/g, ' ')}`,
  ].join('\n');
  appendFileSync(out, lines + '\n');
}

main();
// 観測のみ・判定主軸は luma。常に正常終了する(exit を握らない=会議の絶対条件1)。
process.exit(0);
