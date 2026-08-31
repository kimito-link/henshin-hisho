#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/capture-appstore-screenshots.mjs
//   (リバースハック固有の URL / セクション文言 / Clerk セレクタ / キャプション文を除去し、
//    app.config.json + 環境変数 + 外部 JSON(screenshot-plan)駆動に一般化)。
//
// デプロイ済みサイトから App Store スクショを Playwright で撮る。
//
// 設計(ディープリサーチ + 実証):
//   - データ上「最初の3枚に全力 + 計5-6枚」が最適。Value → Usage → Trust。
//   - 各スクショに「動詞+ベネフィット+結果」のキャプション帯を合成(検索はキャプション文字も解析)。
//   - v1.0.7 は 2.3.3(ログイン/スプラッシュ画面)で却下された。ログイン画面は出さない。
//     さらにオンボ overlay が全画面を覆う事故を避けるため localStorage で「完了済み」にして抑止。
//
// 解像度(Apple 必須寸法):
//   iphone-67 (16/15 Pro Max): 1290x2796  (430×932 @3x)
//   iphone-65 (XS Max/11 Pro Max): 1242x2688 (414×896 @3x)
// 出力: <OUT_DIR>/iphone-{67,65}-{1..N}.png(scripts/lib/asc-screenshot-upload.mjs がファイル名順で拾う)。
//
// ★アプリ固有の撮影計画(撮るページ・キャプション・ログイン手順)は、コードを触らず
//   外部 JSON で与える。優先順: env SCREENSHOT_PLAN(パス) → store-assets/screenshot-plan.json。
//   無ければトップページ1枚のみ撮る最小フォールバック。JSON 形式は下の DEFAULT_PLAN を参照。
//
// 環境変数:
//   SCREENSHOT_URL                  撮影対象(既定: app.config.json identity.productionDomain)
//   SCREENSHOT_OUT_DIR              出力(既定: ios-screenshots)
//   SCREENSHOT_PLAN                 撮影計画 JSON のパス
//   IOS_REVIEW_DEMO_USERNAME/_PASSWORD  ログイン認証アプリのデモ資格
//   SCREENSHOT_ALLOW_NO_AUTH=1      ローカルで public のみ撮る時(CI/本番では渡さない)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg, productionUrl } from './lib/app-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const URL = productionUrl();
const OUT_DIR = process.env.SCREENSHOT_OUT_DIR || 'ios-screenshots';
const DEMO_USER = process.env.IOS_REVIEW_DEMO_USERNAME;
const DEMO_PASS = process.env.IOS_REVIEW_DEMO_PASSWORD;
const BRAND_PRIMARY = cfg('brand.primaryColor', '#4facfe');
const BRAND_ACCENT = cfg('brand.accentColor', '#dd6500');

// --- 撮影計画(外部 JSON でアプリごとに差し替え。コードは触らない) ---
// publicPages: ログイン不要で撮るページ。 auth: ログイン後に撮るタブ。
const DEFAULT_PLAN = {
  // ログイン後の到達URL(正規表現)。ログイン認証アプリのみ使用。
  dashboardUrlRegex: '/dashboard',
  signInPath: '/sign-in',
  // ログイン不要で価値が伝わるページ(最初の数枚=勝負どころ)。
  publicPages: [
    { slot: 1, path: '/', label: 'home', title: '', subtitle: '', scrollToSelector: null },
  ],
  // ログイン後に撮るタブ。creds 無ければスキップ(public 枚数で 2.3.3 はクリア)。
  authTabs: [],
};

function loadPlan() {
  const candidates = [process.env.SCREENSHOT_PLAN, path.join(ROOT, 'store-assets', 'screenshot-plan.json')].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const plan = JSON.parse(fs.readFileSync(p, 'utf8'));
        console.log(`[capture] using plan: ${path.relative(ROOT, p)}`);
        return { ...DEFAULT_PLAN, ...plan };
      }
    } catch (e) {
      console.warn(`[capture] failed to parse plan ${p}: ${e.message}`);
    }
  }
  console.log('[capture] no screenshot-plan.json — capturing home page only');
  return DEFAULT_PLAN;
}
const PLAN = loadPlan();
const hasAuthPlan = (PLAN.authTabs && PLAN.authTabs.length > 0);

// fail-closed: ログイン後タブを撮る計画があるのに creds が無ければ即停止。
// silent fallback はダッシュボードのスクショ欠落 = 2.3.3(v1.0.7)再発につながる。
if (hasAuthPlan && (!DEMO_USER || !DEMO_PASS) && process.env.SCREENSHOT_ALLOW_NO_AUTH !== '1') {
  console.error(
    '[capture-screenshots] この撮影計画はログイン後タブを含むため IOS_REVIEW_DEMO_USERNAME と ' +
      'IOS_REVIEW_DEMO_PASSWORD が必須(Apple Guideline 2.3.3 fail-closed — _docs/apple-reject-knowledge-base.md 参照)。' +
      'ローカルで public のみ撮るなら SCREENSHOT_ALLOW_NO_AUTH=1 を渡す。',
  );
  process.exit(1);
}

