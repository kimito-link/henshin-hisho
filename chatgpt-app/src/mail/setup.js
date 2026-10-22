import { htmlHeaders, normalizeEmail, readForm, sameSitePost } from '../http.js';
import { encryptSecret } from './crypto.js';
import { findLinkByCode, putLink } from './links.js';
import { providerLabel, sendPath, serversFor } from './providers.js';
import { verifyMailboxLogin } from './send.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function page(body) {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>メールの接続</title></head><body style="font-family:system-ui,sans-serif;line-height:1.5;max-width:36rem;margin:24px auto;padding:0 16px">${body}</body></html>`,
    { headers: htmlHeaders() }
  );
}

function formBody(link, code, error) {
  const custom = !serversFor(link.provider, link.servers_json).ok || link.provider === 'au' || link.provider === 'other';
  const loginLabel = link.provider === 'docomo' ? 'dアカウント ID' : 'ログイン ID（空ならメールアドレス）';
  const notice = error ? `<p>${escapeHtml(error)}</p>` : '';
  const servers = custom
    ? `<label>SMTP ホスト<input name="smtpHost" required></label>
       <label>SMTP ポート（465 または 587）<input name="smtpPort" inputmode="numeric" required></label>
       <label>IMAP ホスト<input name="imapHost" required></label>`
    : '';
  return page(`${notice}
    <h1>${escapeHtml(providerLabel(link.provider))} を接続</h1>
    <p>${escapeHtml(link.address)}。アプリパスワードでログインできるかだけ確認します。メールは送りません。</p>
    <form method="post" action="/auth/mail-app/setup?c=${escapeHtml(code)}">
      <input type="hidden" name="c" value="${escapeHtml(code)}">
      <label>${escapeHtml(loginLabel)}<input name="login" autocomplete="username" value="${escapeHtml(link.servers_json?.login || '')}"></label>
      <label>アプリパスワード<input name="password" type="password" autocomplete="current-password" required></label>
      ${servers}
      <button type="submit">接続を確認して保存</button>
    </form>`);
}

export async function mailSetup(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('c') || '';
  if (request.method === 'GET') {
    if (!code) {
      return page('<h1>メールの接続</h1><p>接続コード付きの URL を開いてください。コードは10分で切れます。Gmail は別の接続です。</p>');
    }
    const link = await findLinkByCode(env, code);
    if (!link || link.status === 'revoked') return page('<p>このコードは使えません。</p>');
    if (link.setup_expires_at && Date.now() > link.setup_expires_at) return page('<p>コードの期限が切れています。発行し直してください。</p>');
    if (link.attempts >= 5) return page('<p>試行回数を超えました。発行し直してください。</p>');
    return formBody(link, code, '');
  }
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!sameSitePost(request)) return page('<p>別のサイトからの送信は受け付けません。</p>');
  const form = await readForm(request);
  const submitted = form?.c || code;
  const link = await findLinkByCode(env, submitted);
  if (!link) return page('<p>このコードは使えません。</p>');
  if (link.setup_expires_at && Date.now() > link.setup_expires_at) return page('<p>コードの期限が切れています。発行し直してください。</p>');
  if (link.attempts >= 5) return page('<p>試行回数を超えました。発行し直してください。</p>');
  link.attempts += 1;
  await putLink(env, link);
  if (sendPath(link.provider, env) !== 'password') return page('<p>このアドレスはアプリパスワードでは接続しません。</p>');
  const password = String(form?.password || '');
  if (!password) return formBody(link, submitted, 'パスワードを入れてください。');
  let servers = serversFor(link.provider, link.servers_json);
  if (link.provider === 'au' || link.provider === 'other' || !servers.ok) {
    servers = serversFor('other', {
      smtp: { host: form?.smtpHost, port: form?.smtpPort },
      imap: { host: form?.imapHost, port: 993 },
      login: form?.login
    });
  }
  if (!servers.ok) return formBody(link, submitted, 'サーバはホスト名と、465 か 587 のポートだけ使えます。');
  const login = String(form?.login || servers.login || '').trim();
  if (link.provider === 'docomo' && !login) return formBody(link, submitted, 'ドコモは dアカウント ID が必要です。');
  const username = login || link.address;
  let verified;
  try {
    verified = await verifyMailboxLogin(env, {
      smtp: servers.smtp,
      imap: servers.imap,
      username,
      secret: password
    });
  } catch {
    return formBody(link, submitted, 'サーバに接続できませんでした。メールは送っていません。');
  }
  if (!verified.ok) {
    return formBody(link, submitted, 'ログインできませんでした。メールは送っていません。');
  }
  const packed = await encryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, password);
  if (!packed.ok) return page('<p>暗号化キーが未設定です。パスワードは保存していません。</p>');
  await putLink(env, {
    ...link,
    password_enc: packed.packed,
    status: 'active',
    verified_at: Date.now(),
    setup_code_hash: '',
    setup_expires_at: 0,
    last_result: 'verified',
    servers_json: { ...servers, login: username }
  });
  return page(`<h1>接続しました</h1><p>${escapeHtml(providerLabel(link.provider))}（${escapeHtml(link.address)}）を保存しました。メールは送っていません。</p>`);
}

export function normalizeSetupAddress(value) {
  return normalizeEmail(value);
}
