const API_BASE = 'https://henshin-hisho-app.info-a40.workers.dev';
const TOKEN_KEY = 'hh_ios_token';
const NATIVE_AUTH_ALLOWLIST = new Set(['/sign-in', '/privacy', '/terms', '/support', '/account/delete']);
const SHELVES = [
  ['urgent', '至急'],
  ['needs_human_review', '要確認'],
  ['money_or_contract', '契約確認'],
  ['needs_reply', '要返信'],
  ['schedule', '日程'],
  ['sales', '営業'],
  ['later', '後で'],
  ['ignore', '確認不要'],
  ['fyi', 'FYI']
];

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  account: null,
  items: [],
  buckets: {},
  selectedShelf: 'needs_reply',
  selectedItemId: ''
};

const el = {
  appRoot: document.getElementById('appRoot'),
  fallbackView: document.getElementById('fallbackView'),
  tabbar: document.getElementById('tabbar'),
  refreshButton: document.getElementById('refreshButton'),
  retryButton: document.getElementById('retryButton'),
  signInView: document.getElementById('signInView'),
  inboxView: document.getElementById('inboxView'),
  settingsView: document.getElementById('settingsView'),
  deleteView: document.getElementById('deleteView'),
  legalView: document.getElementById('legalView'),
  signInForm: document.getElementById('signInForm'),
  emailInput: document.getElementById('emailInput'),
  passwordInput: document.getElementById('passwordInput'),
  authStatus: document.getElementById('authStatus'),
  accountStatus: document.getElementById('accountStatus'),
  badgeCount: document.getElementById('badgeCount'),
  shelfList: document.getElementById('shelfList'),
  itemDetail: document.getElementById('itemDetail'),
  enableNotificationsButton: document.getElementById('enableNotificationsButton'),
  pushStatus: document.getElementById('pushStatus'),
  goDeleteButton: document.getElementById('goDeleteButton'),
  signOutButton: document.getElementById('signOutButton'),
  deleteAccountButton: document.getElementById('deleteAccountButton'),
  cancelDeleteButton: document.getElementById('cancelDeleteButton'),
  deleteStatus: document.getElementById('deleteStatus'),
  legalTitle: document.getElementById('legalTitle'),
  legalText: document.getElementById('legalText'),
  legalExternalLink: document.getElementById('legalExternalLink')
};

function bridge() {
  return window.Capacitor || null;
}

function isNativePlatform() {
  const cap = bridge();
  if (!cap?.isNativePlatform) return false;
  try {
    return cap.isNativePlatform() === true;
  } catch {
    return false;
  }
}

