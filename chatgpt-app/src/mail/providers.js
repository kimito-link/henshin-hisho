/**
 * メールプロバイダ。利用者が選ぶのではなく、アドレスのドメインと MX で決めて mail_app_links.provider に保存する。
 * 受信はどのプロバイダも reply@kimitotalk.link への転送（Email Routing → email()）だけ。
 * notify@kimitotalk.link は linebot のままにし、この Worker には向けない。
 * 送信は二つだけ。Gmail / Workspace は Gmail API。それ以外は cloudflare:sockets の SMTP。
 * send_email バインディング、message.reply()、Resend、MailChannels、Graph sendMail は使わない。
 *
 * ホストの出典:
 * - icloud: 仕様（linebot cf7fd72）。Apple のサーバ設定 https://support.apple.com/ja-jp/102525
 * - microsoft: 仕様。https://support.microsoft.com/ja-jp/office/pop-imap-および-smtp-の設定-8361e398-8af4-4e97-b147-6c6c4ac95353
 * - yahoojp / yahoo / docomo / zoho: 仕様で指定されたホスト
 * - isoftbank: https://www.softbank.jp/mobile/service/mail-address-portability/email-i/
 *   および https://www.softbank.jp/mobile/support/mail/setting/iphone/sslsecurity/ （smtp.softbank.jp:465 / imap.softbank.jp:993）
 * - softbank: https://www.softbank.jp/mobile/service/mail-address-portability/mms/ （smtp.softbank.ne.jp:465 / imap.softbank.ne.jp:993）
 * - ocn: https://support.ocn.ne.jp/personal/purpose/detail/pid2990021006/ および https://service.ocn.ne.jp/option/mail/ocnmail/basic.html
 * - biglobe: https://support.biglobe.ne.jp/settei/mailer/imap.html （mail.biglobe.ne.jp の SMTP 465 / IMAP 993）
 * - sonet: https://support.so-net.ne.jp/fa/faq/web/knowledge1687.html （mail.so-net.ne.jp:587 STARTTLS / imap.so-net.ne.jp:993。IMAP は申し込みが必要）
 * - nifty: https://mail.nifty.com/cs/mail-faq/detail/200326000044/ （smtp.nifty.com:465 / imap.nifty.com:993、送信済みは Sent）
 *   新規の IMAP は事前の「メールソフト接続許可（IMAP）」が必要 https://mail.nifty.com/cs/mail-info/detail/sg-2nwnbi/
 * - au / other: 固定ホストは置かない。servers_json は利用者入力。ポートは 465 か 587 だけ。IP リテラルは拒否する。
 */

export const GMAIL_SCOPES = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send'
]);

const PRESETS = {
  icloud: { smtp: { host: 'smtp.mail.me.com', port: 587, tls: 'starttls' }, imap: { host: 'imap.mail.me.com', port: 993 } },
  microsoft: { smtp: { host: 'smtp.office365.com', port: 587, tls: 'starttls' }, imap: { host: 'outlook.office365.com', port: 993 } },
  yahoojp: { smtp: { host: 'smtp.mail.yahoo.co.jp', port: 465, tls: 'on' }, imap: { host: 'imap.mail.yahoo.co.jp', port: 993 } },
  yahoo: { smtp: { host: 'smtp.mail.yahoo.com', port: 465, tls: 'on' }, imap: { host: 'imap.mail.yahoo.com', port: 993 } },
  docomo: { smtp: { host: 'smtp.spmode.ne.jp', port: 465, tls: 'on' }, imap: { host: 'imap.spmode.ne.jp', port: 993 }, loginIsId: true },
  zoho: { smtp: { host: 'smtp.zoho.com', port: 465, tls: 'on' }, imap: { host: 'imap.zoho.com', port: 993 } },
  isoftbank: { smtp: { host: 'smtp.softbank.jp', port: 465, tls: 'on' }, imap: { host: 'imap.softbank.jp', port: 993 } },
  softbank: { smtp: { host: 'smtp.softbank.ne.jp', port: 465, tls: 'on' }, imap: { host: 'imap.softbank.ne.jp', port: 993 } },
  ocn: { smtp: { host: 'smtp.ocn.ne.jp', port: 465, tls: 'on' }, imap: { host: 'imap.ocn.ne.jp', port: 993 } },
  biglobe: { smtp: { host: 'mail.biglobe.ne.jp', port: 465, tls: 'on' }, imap: { host: 'mail.biglobe.ne.jp', port: 993 } },
  sonet: { smtp: { host: 'mail.so-net.ne.jp', port: 587, tls: 'starttls' }, imap: { host: 'imap.so-net.ne.jp', port: 993 } },
  nifty: { smtp: { host: 'smtp.nifty.com', port: 465, tls: 'on' }, imap: { host: 'imap.nifty.com', port: 993 }, sentMailbox: 'Sent' }
};

const LABELS = {
  gmail: 'Gmail',
  workspace: 'Google Workspace',
  microsoft: 'Microsoft',
  icloud: 'iCloud',
  yahoojp: 'Yahoo!メール',
  yahoo: 'Yahoo',
  docomo: 'ドコモメール',
  softbank: 'ソフトバンク',
  isoftbank: 'Eメール(i)',
  au: 'au',
  ocn: 'OCN',
  biglobe: 'BIGLOBE',
  sonet: 'So-net',
  nifty: '@nifty',
  zoho: 'Zoho',
  other: 'メール'
};

