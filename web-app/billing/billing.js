export function renderBillingPanel(container, account = {}) {
  if (!container) return;
  var plan = account.plan || 'unknown';
  var days = Number(account.trialDaysRemaining || 0);
  var portalUrl = '';
  var planText = plan === 'active'
    ? '有効なプランです。'
    : plan === 'trial'
      ? 'トライアル残り ' + days + ' 日です。'
      : 'トライアル期限が切れています。';

  container.innerHTML = '';
  var heading = document.createElement('h2');
  heading.textContent = '課金';
  var text = document.createElement('p');
  text.className = 'status';
  text.textContent = planText + ' 課金導線はWeb版に集約し、アプリ版からは除外できる構成です。';
  var button = document.createElement('button');
  button.type = 'button';
  button.className = portalUrl ? '' : 'secondary';
  button.textContent = portalUrl ? 'Billing Portalを開く' : 'Billing Portal準備中';
  button.disabled = !portalUrl;
  if (portalUrl) {
    button.addEventListener('click', function () {
      window.location.href = portalUrl;
    });
  }
  container.append(heading, text, button);
}