function route() {
  const value = window.location.hash.replace(/^#/, '');
  return value || (state.token ? '/inbox' : '/sign-in');
}

function setRoute(next, replace = false) {
  const hash = `#${next}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

function setText(node, text) {
  if (node) node.textContent = text || '';
}

function hideAllViews() {
  [el.signInView, el.inboxView, el.settingsView, el.deleteView, el.legalView].forEach((node) => {
    if (node) node.hidden = true;
  });
}

function showShell() {
  el.fallbackView.hidden = true;
  el.appRoot.hidden = false;
}

function showFallback() {
  el.appRoot.hidden = true;
  el.tabbar.hidden = true;
  el.fallbackView.hidden = false;
}

function nativeAuthGate() {
  const current = route();
  const allowed = NATIVE_AUTH_ALLOWLIST.has(current);
  if (isNativePlatform() && !state.token && !allowed) {
    setRoute('/sign-in', true);
    return false;
  }
  if (!state.token && !allowed) {
    setRoute('/sign-in', true);
    return false;
  }
  return true;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.reason || 'request_failed');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function itemCount() {
  return state.items.filter((item) => !['sent', 'done', 'ignored', 'ignore'].includes(item.status)).length;
}

async function syncBadge() {
  const count = itemCount();
  setText(el.badgeCount, String(count));
  const badge = bridge()?.Plugins?.Badge;
  if (badge?.set) {
    await badge.set({ count }).catch(() => {});
  }
  if (navigator.setAppBadge) {
    const op = count > 0
      ? navigator.setAppBadge(count)
      : (navigator.clearAppBadge ? navigator.clearAppBadge() : navigator.setAppBadge(0));
    await op.catch(() => {});
  }
}

async function loadData() {
  const account = await api('/account');
  state.account = account.user || null;
  setText(el.accountStatus, state.account?.email ? `${state.account.email} で確認中` : 'ログイン済みです。');
  const inbox = await api('/inbox');
  state.items = inbox.items || [];
  state.buckets = inbox.buckets || {};
  if (!state.selectedItemId && state.items[0]) state.selectedItemId = state.items[0].id;
  renderShelves();
  renderSelectedItem();
  await syncBadge();
}

function renderShelves() {
  el.shelfList.replaceChildren();
  SHELVES.forEach(([key, label]) => {
    const count = (state.buckets[key] || []).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `shelf-button${state.selectedShelf === key ? ' is-active' : ''}`;
    button.dataset.shelf = key;
    button.innerHTML = '<span></span><strong></strong>';
    button.children[0].textContent = label;
    button.children[1].textContent = String(count);
    button.addEventListener('click', () => {
      state.selectedShelf = key;
      const first = (state.buckets[key] || [])[0];
      state.selectedItemId = first?.id || '';
      renderShelves();
      renderSelectedItem();
    });
    el.shelfList.appendChild(button);
  });
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedItemId) || null;
}

function riskLabel(item) {
  if (item.riskLevel === 'high') return '高リスク';
  if (item.riskLevel === 'low') return '低リスク';
  return '確認';
}

function renderSelectedItem() {
  const visibleItems = state.buckets[state.selectedShelf] || [];
  el.itemDetail.replaceChildren();

  const list = document.createElement('div');
  list.className = 'item-list';
  visibleItems.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `item-button${item.id === state.selectedItemId ? ' is-active' : ''}`;
    button.textContent = item.subject || '(件名なし)';
    button.addEventListener('click', () => {
      state.selectedItemId = item.id;
      renderSelectedItem();
    });
    list.appendChild(button);
  });
  el.itemDetail.appendChild(list);

  const item = selectedItem();
  if (!item) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'この棚に項目はありません。';
    el.itemDetail.appendChild(empty);
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  const titleBox = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = item.subject || '(件名なし)';
  const from = document.createElement('p');
  from.className = 'status';
  from.textContent = item.from?.name || item.from?.email || '差出人不明';
  titleBox.append(title, from);
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = riskLabel(item);
  heading.append(titleBox, tag);
  el.itemDetail.appendChild(heading);

  const summary = document.createElement('p');
  summary.className = 'status';
  summary.textContent = item.triage?.summary || '要約はまだありません。';
  const body = document.createElement('div');
  body.className = 'body-preview';
  body.textContent = item.body || item.excerpt || '';
  el.itemDetail.append(summary, body, renderActions(item));

  if (item.draft?.body) {
    const draft = document.createElement('div');
    draft.className = 'draft-output';
    draft.textContent = item.draft.body;
    el.itemDetail.appendChild(draft);
  }
}

function renderActions(item) {
  const row = document.createElement('div');
  row.className = 'action-row';

  if (item.riskLevel === 'high' && !item.riskConfirmed) {
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = '確認済みにする';
    confirm.addEventListener('click', async () => {
      await api(`/inbox/${encodeURIComponent(item.id)}/confirm-risk`, { method: 'POST', body: {} });
      await loadData();
    });
    row.appendChild(confirm);
  }

  const draft = document.createElement('button');
  draft.type = 'button';
  draft.textContent = '下書きを作る';
  draft.addEventListener('click', async () => {
    draft.disabled = true;
    try {
      await api(`/inbox/${encodeURIComponent(item.id)}/draft`, {
        method: 'POST',
        body: { tone: 'polite', intent: 'スマホで確認するための短い下書き', extraContext: '' }
      });
      await loadData();
    } finally {
      draft.disabled = false;
    }
  });
  row.appendChild(draft);

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'secondary';
  share.textContent = '共有';
  share.addEventListener('click', () => shareItem(item));
  row.appendChild(share);

  return row;
}

async function shareItem(item) {
  const text = [
    item.subject || '(件名なし)',
    item.triage?.summary || item.excerpt || '',
    item.draft?.body || ''
  ].filter(Boolean).join('\n\n');
  try {
    const share = bridge()?.Plugins?.Share;
    if (share?.share) await share.share({ title: item.subject || 'AI返信秘書', text });
    else if (navigator.share) await navigator.share({ title: item.subject || 'AI返信秘書', text });
  } catch {
    /* user cancelled */
  }
}

function renderLegal(current) {
  const map = {
    '/privacy': {
      title: 'Privacy',
      text: '個人情報の取り扱いとデータ管理方針を確認できます。',
      href: 'https://henshin-hisho.link/privacy-policy.html'
    },
    '/terms': {
      title: 'Terms',
      text: '利用条件は事業者向け契約と本アプリ内の明示操作に従います。',
      href: 'https://henshin-hisho.link/app/#/terms'
    },
    '/support': {
      title: 'Support',
      text: 'お問い合わせ先: info@best-trust.biz',
      href: 'https://henshin-hisho.link/app/'
    }
  };
  const data = map[current] || map['/privacy'];
  setText(el.legalTitle, data.title);
  setText(el.legalText, data.text);
  el.legalExternalLink.href = data.href;
}

async function render() {
  if (!nativeAuthGate()) return;
  const current = route();
  showShell();
  hideAllViews();
  el.tabbar.hidden = !state.token;
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.route === current);
  });

  if (current === '/sign-in') {
    el.signInView.hidden = false;
    return;
  }
  if (current === '/settings') {
    el.settingsView.hidden = false;
    return;
  }
  if (current === '/account/delete') {
    el.deleteView.hidden = false;
    return;
  }
  if (NATIVE_AUTH_ALLOWLIST.has(current)) {
    renderLegal(current);
    el.legalView.hidden = false;
    return;
  }
  el.inboxView.hidden = false;
  if (state.token && state.items.length === 0) {
    await loadData().catch(showFallback);
  }
}

async function signIn(event) {
  event.preventDefault();
  setText(el.authStatus, 'ログインしています。');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: el.emailInput.value, password: el.passwordInput.value }
    });
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    setText(el.authStatus, '');
    setRoute('/inbox', true);
    await loadData();
    await render();
  } catch {
    setText(el.authStatus, 'メールアドレスまたはパスワードを確認してください。');
  }
}

async function enableNotifications() {
  const push = bridge()?.Plugins?.PushNotifications;
  if (!push) {
    setText(el.pushStatus, 'この端末では通知登録を開始できません。');
    return;
  }
  const permission = await push.requestPermissions();
  if (permission.receive !== 'granted') {
    setText(el.pushStatus, '通知の許可が必要です。');
    return;
  }
  await push.addListener('registration', async (token) => {
    await api('/push/subscribe', {
      method: 'POST',
      body: { platform: 'ios-apns', token: token.value, environment: 'production' }
    });
    setText(el.pushStatus, '通知を有効にしました。');
  });
  await push.addListener('registrationError', () => {
    setText(el.pushStatus, '通知を有効にできませんでした。');
  });
  await push.register();
}

function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  state.token = '';
  state.account = null;
  state.items = [];
  state.buckets = {};
  setRoute('/sign-in', true);
  render();
}

async function deleteAccount() {
  if (!state.token) {
    setRoute('/sign-in');
    return;
  }
  setText(el.deleteStatus, '削除しています。');
  try {
    await api('/account/delete', { method: 'POST', body: {} });
    setText(el.deleteStatus, '削除しました。');
    signOut();
  } catch {
    setText(el.deleteStatus, '削除できませんでした。時間をおいて再試行してください。');
  }
}

el.signInForm.addEventListener('submit', signIn);
el.enableNotificationsButton.addEventListener('click', enableNotifications);
el.goDeleteButton.addEventListener('click', () => setRoute('/account/delete'));
el.cancelDeleteButton.addEventListener('click', () => setRoute('/settings'));
el.deleteAccountButton.addEventListener('click', deleteAccount);
el.signOutButton.addEventListener('click', signOut);
el.refreshButton.addEventListener('click', () => loadData().then(render).catch(showFallback));
el.retryButton.addEventListener('click', () => loadData().then(render).catch(showFallback));
document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => setRoute(button.dataset.route));
});
window.addEventListener('hashchange', () => render().catch(showFallback));

if (!window.location.hash) setRoute(state.token ? '/inbox' : '/sign-in', true);
render().catch(showFallback);
