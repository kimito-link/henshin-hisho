var API_BASE = 'https://henshin-hisho-app.info-a40.workers.dev';
var SHELVES = [
  ['urgent', '至急'],
  ['needs_human_review', '要確認'],
  ['money_or_contract', 'お金・契約'],
  ['needs_reply', '要返信'],
  ['schedule', '日程'],
  ['sales', '営業'],
  ['later', '後回し'],
  ['ignore', '無視候補'],
  ['fyi', 'FYI']
];

var state = {
  token: localStorage.getItem('hh_token') || '',
  account: null,
  items: [],
  buckets: {},
  selectedItemId: '',
  projects: [],
  selectedProjectId: '',
  projectDetail: null,
  staff: []
};

var authView = document.getElementById('authView');
var appView = document.getElementById('appView');
var authForm = document.getElementById('authForm');
var authStatus = document.getElementById('authStatus');
var accountStatus = document.getElementById('accountStatus');
var pasteForm = document.getElementById('pasteForm');
var pasteStatus = document.getElementById('pasteStatus');
var shelfList = document.getElementById('shelfList');
var itemDetail = document.getElementById('itemDetail');
var settingsStatus = document.getElementById('settingsStatus');
var digestSettingsStatus = document.getElementById('digestSettingsStatus');
var reportSettingsStatus = document.getElementById('reportSettingsStatus');
var policySettingsStatus = document.getElementById('policySettingsStatus');
var billingPanel = document.getElementById('billingPanel');
var billingModulePromise = null;

var projectsListPane = document.getElementById('projectsListPane');
var projectDetailPane = document.getElementById('projectDetailPane');
var newProjectForm = document.getElementById('newProjectForm');
var newProjectStatus = document.getElementById('newProjectStatus');
var projectList = document.getElementById('projectList');
var backToProjectsButton = document.getElementById('backToProjectsButton');
var projectDetailName = document.getElementById('projectDetailName');
var projectDetailSummary = document.getElementById('projectDetailSummary');
var channelList = document.getElementById('channelList');
var newChannelForm = document.getElementById('newChannelForm');
var newChannelStatus = document.getElementById('newChannelStatus');
var syncChatworkButton = document.getElementById('syncChatworkButton');
var syncStatus = document.getElementById('syncStatus');
var manualChannelSelect = document.getElementById('manualChannelSelect');
var manualMessageForm = document.getElementById('manualMessageForm');
var manualMessageStatus = document.getElementById('manualMessageStatus');
var messageTimeline = document.getElementById('messageTimeline');
var assistForm = document.getElementById('assistForm');
var assistMode = document.getElementById('assistMode');
var assistDraftFields = document.getElementById('assistDraftFields');
var assistStatus = document.getElementById('assistStatus');
var assistResult = document.getElementById('assistResult');
var staffForm = document.getElementById('staffForm');
var staffStatus = document.getElementById('staffStatus');
var staffList = document.getElementById('staffList');

var COUNTERPART_ROLE_LABEL_JA = { customer: '顧客', engineer: 'エンジニア', mixed: '混在' };
var SENDER_ROLE_LABEL_JA = { internal: '運営者', customer: '顧客', engineer: 'エンジニア', unknown: '不明' };
var STAFF_ROLE_LABEL_JA = { operator: '運営者', engineer: 'エンジニア' };

function capacitorBridge() {
  return window.Capacitor || null;
}

function isNativePlatform() {
  var bridge = capacitorBridge();
  if (!bridge?.isNativePlatform) return false;
  try {
    return bridge.isNativePlatform() === true;
  } catch {
    return false;
  }
}

function nativePlatformName() {
  var bridge = capacitorBridge();
  if (!bridge?.getPlatform) return '';
  try {
    return bridge.getPlatform();
  } catch {
    return '';
  }
}

function isIosNativePlatform() {
  return isNativePlatform() && nativePlatformName() === 'ios';
}

function setText(el, value) {
  if (el) el.textContent = value || '';
}