export const PROVIDER_IDS = Object.freeze([
  'gmail',
  'workspace',
  'microsoft',
  'icloud',
  'yahoojp',
  'yahoo',
  'docomo',
  'softbank',
  'isoftbank',
  'au',
  'ocn',
  'biglobe',
  'sonet',
  'nifty',
  'zoho',
  'other'
]);

const DOMAIN_RULES = [
  [/^(gmail\.com|googlemail\.com)$/i, 'gmail'],
  [/^(outlook|hotmail|live|msn)\.(com|jp|co\.jp)$/i, 'microsoft'],
  [/^(icloud\.com|me\.com|mac\.com)$/i, 'icloud'],
  [/^(yahoo\.co\.jp|ymail\.ne\.jp)$/i, 'yahoojp'],
  [/^yahoo\.com$/i, 'yahoo'],
  [/^docomo\.ne\.jp$/i, 'docomo'],
  [/^i\.softbank\.jp$/i, 'isoftbank'],
  [/^softbank\.ne\.jp$/i, 'softbank'],
  [/^(au\.com|ezweb\.ne\.jp)$/i, 'au'],
  [/^ocn\.ne\.jp$/i, 'ocn'],
  [/^biglobe\.ne\.jp$/i, 'biglobe'],
  [/^so-net\.ne\.jp$/i, 'sonet'],
  [/^(nifty\.com|nifty\.ne\.jp)$/i, 'nifty'],
  [/^(zoho\.com|zohomail\.com)$/i, 'zoho']
];

export function providerLabel(id) {
  return LABELS[id] || LABELS.other;
}

export function presetOf(id) {
  return PRESETS[id] || null;
}

/** Gmail / Workspace は google。Microsoft は OAuth が揃ったときだけ password。それ以外は password。 */
export function sendPath(id, env = {}) {
  if (id === 'gmail' || id === 'workspace') return 'google';
  if (id === 'microsoft') {
    if (env.MS_OAUTH_ENABLED === '1' && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET) return 'password';
    return 'forward_only';
  }
  return 'password';
}

export const WIRED_PROVIDERS = Object.freeze(
  PROVIDER_IDS.map((id) =>
    Object.freeze({
      id,
      label: providerLabel(id),
      inbound: true,
      outbound: id === 'microsoft' ? false : true,
      path: id === 'gmail' || id === 'workspace' ? 'google' : id === 'microsoft' ? 'forward_only' : 'password',
      scopes: id === 'gmail' || id === 'workspace' ? GMAIL_SCOPES : Object.freeze([])
    })
  )
);

export function providerById(id) {
  return WIRED_PROVIDERS.find((provider) => provider.id === id) || null;
}

export function outboundProviders() {
  return WIRED_PROVIDERS.filter((provider) => provider.outbound);
}

export function inboundProviders() {
  return WIRED_PROVIDERS.filter((provider) => provider.inbound);
}

export function domainOf(address) {
  const at = String(address || '').toLowerCase().lastIndexOf('@');
  if (at < 1) return '';
  return String(address).slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
}

export function providerOf(address) {
  const domain = domainOf(address);
  if (!domain) return 'other';
  for (const [pattern, id] of DOMAIN_RULES) {
    if (pattern.test(domain)) return id;
  }
  return 'other';
}

export function isHostname(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host || host.length > 253) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host);
}

export function validateServers(input) {
  const smtp = input?.smtp || {};
  const imap = input?.imap || {};
  const port = Number(smtp.port);
  const imapPort = Number(imap.port);
  if (!isHostname(smtp.host) || !isHostname(imap.host)) return { ok: false, reason: 'invalid_server' };
  if (port !== 465 && port !== 587) return { ok: false, reason: 'invalid_server' };
  if (imapPort !== 993) return { ok: false, reason: 'invalid_server' };
  const tls = port === 587 ? 'starttls' : 'on';
  return {
    ok: true,
    smtp: { host: String(smtp.host).trim().toLowerCase(), port, tls },
    imap: { host: String(imap.host).trim().toLowerCase(), port: 993 },
    login: String(input.login || '').trim()
  };
}

export function serversFor(providerId, serversJson) {
  const preset = PRESETS[providerId];
  if (preset?.smtp) {
    return {
      ok: true,
      smtp: preset.smtp,
      imap: preset.imap,
      login: String(serversJson?.login || '').trim(),
      loginIsId: Boolean(preset.loginIsId),
      sentMailbox: preset.sentMailbox || ''
    };
  }
  return validateServers(serversJson);
}

/** other のときだけ呼ぶ。MX が Google / Microsoft / iCloud / Zoho ならそれに寄せる。 */
export async function detectProvider(domain, fetchImpl = fetch) {
  const name = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
  if (!isHostname(name)) return 'other';
  try {
    const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=MX`, {
      headers: { accept: 'application/dns-json' }
    });
    if (!response.ok) return 'other';
    const json = await response.json();
    const data = (Array.isArray(json.Answer) ? json.Answer : []).map((answer) => String(answer.data || '').toLowerCase()).join(' ');
    if (data.includes('aspmx.l.google.com')) return 'workspace';
    if (data.includes('mail.protection.outlook.com')) return 'microsoft';
    if (/mx\d*\.mail\.icloud\.com/.test(data)) return 'icloud';
    if (data.includes('zoho')) return 'zoho';
  } catch {
    return 'other';
  }
  return 'other';
}
