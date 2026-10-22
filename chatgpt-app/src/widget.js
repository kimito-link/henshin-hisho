import { PATENT_LABEL } from './reply.js';

const REASONS = {
  empty_message: '本文を入れてください。',
  trial_required: 'このメールでは、先にお試しを開始してください。',
  plan_expired: 'お試しが終わっています。続けるには月額プランが必要です。',
  quota_exceeded: '今の期間の作成回数を使い切りました。定型文でカードを出しています。',
  preview_exhausted: 'メールなしのプレビューは、この端末で本日3件までです。定型文でカードを出しています。',
  preview_busy: 'プレビューが混み合っています。定型文でカードを出しています。',
  human_confirmation_required: '確認チェックを入れてください。',
  risk_acknowledgement_required: '高リスクの確認チェックを入れてください。',
  empty_candidate: 'コピーする候補を選んでください。',
  empty_shiori: '残す本文がありません。',
  storage_not_configured: '保存先が未接続のため、しおりとお試しを記録できません。',
  trial_used: 'このメールアドレスのお試しは終了しています。',
  invalid_email: 'メールアドレスの形式を確認してください。',
  trial_busy: 'お試しの開始が集中しています。',
  owner_required: 'しおりの持ち主を決められません。',
  no_previous_person: '「さっきの人」に当たるしおりがありません。',
  state_mismatch: '宛先か受信メールの状態が変わったので、内容を確認してもう一度送信を押してください。',
  approval_required: '送信は、カードの「送信」からだけ行えます。',
  gmail_not_connected: 'Gmail が未接続です。送信はしていません。',
  gmail_not_configured: 'Gmail の秘密情報が未設定です。送信はしていません。',
  gmail_refresh_failed: 'Gmail の接続を更新できませんでした。送信はしていません。',
  gmail_send_failed: 'Gmail が送信を受け付けませんでした。メールは未送信です。',
  channel_not_email: 'このカードが送れるのはメールだけです。LINE や Chatwork はここから送りません。',
  llm_not_configured: 'LLM は未接続のため、定型文にしています。',
  llm_unavailable: 'LLM を使えなかったため、定型文にしています。',
  llm_failed: 'LLM が失敗したため、定型文にしています。',
  user_quota_exhausted: '原価の回数を使い切ったため、定型文にしています。',
  daily_budget_exhausted: '本日の原価上限に達したため、定型文にしています。',
  cost_guard_unavailable: '原価ガードが使えなかったため、定型文にしています。'
};