function urlBase64ToUint8Array(value) {
  var padding = '='.repeat((4 - value.length % 4) % 4);
  var base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  var raw = window.atob(base64);
  var output = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function api(path, options) {
  var headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  var response = await fetch(API_BASE + path, {
    method: options?.method || 'GET',
    headers: headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  var body = await response.json().catch(function () { return {}; });
  if (!response.ok || body.ok === false) {
    var error = new Error(body.reason || 'request_failed');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function showAuthenticated(isAuthed) {
  authView.classList.toggle('is-hidden', isAuthed);
  appView.classList.toggle('is-hidden', !isAuthed);
}

function accountText(account) {
  if (!account) return 'アカウント状態を確認できません。';
  if (isIosNativePlatform()) return 'ログイン済みです。';
  if (account.plan === 'active') return '有効なプランです。';
  if (account.plan === 'trial') return 'トライアル残り ' + account.trialDaysRemaining + ' 日です。';
  return 'トライアル期限が切れています。';
}

async function renderBillingIfAllowed(account) {
  if (!billingPanel) return;
  if (isIosNativePlatform()) {
    billingPanel.replaceChildren();
    billingPanel.classList.add('is-hidden');
    return;
  }
  billingPanel.classList.remove('is-hidden');
  billingModulePromise = billingModulePromise || import('./billing/billing.js');
  var module = await billingModulePromise;
  module.renderBillingPanel(billingPanel, account);
}

async function refreshAccount() {
  var data = await api('/account');
  state.account = data.account;
  state.settings = data.settings || {};
  state.features = data.features || {};
  document.body.dataset.gmailConnectEnabled = state.features.gmailConnectEnabled ? 'true' : 'false';
  setText(accountStatus, accountText(data.account));
  await renderBillingIfAllowed(data.account);
  renderDigestSettings(data.settings?.digest || {});
  renderReportSettings(data.settings || {});
  renderPolicySettings(data.settings?.accountPolicy || {});
}

function renderDigestSettings(digest) {
  document.getElementById('digestEnabled').checked = digest.enabled !== false;
  document.getElementById('digestHour').value = String(Number.isInteger(digest.hour) ? digest.hour : 8);
  document.getElementById('digestTimezone').value = digest.timezone || 'Asia/Tokyo';
  var pushButton = document.getElementById('pushSubscribeButton');
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  pushButton.classList.toggle('is-hidden', !(isStandalone && 'PushManager' in window && 'serviceWorker' in navigator));
}

function renderReportSettings(settings) {
  var weekly = settings.weeklyReport || {};
  document.getElementById('weeklyReportEnabled').checked = weekly.enabled !== false;
  document.getElementById('avgCaseValue').value = settings.avgCaseValue > 0 ? String(settings.avgCaseValue) : '';
}

var INDUSTRY_TEMPLATE_DEFAULTS = {
  seisaku: { discountCeilingPercent: 10, minOrderValueYen: 50000, bundlePolicy: 'case_by_case' },
  butsuhan: { discountCeilingPercent: 20, minOrderValueYen: 10000, bundlePolicy: 'encourage' },
  service: { discountCeilingPercent: 15, minOrderValueYen: 0, bundlePolicy: 'none' }
};

function renderPolicySettings(policy) {
  document.getElementById('policyIndustryTemplate').value = policy.industryTemplate || '';
  document.getElementById('policyDiscountCeiling').value = policy.discountCeilingPercent != null ? String(policy.discountCeilingPercent) : '';
  document.getElementById('policyMinOrderValue').value = policy.minOrderValueYen != null ? String(policy.minOrderValueYen) : '';
  document.getElementById('policyBundlePolicy').value = policy.bundlePolicy || 'none';
  document.getElementById('policyDefaultTone').value = policy.defaultTone || 'polite';
  document.getElementById('policyFreeformNote').value = policy.freeformNote || '';
}

async function refreshInbox() {
  var data = await api('/inbox');
  state.items = data.items || [];
  state.buckets = data.buckets || {};
  renderShelves();
  renderSelectedItem();
  updateAppBadge();
}

function actionableItemCount() {
  return state.items.filter(function (item) {
    return !['sent', 'done', 'ignored', 'ignore'].includes(item.status);
  }).length;
}

function updateAppBadge() {
  var badge = capacitorBridge()?.Plugins?.Badge;
  if (badge?.set) {
    badge.set({ count: actionableItemCount() }).catch(function () {});
  }
  if (!('setAppBadge' in navigator)) return;
  var count = actionableItemCount();
  var action = count > 0
    ? navigator.setAppBadge(count)
    : (navigator.clearAppBadge ? navigator.clearAppBadge() : navigator.setAppBadge(0));
  action.catch(function () {});
}

function renderNativeShareControls(item) {
  var canShare = Boolean(capacitorBridge()?.Plugins?.Share || navigator.share);
  if (!canShare) return document.createDocumentFragment();
  var box = document.createElement('div');
  box.className = 'share-row';
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = '共有';
  button.addEventListener('click', async function () {
    var text = [
      item.subject || '(件名なし)',
      item.triage?.summary || item.excerpt || '',
      item.draft?.body || ''
    ].filter(Boolean).join('\n\n');
    try {
      var share = capacitorBridge()?.Plugins?.Share;
      if (share?.share) await share.share({ title: item.subject || 'AI返信秘書', text: text });
      else await navigator.share({ title: item.subject || 'AI返信秘書', text: text });
    } catch {
      /* user cancelled */
    }
  });
  box.appendChild(button);
  return box;
}

function applySharedInputFromUrl() {
  var params = new URLSearchParams(window.location.search);
  var title = params.get('title') || '';
  var text = params.get('text') || '';
  var url = params.get('url') || '';
  if (!title && !text && !url) return;
  var body = [text, url].filter(Boolean).join('\n\n');
  var subject = document.getElementById('pasteSubject');
  var pasteBody = document.getElementById('pasteBody');
  if (subject && title) subject.value = title;
  if (pasteBody && body) pasteBody.value = body;
  setText(pasteStatus, '共有された内容を貼り付け入力に入れました。');
  if (window.history?.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function renderShelves() {
  shelfList.innerHTML = '';
  SHELVES.forEach(function (entry) {
    var key = entry[0];
    var label = entry[1];
    var items = state.buckets[key] || [];
    var shelf = document.createElement('section');
    shelf.className = 'shelf';
    var header = document.createElement('div');
    header.className = 'shelf-header';
    header.innerHTML = '<span></span><span></span>';
    header.children[0].textContent = label;
    header.children[1].textContent = String(items.length);
    var list = document.createElement('div');
    list.className = 'shelf-items';
    items.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'item-button' + (item.id === state.selectedItemId ? ' is-active' : '') + (item.riskLevel === 'high' ? ' risk-high' : '');
      button.dataset.itemId = item.id;
      button.innerHTML = '<span></span><small></small>';
      button.children[0].textContent = item.subject || '(件名なし)';
      button.children[1].textContent = item.triage?.summary || item.excerpt || '';
      button.addEventListener('click', function () {
        state.selectedItemId = item.id;
        renderShelves();
        renderSelectedItem();
      });
      list.appendChild(button);
    });
    shelf.append(header, list);
    shelfList.appendChild(shelf);
  });
}

function selectedItem() {
  return state.items.find(function (item) { return item.id === state.selectedItemId; }) || null;
}

function riskLabel(item) {
  if (item.riskLevel === 'high') return '高リスク';
  if (item.riskLevel === 'low') return '低リスク';
  return '注意';
}

function renderSelectedItem() {
  var item = selectedItem();
  if (!item) {
    itemDetail.innerHTML = '<p class="empty">左の棚からアイテムを選択してください。</p>';
    return;
  }

  itemDetail.innerHTML = '';
  var heading = document.createElement('div');
  heading.className = 'detail-heading';
  var titleBox = document.createElement('div');
  var title = document.createElement('h2');
  title.textContent = item.subject || '(件名なし)';
  var from = document.createElement('p');
  from.className = 'status';
  from.textContent = item.from?.name || item.from?.email || item.from?.externalUserId || '差出人不明';
  titleBox.append(title, from);
  var badge = document.createElement('span');
  badge.className = 'badge' + (item.riskLevel === 'high' ? ' high' : '');
  badge.textContent = riskLabel(item);
  heading.append(titleBox, badge);

  var grid = document.createElement('div');
  grid.className = 'detail-grid';
  var summary = document.createElement('p');
  summary.className = 'status';
  summary.textContent = item.triage?.summary || '要約はまだありません。';
  var body = document.createElement('div');
  body.className = 'body-preview';
  body.textContent = item.body || item.excerpt || '';
  grid.append(summary, body);

  if (item.riskLevel === 'high' && !item.riskConfirmed) {
    grid.appendChild(renderRiskConfirm(item));
  }
  grid.appendChild(renderDraftControls(item));
  grid.appendChild(renderNativeShareControls(item));
  if (item.draft?.body) {
    var draft = document.createElement('div');
    draft.className = 'draft-output';
    draft.textContent = item.draft.body;
    grid.appendChild(draft);
  }

  itemDetail.append(heading, grid);
}

function renderRiskConfirm(item) {
  var box = document.createElement('div');
  box.className = 'risk-confirm';
  var label = document.createElement('label');
  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  var text = document.createElement('span');
  text.textContent = '高リスク内容を確認しました';
  label.append(checkbox, text);
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = '確認して進める';
  button.disabled = true;
  checkbox.addEventListener('change', function () {
    button.disabled = !checkbox.checked;
  });
  button.addEventListener('click', async function () {
    await api('/inbox/' + encodeURIComponent(item.id) + '/confirm-risk', { method: 'POST', body: {} });
    await refreshInbox();
  });
  box.append(label, button);
  return box;
}

function renderDraftControls(item) {
  var form = document.createElement('form');
  form.className = 'detail-grid';
  var toneRow = document.createElement('div');
  toneRow.className = 'tone-row';
  var tone = document.createElement('select');
  ['polite', 'firm', 'calm', 'casual'].forEach(function (value) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = { polite: '丁寧', firm: '強め', calm: '冷静', casual: 'カジュアル' }[value];
    tone.appendChild(option);
  });
  var intent = document.createElement('input');
  intent.type = 'text';
  intent.placeholder = '例: やわらかく断って';
  toneRow.append(tone, intent);
  var extra = document.createElement('textarea');
  extra.placeholder = '追加事情があれば入力';
  extra.className = 'extra-context';
  var button = document.createElement('button');
  button.type = 'submit';
  button.textContent = '下書きを作る';
  var status = document.createElement('p');
  status.className = 'status';
  form.append(toneRow, extra, button, status);
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    button.disabled = true;
    setText(status, '下書きを生成しています。');
    try {
      await api('/inbox/' + encodeURIComponent(item.id) + '/draft', {
        method: 'POST',
        body: { tone: tone.value, intent: intent.value, extraContext: extra.value }
      });
      await refreshInbox();
    } catch (error) {
      setText(status, error.body?.reason === 'risk_confirmation_required'
        ? '高リスク確認を先に完了してください。'
        : '下書きを生成できませんでした。');
    } finally {
      button.disabled = false;
    }
  });
  return form;
}

// ---- 案件統合AI秘書（案件タブ） ----

async function refreshProjects() {
  var data = await api('/projects');
  state.projects = data.projects || [];
  renderProjectList();
}

function renderProjectList() {
  projectList.innerHTML = '';
  if (!state.projects.length) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'まだ案件がありません。上のフォームから作成してください。';
    projectList.appendChild(empty);
    return;
  }
  state.projects.forEach(function (project) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'item-button';
    button.innerHTML = '<span></span><small></small>';
    button.children[0].textContent = project.name;
    button.children[1].textContent = (project.status || 'active') + (project.summary ? ' ・ ' + project.summary : '');
    button.addEventListener('click', function () {
      openProjectDetail(project.id);
    });
    projectList.appendChild(button);
  });
}