// オンボーディングの localStorage キー(アプリごとに違う。env で上書き)。
const ONBOARDING_KEY = process.env.SCREENSHOT_ONBOARDING_KEY || cfg('identity.shortName', 'app') + '_onboarding_completed';

const DEVICES = [
  { prefix: 'iphone-67', cssWidth: 430, cssHeight: 932, scale: 3 },
  { prefix: 'iphone-65', cssWidth: 414, cssHeight: 896, scale: 3 },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

// social ログインボタン隠し(Playwright は Capacitor bridge を偽装できず、実機で隠れる
// ボタンが capture では見える。CSS で先回り)+ 横スクロール抑制(キャプション帯ずれ防止)。
const HIDE_SOCIAL_CSS = `
  .cl-socialButtons,
  .cl-socialButtonsBlockButton,
  .cl-socialButtonsIconButton,
  [data-clerk-component^="SignIn-Social"],
  [data-localization-key^="socialButtonsBlockButton__"],
  [data-provider],
  button[aria-label*="Google" i],
  button[aria-label*="Apple" i] {
    display: none !important;
  }
  html, body { overflow-x: hidden !important; max-width: 100vw !important; }
`;

// 撮影直前にキャプション帯を最前面に差し込む(撮影後に外す)。
async function withCaption(page, { title, subtitle }, shoot) {
  if (!title) {
    await shoot();
    return;
  }
  await page.evaluate(
    ({ title, subtitle, primary, accent }) => {
      const id = '__aso_caption__';
      document.getElementById(id)?.remove();
      const el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'width:100%',
        'box-sizing:border-box', 'z-index:2147483647',
        'padding:64px 26px 40px', 'pointer-events:none',
        'background:linear-gradient(180deg, #0A0A0F 0%, #0A0A0F 72%, rgba(10,10,15,0.92) 88%, rgba(10,10,15,0) 100%)',
        'font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif',
        'text-align:center',
      ].join(';');
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = [
        'color:#ffffff', 'font-weight:800', 'font-size:24px', 'line-height:1.35',
        'letter-spacing:0.005em', 'text-shadow:0 2px 12px rgba(0,0,0,0.5)',
        'white-space:normal', 'overflow-wrap:anywhere', 'word-break:normal',
        'max-width:100%', 'margin:0 auto',
      ].join(';');
      el.appendChild(h);
      if (subtitle) {
        const p = document.createElement('div');
        p.textContent = subtitle;
        p.style.cssText = [
          'color:rgba(244,246,251,0.92)', 'font-weight:500', 'font-size:15px',
          'line-height:1.5', 'margin-top:10px',
          'white-space:normal', 'overflow-wrap:anywhere', 'max-width:100%',
        ].join(';');
        el.appendChild(p);
      }
      const bar = document.createElement('div');
      bar.style.cssText = [
        'width:54px', 'height:4px', 'border-radius:2px', 'margin:16px auto 0',
        `background:linear-gradient(90deg,${primary},${accent})`,
      ].join(';');
      el.appendChild(bar);
      (document.body || document.documentElement).appendChild(el);
    },
    { title, subtitle, primary: BRAND_PRIMARY, accent: BRAND_ACCENT },
  );
  await page.waitForTimeout(250);
  await shoot();
  await page.evaluate(() => document.getElementById('__aso_caption__')?.remove());
}

