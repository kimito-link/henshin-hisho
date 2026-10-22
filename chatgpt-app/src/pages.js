import { ANNUAL_YEN, PRICE_YEN, TRIAL_DAYS } from './billing.js';
import { PATENT_LABEL } from './reply.js';

const NOTICES = {
  trial_started: `${TRIAL_DAYS}日のお試しを開始しました。ChatGPTの返信候補フォームに、同じメールアドレスを入れてください。`,
  trial_used: 'このメールアドレスのお試しは終了しています。続けるには月額プランが必要です。',
  trial_busy: 'ただいまお試しの開始が集中しています。しばらくしてからもう一度お試しください。',
  checkout_pending: `決済の接続を準備しています。料金は月額${PRICE_YEN.toLocaleString('ja-JP')}円です。接続後、このページから支払いへ進めます。`,
  checkout_cancel: '支払いはキャンセルされました。',
  checkout_success: '支払いを受け付けました。プランへの反映まで少し時間がかかることがあります。',
  invalid_email: 'メールアドレスの形式を確認してください。',
  storage_not_configured: 'お試しの保存先が未接続のため、開始を記録できません。',
  forbidden: '別のサイトからの送信は受け付けていません。'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

export function noticeText(key) {
  return NOTICES[key] || '';
}

export function pricePage(noticeKey = '') {
  const notice = noticeText(noticeKey);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>料金 | AI返信秘書</title>
<meta name="description" content="AI返信秘書のChatGPTアプリ。月額${PRICE_YEN.toLocaleString('ja-JP')}円、${TRIAL_DAYS}日のお試し。返信の送信は本人が行います。" />
<link rel="canonical" href="/price/" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; background: #f4f7fb; color: #0f172a; line-height: 1.6; }
  main { width: min(40rem, 100%); margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.1rem); line-height: 1.3; margin: 0 0 8px; }
  h2 { font-size: 1.1rem; margin: 0 0 8px; }
  .card { background: #fff; border-radius: 16px; padding: 20px; margin-top: 16px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06); }
  .price { font-size: clamp(2rem, 6vw, 2.6rem); font-weight: 700; margin: 0; }
  .price span { font-size: 1rem; font-weight: 600; }
  .notice { background: #e0e7ff; border-radius: 12px; padding: 12px 14px; }
  label { display: block; font-weight: 600; margin-bottom: 12px; }
  input { width: 100%; margin-top: 6px; padding: 12px; font-size: 16px; border: 1px solid #cbd5e1; border-radius: 10px; }
  button { width: 100%; margin-top: 4px; border: 0; border-radius: 10px; padding: 12px 16px; font-size: 16px; font-weight: 700; background: #1d4ed8; color: #fff; cursor: pointer; }
  button.secondary { background: #fff; color: #1d4ed8; border: 1px solid #1d4ed8; }
  ul { margin: 0; padding-left: 1.2rem; }
  .patent { color: #475569; font-size: 0.85rem; }
  :focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
  @media (min-width: 640px) {
    button { width: auto; }
  }
</style>
</head>
<body>
<main>
  <p>AI返信秘書</p>
  <h1>料金</h1>
  <p>ChatGPTの中で、受け取った連絡の返信候補・危険度・しおりを扱います。送信はアプリが行わず、確認した文面をご自身で送ります。</p>
  ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}
  <section class="card" aria-labelledby="planTitle">
    <h2 id="planTitle">スタンダード</h2>
    <p class="price">${PRICE_YEN.toLocaleString('ja-JP')}<span>円 / 月</span></p>
    <p>年額でまとめる場合は ${ANNUAL_YEN.toLocaleString('ja-JP')}円です。お試しは${TRIAL_DAYS}日間で、期間中はいつでも止められます。</p>
    <ul>
      <li>返信候補をトーン別に見比べる</li>
      <li>危険度と理由を、コピーする前に表示する</li>
      <li>文面としおりを残し、次に参照する</li>
      <li>高リスクの文面は、確認チェックまでコピーできない</li>
    </ul>
  </section>
  <section class="card" aria-labelledby="trialTitle">
    <h2 id="trialTitle">お試しを始める</h2>
    <form method="post" action="/billing/trial">
      <label>メールアドレス
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <button type="submit">14日のお試しを開始する</button>
    </form>
  </section>
  <section class="card" aria-labelledby="payTitle">
    <h2 id="payTitle">月額プランの支払い</h2>
    <form method="post" action="/billing/checkout">
      <label>メールアドレス
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <button class="secondary" type="submit">支払いへ進む</button>
    </form>
  </section>
  <p class="patent">${PATENT_LABEL}</p>
</main>
</body>
</html>`;
}