async function openProjectDetail(projectId) {
  state.selectedProjectId = projectId;
  projectsListPane.classList.add('is-hidden');
  projectDetailPane.classList.remove('is-hidden');
  try {
    await refreshProjectDetail();
  } catch {
    setText(newProjectStatus, '案件を取得できませんでした。');
  }
}

function closeProjectDetail() {
  state.selectedProjectId = '';
  state.projectDetail = null;
  projectDetailPane.classList.add('is-hidden');
  projectsListPane.classList.remove('is-hidden');
  refreshProjects().catch(function () {});
}

async function refreshProjectDetail() {
  var data = await api('/projects/' + encodeURIComponent(state.selectedProjectId));
  state.projectDetail = data;
  renderProjectDetailHeader();
  renderChannelList();
  renderManualChannelSelect();
  renderMessageTimeline();
}

function renderProjectDetailHeader() {
  var project = state.projectDetail.project;
  setText(projectDetailName, project.name);
  setText(projectDetailSummary, (project.status || 'active') + (project.summary ? ' ・ ' + project.summary : ''));
}

function renderChannelList() {
  channelList.innerHTML = '';
  var channels = state.projectDetail.channels || [];
  if (!channels.length) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'チャネルがまだ紐付けられていません。';
    channelList.appendChild(empty);
    return;
  }
  channels.forEach(function (channel) {
    var row = document.createElement('div');
    row.className = 'message-card';
    var meta = document.createElement('div');
    meta.className = 'message-meta';
    var left = document.createElement('span');
    left.textContent = (channel.label || channel.source) + '（' + channel.source + '）';
    var right = document.createElement('span');
    right.textContent = COUNTERPART_ROLE_LABEL_JA[channel.counterpart_role] || channel.counterpart_role;
    meta.append(left, right);
    row.appendChild(meta);
    channelList.appendChild(row);
  });
}