export const WIDGET_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>メールの作成 | AI返信秘書</title>
<meta name="referrer" content="no-referrer" />
<style>
  :root { color-scheme: light; --bg: #f4f7fb; --card: #fff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --chip: #f8fafc; --field: transparent; }
  :root[data-theme="dark"] { color-scheme: dark; --bg: #0f1115; --card: #2a2f38; --ink: #f8fafc; --muted: #cbd5e1; --line: #3b4250; --chip: #343b46; --field: transparent; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { color-scheme: dark; --bg: #0f1115; --card: #2a2f38; --ink: #f8fafc; --muted: #cbd5e1; --line: #3b4250; --chip: #343b46; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.5; }
  main { width: min(44rem, 100%); margin: 0 auto; padding: 12px; }
  h1 { font-size: 1.05rem; margin: 0; font-weight: 700; }
  p { margin: 0 0 8px; }
  .card { background: var(--card); color: var(--ink); border-radius: 18px; padding: 14px 14px 12px; box-shadow: 0 10px 28px rgba(0,0,0,.18); }
  .head { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
  .iconrow { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
  button.icon, button.pill, button.quiet { border: 0; cursor: pointer; font: inherit; }
  button.icon { width: 34px; height: 34px; border-radius: 999px; background: transparent; color: var(--ink); }
  button.pill { border-radius: 999px; background: #1d4ed8; color: #fff; font-weight: 700; padding: 8px 16px; font-size: 15px; }
  button.quiet { background: transparent; color: #1d4ed8; font-weight: 700; padding: 8px 4px; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .row { display: grid; grid-template-columns: 4.5rem 1fr; gap: 8px; align-items: center; padding: 7px 0; }
  .row span { color: var(--muted); font-size: .92rem; }
  input, textarea, select { width: 100%; border: 0; background: var(--field); color: inherit; font: inherit; font-size: 16px; padding: 0; }
  textarea { min-height: 11rem; max-height: 22rem; resize: vertical; overflow: auto; line-height: 1.6; }
  .rule { border: 0; border-top: 1px solid var(--line); margin: 4px 0 8px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 8px 0; }
  .chips button { text-align: left; border: 1px solid var(--line); background: var(--chip); color: inherit; border-radius: 12px; padding: 8px; min-width: 9.5rem; cursor: pointer; }
  .chips button[aria-pressed="true"] { border-color: #1d4ed8; box-shadow: inset 0 0 0 1px #1d4ed8; }
  .chips small { display: block; color: var(--muted); }
  details { color: var(--muted); font-size: .92rem; }
  .paste { margin-top: 12px; }
  .paste textarea { min-height: 5rem; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .status, .patent, .note { color: var(--muted); font-size: .85rem; }
  .check { display: flex; gap: 8px; align-items: flex-start; font-weight: 650; margin: 8px 0; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <article id="composeCard" class="card">
    <div class="head">
      <h1 id="cardTitle">返信</h1>
      <div class="iconrow">
        <button id="copyButton" class="icon" type="button" aria-label="本文をコピー">⧉</button>
        <button id="openButton" class="icon" type="button" aria-label="メールを開く">↗</button>
        <button id="sendButton" class="pill" type="button">送信</button>
      </div>
    </div>
    <div id="candidateChips" class="chips"></div>
    <p id="emotionCaption" class="note">相手の気持ちは、候補を押すと本文へ入ります。点数は予測です。</p>
    <label class="row"><span>差出人</span><input id="composeFrom" type="text" autocomplete="email" placeholder="接続したアカウント" /></label>
    <p id="providerLine" class="note"></p>
    <label class="row"><span>宛先</span><input id="composeTo" type="email" autocomplete="email" placeholder="相手のメールアドレス" /></label>
    <details>
      <summary>Cc / Bcc</summary>
      <label class="row"><span>Cc</span><input id="composeCc" type="email" autocomplete="email" /></label>
      <label class="row"><span>Bcc</span><input id="composeBcc" type="email" autocomplete="email" /></label>
    </details>
    <label class="row"><span>件名</span><input id="composeSubject" type="text" /></label>
    <hr class="rule" />
    <textarea id="composeBody" aria-label="本文" placeholder="本文"></textarea>
    <label id="riskRow" class="check" hidden><input id="riskCheck" type="checkbox" /> 高リスクのため、約束や断定をしないことを確認しました。</label>
    <div class="actions">
      <button id="draftButton" class="quiet" type="button">下書き保存</button>
      <button id="confirmButton" class="quiet" type="button">コピー用に確認</button>
    </div>
  </article>
  <p id="unsentLine" class="note">このメールは未送信です。</p>
  <p id="handoffLine" class="note"></p>
  <p id="referenceLine" class="note"></p>
  <form id="deskForm" class="paste">
    <label>受け取ったメール<textarea id="pasteBody" name="body" placeholder="相手からの本文"></textarea></label>
    <div class="row"><span>差出人</span><input id="pasteSender" name="sender" type="text" /></div>
    <div class="row"><span>件名</span><input id="pasteSubject" name="subject" type="text" /></div>
    <label class="row">チャネル
      <select id="pasteChannel" name="channel">
        <option value="email">メール</option>
        <option value="line">LINE</option>
        <option value="chatwork">Chatwork</option>
        <option value="other">その他</option>
      </select>
    </label>
    <input id="pasteTone" name="tone" type="hidden" value="polite" />
    <input id="pasteIntent" name="intent" type="hidden" value="" />
    <input id="pasteDiscount" name="discountCeilingPercent" type="hidden" value="" />
    <input id="pasteMinOrder" name="minOrderValueYen" type="hidden" value="" />
    <label class="row"><span>メール</span><input id="pasteEmail" name="email" type="email" autocomplete="email" /></label>
    <div class="actions">
      <button id="proposeButton" class="pill" type="submit">候補を作る</button>
      <button id="shioriButton" class="quiet" type="button">しおりに残す</button>
      <button id="trialButton" class="quiet" type="button">お試し</button>
      <button id="priceButton" class="quiet" type="button">料金</button>
    </div>
  </form>
  <section id="riskCard" hidden>
    <p><span id="riskBadge"></span> <span id="riskScore"></span></p>
    <div id="riskMeter" hidden><span id="riskBar"></span></div>
    <ul id="riskReasons"></ul>
    <p id="classLine"></p>
  </section>
  <div id="emotionCompare" hidden></div>
  <div id="candidateList" hidden></div>
  <label id="humanRow" class="check" hidden><input id="humanCheck" type="checkbox" checked /> 内容を確認しました。</label>
  <label id="copyLabel" hidden>コピーする文面<textarea id="copyOut" readonly></textarea></label>
  <div id="shioriList"></div>
  <p id="billingLine" class="note"></p>
  <p id="statusLine" class="status" role="status" aria-live="polite"></p>
  <p class="patent">${PATENT_LABEL}</p>
</main>
<script type="module">
const reasons = ${JSON.stringify(REASONS)};
const $ = (id) => document.getElementById(id);
let deskId = '';
let view = {};
let priceUrl = '/price/';
let busy = false;
try {
  deskId = sessionStorage.getItem('henshinDeskId') || crypto.randomUUID();
  sessionStorage.setItem('henshinDeskId', deskId);
} catch (error) {
  deskId = crypto.randomUUID();
}
const embedded = window.parent !== window && !location.pathname.startsWith('/preview/');
let rpcId = 0;
const pending = new Map();
const rpcNotify = (method, params) => { if (embedded) window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*'); };
const rpcRequest = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  pending.set(id, { resolve, reject });
  window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
});
function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
}
window.addEventListener('message', (event) => {
  if (!embedded || event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (typeof message.id === 'number') {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
    return;
  }
  if (message.method === 'ui/notifications/tool-result') applyResult(message.params || {});
  if (message.method === 'ui/notifications/tool-input') fillIncoming(message.params && message.params.arguments);
  if (message.method === 'ui/notifications/host-context-changed') applyTheme(message.params && message.params.theme);
});
const bridgeReady = embedded
  ? rpcRequest('ui/initialize', {
      appInfo: { name: 'henshin-hisho-compose', version: '0.2.0' },
      appCapabilities: { availableDisplayModes: ['inline'] },
      protocolVersion: '2026-01-26'
    }).then((result) => {
      applyTheme(result && result.hostContext && result.hostContext.theme);
      rpcNotify('ui/notifications/initialized', {});
    }).catch(() => setStatus('ホストとの接続に失敗しました。カード自体は編集できます。'))
  : Promise.resolve();
if (embedded && window.ResizeObserver) {
  const observer = new ResizeObserver(() => rpcNotify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight }));
  observer.observe(document.body);
}
function setBusy(value) {
  busy = value;
  ['sendButton', 'draftButton', 'copyButton', 'proposeButton', 'confirmButton', 'shioriButton'].forEach((id) => { $(id).disabled = value; });
}
function setStatus(text) { $('statusLine').textContent = text || ''; }
function composeFromForm() {
  return {
    from: $('composeFrom').value,
    to: $('composeTo').value,
    cc: $('composeCc').value,
    bcc: $('composeBcc').value,
    subject: $('composeSubject').value,
    body: $('composeBody').value
  };
}
function fillCompose(compose) {
  if (!compose) return;
  $('composeFrom').value = compose.from || '';
  $('composeTo').value = compose.to || '';
  $('composeCc').value = compose.cc || '';
  $('composeBcc').value = compose.bcc || '';
  $('composeSubject').value = compose.subject || '';
  $('composeBody').value = compose.body || '';
  $('cardTitle').textContent = compose.subject || '返信';
  const provider = compose.providerLabel ? compose.providerLabel + (compose.from ? ' · ' + compose.from : '') : '';
  $('providerLine').textContent = provider;
}
function fillIncoming(args) {
  if (!args) return;
  if (!$('pasteSender').value && args.sender) $('pasteSender').value = args.sender;
  if (!$('pasteSubject').value && args.subject) $('pasteSubject').value = args.subject;
  if (!$('pasteBody').value && args.body) $('pasteBody').value = args.body;
}
function payloadFromForm() {
  return {
    deskId,
    sender: $('pasteSender').value,
    subject: $('pasteSubject').value,
    channel: $('pasteChannel').value,
    tone: $('pasteTone').value,
    body: $('pasteBody').value,
    intent: $('pasteIntent').value,
    instruction: $('pasteIntent').value,
    discountCeilingPercent: $('pasteDiscount').value,
    minOrderValueYen: $('pasteMinOrder').value,
    email: $('pasteEmail').value,
    incomingId: view.incomingId || ''
  };
}
async function callTool(name, args) {
  await bridgeReady;
  if (!embedded) {
    const response = await fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'tool_error');
    return payload.result || {};
  }
  try {
    return await rpcRequest('tools/call', { name, arguments: args });
  } catch (error) {
    if (window.openai && typeof window.openai.callTool === 'function') return window.openai.callTool(name, args);
    throw error;
  }
}
function renderChips() {
  const box = $('candidateChips');
  box.replaceChildren();
  const compare = $('emotionCompare');
  compare.replaceChildren();
  (view.candidates || []).forEach((candidate) => {
    const emotion = candidate.emotion || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', candidate.text === $('composeBody').value ? 'true' : 'false');
    const name = document.createElement('strong');
    name.textContent = candidate.label || '';
    const meta = document.createElement('small');
    meta.textContent = '相手の気持ち ' + (emotion.category || '') + ' ' + (emotion.score ?? '');
    button.append(name, meta);
    button.addEventListener('click', () => {
      $('composeBody').value = candidate.text || '';
      view.selectedId = candidate.id;
      renderChips();
    });
    box.appendChild(button);
    const cell = document.createElement('p');
    cell.textContent = (candidate.label || '') + ' ' + (emotion.category || '') + ' ' + (emotion.score ?? '') + ' ' + (emotion.reason || '');
    compare.appendChild(cell);
  });
  $('riskRow').hidden = !(view.risk && view.risk.level === 'high');
  $('unsentLine').textContent = view.sent ? '送信しました。' : 'このメールは未送信です。';
  $('cardTitle').textContent = $('composeSubject').value || '返信';
}
function applyResult(result) {
  const data = result.structuredContent || result;
  if (!data || typeof data !== 'object') return;
  if (result._meta && result._meta.sendNonce) view.sendNonce = result._meta.sendNonce;
  if (data.deskId) deskId = data.deskId;
  if (data.priceUrl) priceUrl = data.priceUrl;
  const next = { ...data };
  if (!Object.prototype.hasOwnProperty.call(data, 'candidates')) delete next.candidates;
  if (data.snapshotId && data.snapshotId !== view.snapshotId) {
    view = { ...view, ...next, reconfirm: false };
    fillCompose(data.compose);
  } else {
    view = { ...view, ...next };
    if (data.compose && !view.snapshotId) fillCompose(data.compose);
  }
  if (data.reconfirm) view.reconfirm = true;
  if (data.sent === true) view.sent = true;
  $('handoffLine').textContent = data.handoff || view.handoff || '';
  const reference = view.reference;
  $('referenceLine').textContent = reference && reference.refersToPrevious
    ? (reference.resolved ? '「さっきの人」はしおりの' + (reference.sender || '相手') + 'に解決しました。' : '「さっきの人」に当たるしおりがありません。相手は推測していません。')
    : '';
  if (view.risk) {
    $('riskCard').hidden = false;
    $('riskBadge').textContent = view.risk.level === 'high' ? '高' : view.risk.level === 'medium' ? '中' : '低';
    $('riskScore').textContent = String(view.risk.score || 0);
    $('classLine').textContent = view.classification === 'notice' ? '通知・自動配信として振り分けました。返信候補は作っていません。' : '';
  }
  if (data.copyText) {
    $('copyOut').value = data.copyText;
    $('copyLabel').hidden = false;
  }
  renderChips();
  if (data.reason && reasons[data.reason]) setStatus(reasons[data.reason]);
}
async function run(name, args, pendingLabel) {
  if (busy) return;
  setBusy(true);
  setStatus(pendingLabel);
  try {
    const result = await callTool(name, args);
    applyResult(result || {});
    const data = (result && result.structuredContent) || {};
    if (data.sent === true) setStatus('送信しました。');
    else if (data.reason && reasons[data.reason]) setStatus(reasons[data.reason]);
    else if (data.classification === 'notice') setStatus('通知として振り分けました。このメールは未送信です。');
    else if (name === 'save_compose_draft' && data.ok) setStatus('下書きをアプリに保存しました。このメールは未送信です。');
    else setStatus('このメールは未送信です。');
  } catch (error) {
    setStatus('処理に失敗しました。このメールは未送信です。');
  } finally {
    setBusy(false);
  }
}
$('composeSubject').addEventListener('input', () => { $('cardTitle').textContent = $('composeSubject').value || '返信'; });
$('deskForm').addEventListener('submit', (event) => {
  event.preventDefault();
  run('propose_replies', payloadFromForm(), '候補を作っています。');
});
$('sendButton').addEventListener('click', () => {
  run('send_reply', {
    userApproved: true,
    reconfirmed: view.reconfirm === true,
    sendNonce: view.sendNonce || '',
    snapshotId: view.snapshotId || '',
    incomingId: (view.compose && view.compose.incomingId) || '',
    riskAcknowledged: $('riskCheck').checked === true,
    riskLevel: (view.risk && view.risk.level) || 'low',
    channel: $('pasteChannel').value,
    deskId,
    ...composeFromForm()
  }, '送信前に状態を確認しています。');
});
$('draftButton').addEventListener('click', () => {
  run('save_compose_draft', { deskId, snapshotId: view.snapshotId || '', ...composeFromForm() }, '下書きを保存しています。');
});
$('copyButton').addEventListener('click', async () => {
  const text = $('composeBody').value;
  $('copyOut').value = text;
  try { await navigator.clipboard.writeText(text); setStatus('本文をコピーしました。このメールは未送信です。'); }
  catch (error) { setStatus('コピーは端末に拒否されました。このメールは未送信です。'); }
});
$('openButton').addEventListener('click', () => {
  const href = view.provider === 'gmail' || (view.compose && view.compose.provider === 'gmail') ? 'https://mail.google.com/mail/' : priceUrl;
  if (window.openai && window.openai.openExternal) window.openai.openExternal({ href });
  else window.open(href, '_blank', 'noopener');
});
$('confirmButton').addEventListener('click', () => {
  run('confirm_candidate', {
    deskId,
    text: $('composeBody').value,
    humanConfirmed: true,
    riskAcknowledged: $('riskCheck').checked === true,
    riskLevel: (view.risk && view.risk.level) || 'unknown',
    channel: $('pasteChannel').value,
    snapshotId: view.snapshotId || ''
  }, '確認を記録しています。');
});
$('shioriButton').addEventListener('click', () => {
  run('save_shiori', { ...payloadFromForm(), candidateText: $('composeBody').value, riskLevel: (view.risk && view.risk.level) || 'unknown' }, 'しおりに残しています。');
});
$('trialButton').addEventListener('click', () => run('start_trial', { email: $('pasteEmail').value, deskId }, 'お試しを開始しています。'));
$('priceButton').addEventListener('click', () => {
  if (window.openai && window.openai.openExternal) window.openai.openExternal({ href: priceUrl });
  else window.open(priceUrl, '_blank', 'noopener');
});
if (window.openai && window.openai.toolOutput) {
  applyResult({ structuredContent: window.openai.toolOutput, _meta: window.openai.toolResponseMetadata || {} });
}
renderChips();
</script>
</body>
</html>`;
