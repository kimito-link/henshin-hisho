import { PATENT_LABEL } from './reply.js';

const REASONS = {
  empty_message: '本文を入れてください。',
  trial_required: 'このメールでは、先にお試しを開始してください。',
  plan_expired: 'お試しが終わっています。続けるには月額プランが必要です。',
  quota_exceeded: '今の期間の作成回数を使い切りました。',
  preview_exhausted: 'メールなしのプレビューは、この端末で本日3件までです。',
  preview_busy: 'プレビューが混み合っています。しばらくしてからもう一度お試しください。',
  human_confirmation_required: '確認チェックを入れてください。',
  risk_acknowledgement_required: '高リスクの確認チェックを入れてください。',
  empty_candidate: 'コピーする候補を選んでください。',
  empty_shiori: '残す本文がありません。',
  storage_not_configured: '保存先が未接続のため、しおりとお試しを記録できません。',
  trial_used: 'このメールアドレスのお試しは終了しています。',
  invalid_email: 'メールアドレスの形式を確認してください。',
  trial_busy: 'お試しの開始が集中しています。',
  owner_required: 'しおりの持ち主を決められません。'
};

export const WIDGET_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>返信候補 | AI返信秘書</title>
<meta name="referrer" content="no-referrer" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; background: #f4f7fb; color: #0f172a; line-height: 1.55; }
  main { width: min(52rem, 100%); margin: 0 auto; padding: 16px; }
  h1 { font-size: clamp(1.25rem, 3vw, 1.6rem); margin: 0 0 4px; }
  h2 { font-size: 1rem; margin: 0 0 8px; }
  p { margin: 0 0 8px; }
  form, .card { background: #fff; border-radius: 16px; padding: 16px; margin-top: 12px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05); }
  .grid { display: grid; gap: 12px; }
  @media (min-width: 720px) { .grid.two { grid-template-columns: 1fr 1fr; } }
  label { display: block; font-weight: 650; font-size: 0.92rem; }
  input, select, textarea { width: 100%; margin-top: 6px; padding: 12px; font-size: 16px; border: 1px solid #cbd5e1; border-radius: 10px; font-family: inherit; }
  textarea { min-height: 8rem; resize: vertical; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  button { border: 0; border-radius: 10px; padding: 12px 14px; font-size: 16px; font-weight: 700; background: #1d4ed8; color: #fff; cursor: pointer; }
  button.secondary { background: #fff; color: #1d4ed8; border: 1px solid #1d4ed8; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .candidates { display: grid; gap: 12px; }
  @media (min-width: 900px) { .candidates { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  article { border: 1px solid #dbe3ef; border-radius: 14px; padding: 12px; background: #fff; }
  article.selected { border-color: #1d4ed8; box-shadow: inset 0 0 0 1px #1d4ed8; }
  .meter { height: 10px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
  .meter span { display: block; height: 100%; background: #16a34a; }
  .meter[data-level="medium"] span { background: #d97706; }
  .meter[data-level="high"] span { background: #b91c1c; }
  .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 0.8rem; font-weight: 700; background: #e2e8f0; }
  .badge[data-level="high"] { background: #fee2e2; color: #991b1b; }
  .badge[data-level="medium"] { background: #ffedd5; color: #9a3412; }
  .badge[data-level="low"] { background: #dcfce7; color: #166534; }
  .status { min-height: 1.4em; }
  .patent, .handoff { color: #475569; font-size: 0.85rem; }
  .check { display: flex; gap: 8px; align-items: flex-start; font-weight: 600; margin: 8px 0; }
  [hidden] { display: none !important; }
  .check input { width: 1.1rem; height: 1.1rem; margin-top: 0.2rem; }
  ul { margin: 8px 0 0; padding-left: 1.2rem; }
  #shioriList { display: grid; gap: 8px; }
  #shioriList button { width: 100%; text-align: left; }
  :focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <p>AI返信秘書</p>
  <h1>返信候補</h1>
  <p id="handoffLine" class="handoff">受け取った連絡を貼ると、危険度と返信候補を並べます。送信は行いません。</p>
  <form id="deskForm">
    <div class="grid two">
      <label>差出人<input id="pasteSender" name="sender" type="text" autocomplete="name" placeholder="山田さん" /></label>
      <label>件名<input id="pasteSubject" name="subject" type="text" placeholder="契約内容の確認について" /></label>
      <label>チャネル
        <select id="pasteChannel" name="channel">
          <option value="email">メール</option>
          <option value="line">LINE</option>
          <option value="chatwork">Chatwork</option>
          <option value="other">その他</option>
        </select>
      </label>
      <label>トーン
        <select id="pasteTone" name="tone">
          <option value="polite">丁寧</option>
          <option value="firm">はっきり</option>
          <option value="calm">冷静</option>
          <option value="casual">砕けた調子</option>
        </select>
      </label>
    </div>
    <label>本文<textarea id="pasteBody" name="body" required placeholder="相手からの本文を貼り付けてください"></textarea></label>
    <label>返信の意図<input id="pasteIntent" name="intent" type="text" placeholder="納期だけ先に伝える" /></label>
    <div class="grid two">
      <label>値引き上限（%、任意）<input id="pasteDiscount" name="discountCeilingPercent" type="number" min="0" max="100" step="1" inputmode="numeric" /></label>
      <label>最低受注額（円、任意）<input id="pasteMinOrder" name="minOrderValueYen" type="number" min="0" step="1" inputmode="numeric" /></label>
    </div>
    <label>メールアドレス（お試し・課金。空欄は本日3件まで）
      <input id="pasteEmail" name="email" type="email" autocomplete="email" />
    </label>
    <div class="actions">
      <button id="proposeButton" type="submit">危険度を見て候補を作る</button>
      <button id="shioriButton" class="secondary" type="button">しおりに残す</button>
      <button id="trialButton" class="secondary" type="button">お試しを始める</button>
      <button id="priceButton" class="secondary" type="button">料金を見る</button>
    </div>
  </form>
  <section id="riskCard" class="card" hidden>
    <h2>危険度</h2>
    <p><span id="riskBadge" class="badge"></span> <span id="riskScore"></span></p>
    <div id="riskMeter" class="meter" role="img"><span id="riskBar"></span></div>
    <ul id="riskReasons"></ul>
    <p id="classLine"></p>
  </section>
  <section id="candidateCard" class="card" hidden>
    <h2>見比べる</h2>
    <div id="candidateList" class="candidates"></div>
    <label id="humanRow" class="check"><input id="humanCheck" type="checkbox" /> 送信前に内容を確認しました。この文面をコピーします。</label>
    <label id="riskRow" class="check" hidden><input id="riskCheck" type="checkbox" /> 高リスクのため、約束や断定をしないことを確認しました。</label>
    <div class="actions">
      <button id="confirmButton" type="button">確認してコピー</button>
    </div>
    <label id="copyLabel" hidden>コピーする文面<textarea id="copyOut" readonly></textarea></label>
  </section>
  <section class="card">
    <h2>しおり</h2>
    <div id="shioriList"></div>
  </section>
  <p id="billingLine"></p>
  <p id="statusLine" class="status" role="status" aria-live="polite"></p>
  <p class="patent">${PATENT_LABEL}</p>
</main>
<script type="module">
const reasons = ${JSON.stringify(REASONS)};
const $ = (id) => document.getElementById(id);
const form = $('deskForm');
const texts = new Map();
let deskId = '';
let view = {};
let priceUrl = '/price/';
let busy = false;
const actionIds = ['proposeButton', 'shioriButton', 'trialButton', 'priceButton', 'confirmButton'];

function setBusy(value) {
  busy = value;
  actionIds.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = value;
  });
}

try {
  deskId = sessionStorage.getItem('henshinDeskId') || '';
  if (!deskId) {
    deskId = crypto.randomUUID();
    sessionStorage.setItem('henshinDeskId', deskId);
  }
} catch (error) {
  deskId = crypto.randomUUID();
}

const embedded = window.parent !== window && !location.pathname.startsWith('/preview/');
let rpcId = 0;
const pending = new Map();
const rpcNotify = (method, params) => {
  if (!embedded) return;
  window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
};
const rpcRequest = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  pending.set(id, { resolve, reject });
  window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
});

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
  if (message.method === 'ui/notifications/tool-input') fillEmpty(message.params && message.params.arguments);
});

const bridgeReady = embedded
  ? rpcRequest('ui/initialize', {
      appInfo: { name: 'henshin-hisho-reply-form', version: '0.1.0' },
      appCapabilities: {},
      protocolVersion: '2026-01-26'
    }).then(() => rpcNotify('ui/notifications/initialized', {})).catch(() => {
      setStatus('ChatGPTとの接続に失敗しました。フォーム自体は入力できます。');
    })
  : Promise.resolve();

if (embedded && window.ResizeObserver) {
  const observer = new ResizeObserver(() => {
    rpcNotify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight });
  });
  observer.observe(document.body);
}

function setStatus(text) {
  $('statusLine').textContent = text || '';
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
    discountCeilingPercent: $('pasteDiscount').value,
    minOrderValueYen: $('pasteMinOrder').value,
    email: $('pasteEmail').value
  };
}

function fillEmpty(args) {
  if (!args) return;
  const pairs = [
    ['pasteSender', args.sender],
    ['pasteSubject', args.subject],
    ['pasteBody', args.body],
    ['pasteIntent', args.intent],
    ['pasteEmail', args.email]
  ];
  pairs.forEach(([id, value]) => {
    const el = $(id);
    if (el && !el.value && value) el.value = value;
  });
  if (args.channel) $('pasteChannel').value = args.channel;
  if (args.tone) $('pasteTone').value = args.tone;
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
  return rpcRequest('tools/call', { name, arguments: args });
}

function billingText(billing) {
  if (!billing) return '';
  if (billing.plan === 'active') return '有効なプランです。';
  if (billing.plan === 'trial') return 'お試し残り ' + billing.trialDaysRemaining + ' 日です。';
  if (billing.plan === 'expired') return 'お試しが終了しています。月額 ' + billing.priceYen + ' 円で続けられます。';
  if (typeof billing.previewRemaining === 'number') return 'メールなしの残り ' + billing.previewRemaining + ' 件です。';
  return 'メールなしは本日3件までです。続けるにはお試し（14日）または月額 ' + (billing.priceYen || 2980) + ' 円です。';
}

function resetConfirmation() {
  $('humanCheck').checked = false;
  $('riskCheck').checked = false;
  $('copyOut').value = '';
  $('copyLabel').hidden = true;
}

function render() {
  const risk = view.risk;
  $('handoffLine').textContent = view.handoff || '受け取った連絡を貼ると、危険度と返信候補を並べます。送信は行いません。';
  $('billingLine').textContent = billingText(view.billing);
  if (view.priceUrl) priceUrl = view.priceUrl;
  const riskCard = $('riskCard');
  if (!risk) {
    riskCard.hidden = true;
  } else {
    riskCard.hidden = false;
    const levelLabel = risk.level === 'high' ? '高' : risk.level === 'medium' ? '中' : '低';
    $('riskBadge').textContent = '危険度 ' + levelLabel;
    $('riskBadge').dataset.level = risk.level;
    $('riskScore').textContent = String(risk.score) + ' / 100';
    $('riskMeter').dataset.level = risk.level;
    $('riskMeter').setAttribute('aria-label', '危険度 ' + risk.score + '、' + levelLabel);
    $('riskBar').style.width = Math.max(0, Math.min(100, Number(risk.score) || 0)) + '%';
    const list = $('riskReasons');
    list.replaceChildren();
    (risk.reasons || []).forEach((reason) => {
      const item = document.createElement('li');
      item.textContent = reason;
      list.appendChild(item);
    });
    $('classLine').textContent = view.classification === 'notice'
      ? '通知・自動配信として振り分けました。返信候補は作っていません。'
      : '';
  }
  const candidateCard = $('candidateCard');
  const list = $('candidateList');
  const selectedId = document.querySelector('input[name="candidate"]:checked')?.value || '';
  texts.clear();
  list.replaceChildren();
  const candidates = view.candidates || [];
  candidateCard.hidden = candidates.length === 0;
  $('riskRow').hidden = !risk || risk.level !== 'high';
  candidates.forEach((candidate) => {
    texts.set(candidate.id, candidate.text);
    const article = document.createElement('article');
    const choice = document.createElement('label');
    choice.className = 'check';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'candidate';
    radio.value = candidate.id;
    radio.checked = candidate.id === selectedId;
    if (radio.checked) article.classList.add('selected');
    radio.addEventListener('change', () => {
      list.querySelectorAll('article').forEach((node) => node.classList.remove('selected'));
      article.classList.add('selected');
    });
    const name = document.createElement('span');
    name.textContent = candidate.label + (candidate.holding ? '（保留）' : '');
    choice.append(radio, name);
    const body = document.createElement('p');
    body.textContent = candidate.text;
    article.append(choice, body);
    list.appendChild(article);
  });
  const shiori = $('shioriList');
  shiori.replaceChildren();
  const items = view.shiori || [];
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'まだしおりはありません。';
    shiori.appendChild(empty);
  }
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    const when = item.savedAt ? new Date(item.savedAt).toLocaleString('ja-JP') : '';
    button.textContent = (item.subject || item.excerpt || '無題') + (when ? ' ' + when : '');
    button.addEventListener('click', () => restoreShiori(item));
    shiori.appendChild(button);
  });
}

function restoreShiori(item) {
  if (item.subject) $('pasteSubject').value = item.subject;
  if (item.sender) $('pasteSender').value = item.sender;
  if (item.excerpt) $('pasteBody').value = item.excerpt;
  view = {
    ...view,
    subject: item.subject,
    risk: { level: item.riskLevel || 'unknown', score: item.riskLevel === 'high' ? 80 : 18, reasons: ['しおりから開きました'], requiresHumanApproval: item.riskLevel === 'high' },
    candidates: item.candidateText ? [{ id: item.id, label: 'しおりの文面', text: item.candidateText, holding: item.riskLevel === 'high' }] : [],
    classification: 'needs_reply'
  };
  render();
  setStatus('しおりを開きました。送信はしていません。');
}

function applyResult(result) {
  const data = result.structuredContent || result;
  if (!data || typeof data !== 'object') return;
  if (data.deskId) deskId = data.deskId;
  if (data.priceUrl) priceUrl = data.priceUrl;
  if (Array.isArray(data.candidates) || data.risk || data.shiori) {
    if (Array.isArray(data.candidates)) resetConfirmation();
    view = { ...view, ...data };
    fillEmpty(data);
  } else if (data.billing) {
    view = { ...view, billing: data.billing, priceUrl: data.priceUrl || priceUrl };
  }
  if (data.copyText) {
    $('copyOut').value = data.copyText;
    $('copyLabel').hidden = false;
    setStatus('確認できました。送信はしていません。');
  } else if (data.reason && reasons[data.reason]) {
    setStatus(reasons[data.reason]);
  }
  render();
}

async function run(name, args, pendingLabel) {
  if (busy) return;
  setBusy(true);
  setStatus(pendingLabel);
  try {
    const result = await callTool(name, args);
    applyResult(result || {});
    const data = (result && result.structuredContent) || {};
    if (data.classification === 'notice') setStatus('通知として振り分けました。送信はしていません。');
    else if (data.ok && Array.isArray(data.candidates) && data.candidates.length) setStatus('候補を作りました。送信はしていません。');
    else if (data.ok && !data.reason && !data.copyText) setStatus('更新しました。送信はしていません。');
    if (name === 'confirm_candidate' && data.ok && data.copyText) {
      try {
        await navigator.clipboard.writeText(data.copyText);
        setStatus('コピーしました。送信はしていません。');
      } catch (error) {
        setStatus('自動コピーは拒否されました。下の文面を選んでコピーしてください。送信はしていません。');
      }
    }
  } catch (error) {
    setStatus('処理に失敗しました。しばらくしてからもう一度お試しください。');
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run('propose_replies', payloadFromForm(), '候補を作っています。');
});

$('shioriButton').addEventListener('click', () => {
  const selected = document.querySelector('input[name="candidate"]:checked');
  run('save_shiori', {
    ...payloadFromForm(),
    candidateText: selected ? texts.get(selected.value) || '' : '',
    riskLevel: (view.risk && view.risk.level) || 'unknown'
  }, 'しおりに残しています。');
});

$('trialButton').addEventListener('click', () => {
  run('start_trial', { email: $('pasteEmail').value, deskId }, 'お試しを開始しています。');
});

$('priceButton').addEventListener('click', () => {
  if (window.openai && window.openai.openExternal) window.openai.openExternal({ href: priceUrl });
  else window.open(priceUrl, '_blank', 'noopener');
});

$('confirmButton').addEventListener('click', () => {
  const selected = document.querySelector('input[name="candidate"]:checked');
  if (!selected) {
    setStatus('候補を選んでください。');
    return;
  }
  run('confirm_candidate', {
    deskId,
    text: texts.get(selected.value) || '',
    humanConfirmed: $('humanCheck').checked === true,
    riskAcknowledged: $('riskCheck').checked === true,
    riskLevel: (view.risk && view.risk.level) || 'unknown',
    channel: $('pasteChannel').value
  }, '確認を記録しています。');
});

render();
</script>
</body>
</html>`;