function renderManualChannelSelect() {
  manualChannelSelect.innerHTML = '';
  var channels = state.projectDetail.channels || [];
  channels.forEach(function (channel) {
    var option = document.createElement('option');
    option.value = channel.id;
    option.textContent = channel.label || channel.source;
    manualChannelSelect.appendChild(option);
  });
}

function visibilityBadgeClass(visibility) {
  return visibility === 'public' ? 'badge public' : 'badge internal';
}

function visibilityBadgeLabel(visibility) {
  return visibility === 'public' ? '公開' : '内部';
}

async function patchMessageVisibility(messageId, visibility) {
  await api('/projects/' + encodeURIComponent(state.selectedProjectId) + '/messages/' + encodeURIComponent(messageId) + '/visibility', {
    method: 'PATCH',
    body: { visibility: visibility }
  });
  var message = (state.projectDetail.messages || []).find(function (m) { return m.id === messageId; });
  if (message) message.visibility = visibility;
  renderMessageTimeline();
}

function renderMessageTimeline() {
  messageTimeline.innerHTML = '';
  var messages = state.projectDetail.messages || [];
  if (!messages.length) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'メッセージがまだありません。';
    messageTimeline.appendChild(empty);
    return;
  }
  messages.forEach(function (message) {
    var card = document.createElement('div');
    card.className = 'message-card';

    var meta = document.createElement('div');
    meta.className = 'message-meta';
    var left = document.createElement('span');
    left.textContent = (SENDER_ROLE_LABEL_JA[message.sender_role] || message.sender_role) + ' ' + (message.sender_display_name || '') + ' ・ ' + (message.channel_label || message.channel_source);
    var right = document.createElement('span');
    right.textContent = new Date(message.sent_at).toLocaleString('ja-JP');
    meta.append(left, right);

    var badgeRow = document.createElement('div');
    badgeRow.className = 'message-meta';
    var badge = document.createElement('span');
    badge.className = visibilityBadgeClass(message.visibility);
    badge.textContent = visibilityBadgeLabel(message.visibility);
    badgeRow.appendChild(badge);
    if (message.masked) {
      var maskedNote = document.createElement('small');
      maskedNote.textContent = 'マスク済み';
      badgeRow.appendChild(maskedNote);
    }
    var publicButton = document.createElement('button');
    publicButton.type = 'button';
    publicButton.className = 'secondary';
    publicButton.textContent = '公開にする';
    publicButton.disabled = message.visibility === 'public';
    publicButton.addEventListener('click', function () {
      patchMessageVisibility(message.id, 'public').catch(function () {});
    });
    var internalButton = document.createElement('button');
    internalButton.type = 'button';
    internalButton.className = 'secondary';
    internalButton.textContent = '内部にする';
    internalButton.disabled = message.visibility !== 'public';
    internalButton.addEventListener('click', function () {
      patchMessageVisibility(message.id, 'internal').catch(function () {});
    });
    badgeRow.append(publicButton, internalButton);

    var body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = message.body;

    card.append(meta, badgeRow, body);
    messageTimeline.appendChild(card);
  });
}

