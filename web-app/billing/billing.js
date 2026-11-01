import { ANNUAL_YEN, OPERATOR_NAME, PATENT_FOOTER, PRICE_YEN, TRIAL_DAYS } from './plans.js';

function planLabel(account) {
  var plan = account.plan || 'none';
  var days = Number(account.trialDaysRemaining || 0);
  if (plan === 'active') return '加入中';
  if (plan === 'trial') return 'お試し中。残り ' + days + ' 日';
  if (plan === 'expired') return 'お試し期間は終わりました';
  return '未加入';
}

function button(label, onClick) {
  var element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

export function renderBillingPanel(container, account = {}, actions = {}) {
  if (!container) return;
  container.replaceChildren();
  var heading = document.createElement('h2');
  heading.textContent = 'プラン';
  var status = document.createElement('p');
  status.className = 'status';
  status.textContent = planLabel(account) + '。月額 ' + PRICE_YEN.toLocaleString('ja-JP') + '円、年額 ' + ANNUAL_YEN.toLocaleString('ja-JP') + '円です。';
  var value = document.createElement('p');
  value.textContent = '同じメールアドレスの契約で、このWeb、iPhone、Android、会話の中の作成カードが使えます。お試しは' + TRIAL_DAYS + '日間です。';
  var note = document.createElement('p');
  note.className = 'status';
  note.id = 'billingNote';
  var monthly = button('月額 ' + PRICE_YEN.toLocaleString('ja-JP') + '円で始める', function () {
    note.textContent = '月額の支払いへ進みます。';
    Promise.resolve(actions.onCheckout && actions.onCheckout('monthly')).catch(function () {
      note.textContent = '支払いの準備ができてから、もう一度選べます。';
    });
  });
  var annual = button('年額 ' + ANNUAL_YEN.toLocaleString('ja-JP') + '円で始める', function () {
    note.textContent = '年額の支払いへ進みます。';
    Promise.resolve(actions.onCheckout && actions.onCheckout('annual')).catch(function () {
      note.textContent = '支払いの準備ができてから、もう一度選べます。';
    });
  });
  annual.className = 'secondary';
  var refresh = button('プラン状態を更新', function () {
    note.textContent = '契約の状態を確認しています。';
    Promise.resolve(actions.onRefresh && actions.onRefresh()).then(function () {
      note.textContent = '契約の状態を更新しました。';
    }).catch(function () {
      note.textContent = '状態を更新できませんでした。時間をおいてもう一度更新できます。';
    });
  });
  refresh.className = 'secondary';
  var operator = document.createElement('p');
  operator.className = 'status';
  operator.textContent = '運営は' + OPERATOR_NAME + 'です。メールは、確認したときだけ送ります。';
  var patent = document.createElement('p');
  patent.className = 'status';
  patent.textContent = PATENT_FOOTER;
  container.append(heading, status, value, monthly, annual, refresh, note, operator, patent);
}