async function captureDevice(browser, dev) {
  const { prefix, cssWidth, cssHeight, scale } = dev;
  const ctx = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript(
    ({ css, onboardingKey }) => {
      try {
        window.localStorage.setItem(onboardingKey, 'true');
      } catch {
        /* ignore */
      }
      const apply = () => {
        if (document.getElementById('__capture-social-hide__')) return;
        const s = document.createElement('style');
        s.id = '__capture-social-hide__';
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
      else apply();
    },
    { css: HIDE_SOCIAL_CSS, onboardingKey: ONBOARDING_KEY },
  );
  const page = await ctx.newPage();
  console.log(`\n=== ${prefix} (${cssWidth}x${cssHeight}) ===`);

  // --- ログイン不要ページ ---
  for (const { slot, path: pubPath, label, title, subtitle, scrollToSelector } of PLAN.publicPages) {
    try {
      console.log(`Loading ${URL}${pubPath} (${label}) ...`);
      await page.goto(`${URL}${pubPath}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2000);
      // 遅延描画(IntersectionObserver)のセクションを全体スクロールで起こす。
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const h = document.body.scrollHeight;
        for (let y = 0; y < h; y += Math.round(window.innerHeight * 0.8)) {
          window.scrollTo(0, y);
          await sleep(180);
        }
        window.scrollTo(0, 0);
        await sleep(300);
      });
      await page.waitForTimeout(800);
      let scrolled = false;
      if (scrollToSelector) {
        try {
          await page.locator(scrollToSelector).first().scrollIntoViewIfNeeded({ timeout: 6000 });
          await page.evaluate(() => window.scrollBy(0, -90));
          scrolled = true;
        } catch {
          /* fall through */
        }
      }
      if (!scrolled && pubPath.includes('#')) {
        const anchor = pubPath.split('#')[1];
        await page.evaluate((a) => document.getElementById(a)?.scrollIntoView({ block: 'start' }), anchor).catch(() => {});
      }
      await page.waitForTimeout(900);
      const file = path.join(OUT_DIR, `${prefix}-${slot}.png`);
      await withCaption(page, { title, subtitle }, () => page.screenshot({ path: file, fullPage: false }));
      console.log(`  Saved ${file} (${fs.statSync(file).size} bytes) — ${label}`);
    } catch (e) {
      console.warn(`  WARN: failed ${prefix}-${slot}.png (${label}): ${e.message.slice(0, 200)} — continuing`);
    }
  }

  // --- ログイン後タブ(creds あれば) ---
  if (hasAuthPlan && DEMO_USER && DEMO_PASS) {
    try {
      console.log(`Loading ${URL}${PLAN.signInPath} ...`);
      await page.goto(`${URL}${PLAN.signInPath}`, { waitUntil: 'networkidle', timeout: 60000 });
      const emailInput = page.getByLabel(/email|メール/i).first();
      await emailInput.waitFor({ state: 'visible', timeout: 30000 });
      await emailInput.fill(DEMO_USER);
      await emailInput.press('Enter'); // Enter は primary submit のみ(social ボタンは type=button で無反応)
      // 認証SaaSは password 欄を disabled で pre-render する。有効化を明示的に待つ。
      await page.waitForFunction(
        () => {
          const el = document.querySelector('input[name="password"], input#password-field, input[type="password"]');
          return !!(el && !el.disabled && el.offsetParent !== null);
        },
        null,
        { timeout: 30000 },
      );
      const passwordInput = page.locator('input[name="password"], input#password-field, input[type="password"]').first();
      await passwordInput.fill(DEMO_PASS);
      await passwordInput.press('Enter');
      await page.waitForURL(new RegExp(PLAN.dashboardUrlRegex), { timeout: 30000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      for (const tab of PLAN.authTabs) {
        try {
          // tab.selector(優先) or tab.value(role=tab の id 末尾一致)。
          const sel = tab.selector || `[role="tab"][id$="-trigger-${tab.value}"]`;
          const loc = page.locator(sel).first();
          await loc.waitFor({ state: 'visible', timeout: 8000 });
          await loc.click({ timeout: 5000 });
          await page.waitForTimeout(2500);
          const file = path.join(OUT_DIR, `${prefix}-${tab.slot}.png`);
          await withCaption(page, { title: tab.title, subtitle: tab.subtitle }, () => page.screenshot({ path: file, fullPage: false }));
          console.log(`  Saved ${file} (${fs.statSync(file).size} bytes) — ${tab.label}`);
        } catch (e) {
          console.warn(`  WARN: failed ${prefix}-${tab.slot}.png (${tab.label}): ${e.message.slice(0, 200)} — continuing`);
        }
      }
    } catch (e) {
      console.warn(`  WARN: auth capture skipped: ${e.message.slice(0, 200)} — public shots already clear 2.3.3`);
    }
  } else if (hasAuthPlan) {
    console.log('  (no reviewer creds — skipping authenticated tabs)');
  }

  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const dev of DEVICES) await captureDevice(browser, dev);
} finally {
  await browser.close();
}
console.log('\nAll captures complete.');

// ⚠️ 訴求カバー(store-assets/covers/)は App Store スクショに混ぜない。
// 以前ここでカバー(iphone-6{7,5}-0{a,b,c}.png)を OUT_DIR にコピーし、ファイル名の
// "0x" が実タブより前にソートされてスクショ先頭を占有していたが、Apple審査で
// Guideline 2.3.3「大半が実アプリUIでない/マーケ素材・splashは不可」として却下された
// (Submission 0830fcff / 2026-07-08)。スクショは実アプリUI(受信箱・返信下書き・設定)のみ。
// カバー資産はリポに残してよいが App Store 掲載には使わない。