function renderAssistResult(result) {
  assistResult.innerHTML = '';
  if (result.leakBlocked) {
    var warning = document.createElement('div');
    warning.className = 'leak-warning';
    warning.textContent = '内部情報の混入を検知し、該当部分を差し替えました。';
    assistResult.appendChild(warning);
  }
  var output = document.createElement('div');
  output.className = 'draft-output';
  output.textContent = result.text;
  assistResult.appendChild(output);
  if (result.masked) {
    var maskedNote = document.createElement('p');
    maskedNote.className = 'status';
    maskedNote.textContent = '一部の秘匿情報をマスクしました。';
    assistResult.appendChild(maskedNote);
  }
}

// ---- 担当者登録（設定タブ内） ----

async function refreshStaff() {
  var data = await api('/projects/staff');
  state.staff = data.staff || [];
  renderStaffList();
}

function renderStaffList() {
  staffList.innerHTML = '';
  if (!state.staff.length) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'まだ登録がありません。';
    staffList.appendChild(empty);
    return;
  }
  state.staff.forEach(function (person) {
    var row = document.createElement('div');
    row.className = 'message-card';
    var meta = document.createElement('div');
    meta.className = 'message-meta';
    var left = document.createElement('span');
    left.textContent = (person.display_name || person.source_account_id) + ' ・ ' + person.source;
    var right = document.createElement('span');
    right.textContent = STAFF_ROLE_LABEL_JA[person.staff_role] || person.staff_role;
    meta.append(left, right);
    row.appendChild(meta);
    staffList.appendChild(row);
  });
}

authForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  var mode = event.submitter?.dataset.authMode || 'login';
  var email = document.getElementById('authEmail').value;
  var password = document.getElementById('authPassword').value;
  setText(authStatus, mode === 'signup' ? '登録しています。' : 'ログインしています。');
  try {
    var data = await api('/auth/' + mode, { method: 'POST', body: { email: email, password: password } });
    state.token = data.token;
    localStorage.setItem('hh_token', state.token);
    showAuthenticated(true);
    await refreshAccount();
    await refreshInbox();
    setText(authStatus, '');
  } catch {
    setText(authStatus, 'メールアドレスまたはパスワードを確認してください。');
  }
});

pasteForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  setText(pasteStatus, '判定しています。');
  try {
    var data = await api('/inbox/assess', {
      method: 'POST',
      body: {
        channel: 'paste',
        from: {
          name: document.getElementById('pasteFromName').value,
          email: document.getElementById('pasteFromEmail').value
        },
        subject: document.getElementById('pasteSubject').value,
        body: document.getElementById('pasteBody').value
      }
    });
    state.selectedItemId = data.item.id;
    pasteForm.reset();
    setText(pasteStatus, '受信箱に追加しました。');
    await refreshInbox();
  } catch {
    setText(pasteStatus, '判定できませんでした。時間をおいてお試しください。');
  }
});

document.querySelectorAll('.nav-button').forEach(function (button) {
  button.addEventListener('click', function () {
    document.querySelectorAll('.nav-button').forEach(function (item) { item.classList.remove('is-active'); });
    button.classList.add('is-active');
    document.querySelectorAll('.view').forEach(function (view) { view.classList.add('is-hidden'); });
    document.getElementById(button.dataset.view).classList.remove('is-hidden');
  });
});

document.getElementById('deleteAccountButton').addEventListener('click', async function () {
  if (!window.confirm('このWeb版のアカウントと保存済み受信箱を削除します。続行しますか？')) return;
  try {
    await api('/account/delete', { method: 'POST', body: {} });
    localStorage.removeItem('hh_token');
    state.token = '';
    state.items = [];
    showAuthenticated(false);
    setText(settingsStatus, '');
  } catch {
    setText(settingsStatus, '削除できませんでした。');
  }
});

document.getElementById('logoutButton').addEventListener('click', function () {
  localStorage.removeItem('hh_token');
  state.token = '';
  showAuthenticated(false);
});

document.getElementById('digestSettingsForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  try {
    await api('/account/digest-settings', {
      method: 'POST',
      body: {
        enabled: document.getElementById('digestEnabled').checked,
        hour: Number(document.getElementById('digestHour').value),
        timezone: document.getElementById('digestTimezone').value,
        channel: 'email'
      }
    });
    setText(digestSettingsStatus, '保存しました。');
    await refreshAccount();
  } catch {
    setText(digestSettingsStatus, '保存できませんでした。');
  }
});

document.getElementById('pushSubscribeButton').addEventListener('click', async function () {
  try {
    if (isIosNativePlatform() && capacitorBridge()?.Plugins?.PushNotifications) {
      await subscribeNativePush();
      return;
    }
    var config = await api('/push/config');
    if (!config.push?.vapidPublicKey) {
      setText(digestSettingsStatus, 'プッシュ通知の公開鍵が未設定です。');
      return;
    }
    var registration = await navigator.serviceWorker.ready;
    var subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.push.vapidPublicKey)
    });
    await api('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON() } });
    setText(digestSettingsStatus, 'プッシュ購読を保存しました。');
  } catch {
    setText(digestSettingsStatus, 'プッシュ通知を有効にできませんでした。');
  }
});

async function subscribeNativePush() {
  var push = capacitorBridge()?.Plugins?.PushNotifications;
  if (!push) {
    setText(digestSettingsStatus, 'プッシュ通知機能を利用できません。');
    return;
  }
  var perm = await push.requestPermissions();
  if (perm.receive !== 'granted') {
    setText(digestSettingsStatus, '通知の許可が必要です。');
    return;
  }
  await push.addListener('registration', async function (token) {
    await api('/push/subscribe', {
      method: 'POST',
      body: {
        platform: 'ios-apns',
        token: token.value,
        environment: 'production'
      }
    });
    setText(digestSettingsStatus, 'プッシュ通知を有効にしました。');
  });
  await push.addListener('registrationError', function () {
    setText(digestSettingsStatus, 'プッシュ通知を有効にできませんでした。');
  });
  await push.register();
}

function configureNativeReviewUi() {
  if (!isIosNativePlatform()) return;
  document.body.dataset.nativePlatform = 'ios';
  var signupButton = document.querySelector('[data-auth-mode="signup"]');
  if (signupButton) signupButton.classList.add('is-hidden');
}

document.getElementById('reportSettingsForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  try {
    await api('/account/report-settings', {
      method: 'POST',
      body: {
        enabled: document.getElementById('weeklyReportEnabled').checked,
        avgCaseValue: Number(document.getElementById('avgCaseValue').value || 0)
      }
    });
    setText(reportSettingsStatus, '保存しました。');
    await refreshAccount();
  } catch {
    setText(reportSettingsStatus, '保存できませんでした。');
  }
});

document.getElementById('policyIndustryTemplate').addEventListener('change', function (event) {
  var defaults = INDUSTRY_TEMPLATE_DEFAULTS[event.target.value];
  if (!defaults) return;
  document.getElementById('policyDiscountCeiling').value = String(defaults.discountCeilingPercent);
  document.getElementById('policyMinOrderValue').value = String(defaults.minOrderValueYen);
  document.getElementById('policyBundlePolicy').value = defaults.bundlePolicy;
});

document.getElementById('policySettingsForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  var discount = document.getElementById('policyDiscountCeiling').value;
  var minOrder = document.getElementById('policyMinOrderValue').value;
  try {
    await api('/account/policy-settings', {
      method: 'POST',
      body: {
        industryTemplate: document.getElementById('policyIndustryTemplate').value,
        discountCeilingPercent: discount === '' ? null : Number(discount),
        minOrderValueYen: minOrder === '' ? null : Number(minOrder),
        bundlePolicy: document.getElementById('policyBundlePolicy').value,
        defaultTone: document.getElementById('policyDefaultTone').value,
        freeformNote: document.getElementById('policyFreeformNote').value
      }
    });
    setText(policySettingsStatus, '保存しました。');
    await refreshAccount();
  } catch {
    setText(policySettingsStatus, '保存できませんでした。');
  }
});

document.getElementById('weeklyReportPreviewButton').addEventListener('click', async function () {
  try {
    var report = await api('/report/weekly');
    setText(document.getElementById('weeklyReportPreview'), report.text || '');
    setText(reportSettingsStatus, '');
  } catch {
    setText(reportSettingsStatus, 'レポートを取得できませんでした。');
  }
});

newProjectForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  setText(newProjectStatus, '作成しています。');
  try {
    await api('/projects', {
      method: 'POST',
      body: {
        name: document.getElementById('newProjectName').value,
        summary: document.getElementById('newProjectSummary').value
      }
    });
    newProjectForm.reset();
    setText(newProjectStatus, '作成しました。');
    await refreshProjects();
  } catch {
    setText(newProjectStatus, '作成できませんでした。');
  }
});

backToProjectsButton.addEventListener('click', function () {
  closeProjectDetail();
});

newChannelForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  setText(newChannelStatus, '追加しています。');
  try {
    await api('/projects/' + encodeURIComponent(state.selectedProjectId) + '/channels', {
      method: 'POST',
      body: {
        source: document.getElementById('channelSource').value,
        externalConversationId: document.getElementById('channelExternalId').value,
        counterpartRole: document.getElementById('channelCounterpartRole').value,
        label: document.getElementById('channelLabel').value
      }
    });
    newChannelForm.reset();
    setText(newChannelStatus, '追加しました。');
    await refreshProjectDetail();
  } catch {
    setText(newChannelStatus, '追加できませんでした。');
  }
});

syncChatworkButton.addEventListener('click', async function () {
  setText(syncStatus, '同期しています。');
  try {
    var data = await api('/projects/' + encodeURIComponent(state.selectedProjectId) + '/sync', { method: 'POST', body: {} });
    var count = (data.synced || []).length;
    setText(syncStatus, count + '件のチャネルを同期しました。');
    await refreshProjectDetail();
  } catch {
    setText(syncStatus, '同期できませんでした。');
  }
});

manualMessageForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  setText(manualMessageStatus, '投入しています。');
  try {
    var data = await api('/projects/' + encodeURIComponent(state.selectedProjectId) + '/messages/manual', {
      method: 'POST',
      body: {
        channelLinkId: manualChannelSelect.value,
        senderRole: document.getElementById('manualSenderRole').value,
        senderDisplayName: document.getElementById('manualSenderName').value,
        body: document.getElementById('manualMessageBody').value
      }
    });
    manualMessageForm.reset();
    setText(manualMessageStatus, data.message?.masked ? '投入しました（秘匿情報をマスクしました）。' : '投入しました。');
    await refreshProjectDetail();
  } catch {
    setText(manualMessageStatus, '投入できませんでした。');
  }
});

assistMode.addEventListener('change', function () {
  assistDraftFields.classList.toggle('is-hidden', assistMode.value !== 'draft_reply');
});

assistForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  setText(assistStatus, 'AIに聞いています。');
  assistResult.innerHTML = '';
  var body = { mode: assistMode.value };
  if (assistMode.value === 'draft_reply') {
    body.intent = document.getElementById('assistIntent').value;
    body.audience = document.getElementById('assistAudience').value;
  }
  try {
    var data = await api('/projects/' + encodeURIComponent(state.selectedProjectId) + '/assist', { method: 'POST', body: body });
    setText(assistStatus, '');
    renderAssistResult(data.result);
  } catch (error) {
    setText(assistStatus, error.body?.reason === 'llm_not_configured'
      ? 'AI機能が未設定です。'
      : 'AIに聞けませんでした。');
  }
});

staffForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  setText(staffStatus, '登録しています。');
  try {
    await api('/projects/staff', {
      method: 'POST',
      body: {
        source: document.getElementById('staffSource').value,
        sourceAccountId: document.getElementById('staffAccountId').value,
        staffRole: document.getElementById('staffRole').value,
        displayName: document.getElementById('staffDisplayName').value
      }
    });
    staffForm.reset();
    setText(staffStatus, '登録しました。');
    await refreshStaff();
  } catch {
    setText(staffStatus, '登録できませんでした。');
  }
});

document.querySelector('[data-view="projectsView"]').addEventListener('click', function () {
  if (state.token && !state.projects.length) refreshProjects().catch(function () {});
});

document.querySelector('[data-view="settingsView"]').addEventListener('click', function () {
  if (state.token && !state.staff.length) refreshStaff().catch(function () {});
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}

configureNativeReviewUi();
applySharedInputFromUrl();

if (state.token) {
  showAuthenticated(true);
  refreshAccount().then(refreshInbox).catch(function () {
    localStorage.removeItem('hh_token');
    state.token = '';
    showAuthenticated(false);
  });
} else {
  showAuthenticated(false);
}
