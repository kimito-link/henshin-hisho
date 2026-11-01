import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { decryptSecret, encryptSecret } from '../src/mail/crypto.js';
import { imapAppend, imapLogin, sentMailbox } from '../src/mail/imap.js';
import { buildMicrosoftAuthUrl } from '../src/mail/microsoft.js';
import { pollAnsweredThreads } from '../src/mail/poll.js';
import { detectProvider, providerOf, serversFor, validateServers } from '../src/mail/providers.js';
import { deliverReply } from '../src/mail/send.js';
import { dotStuff, smtpSession } from '../src/mail/smtp.js';
import { threadFromParsed } from '../src/mail/incoming-email.js';
import { getEmailThread } from '../src/mail/threads.js';
import { plainInitial, xoauth2Initial } from '../src/mail/auth.js';
import { envWithKv } from './helpers.js';

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function scripted(steps, { failOnRead = false } = {}) {
  const sent = [];
  const queue = [...steps];
  const transport = {
    sent,
    async write(line) {
      sent.push(line);
    },
    async writeRaw(text) {
      sent.push(text);
    },
    async readReply() {
      if (failOnRead && sent.some((line) => String(line).includes('\r\n.\r\n'))) {
        throw Object.assign(new Error('closed'), { closed: true });
      }
      const next = queue.shift();
      if (!next) throw Object.assign(new Error('closed'), { closed: true });
      return next;
    },
    async readResponse() {
      return this.readReply();
    },
    async startTls() {
      sent.push('[starttls]');
      return transport;
    },
    async close() {
      sent.push('[close]');
    }
  };
  return transport;
}

function smtpGreeting(extra = []) {
  return [{ code: 220, lines: ['220 ready'] }, { code: 250, lines: ['250 hello'] }, ...extra];
}

await test('ドメインでプロバイダが決まり、利用者は選ばない', async () => {
  assert.equal(providerOf('a@gmail.com'), 'gmail');
  assert.equal(providerOf('a@googlemail.com'), 'gmail');
  assert.equal(providerOf('a@outlook.com'), 'microsoft');
  assert.equal(providerOf('a@hotmail.co.jp'), 'microsoft');
  assert.equal(providerOf('a@live.jp'), 'microsoft');
  assert.equal(providerOf('a@msn.com'), 'microsoft');
  assert.equal(providerOf('a@icloud.com'), 'icloud');
  assert.equal(providerOf('a@me.com'), 'icloud');
  assert.equal(providerOf('a@mac.com'), 'icloud');
  assert.equal(providerOf('a@yahoo.co.jp'), 'yahoojp');
  assert.equal(providerOf('a@ymail.ne.jp'), 'yahoojp');
  assert.equal(providerOf('a@yahoo.com'), 'yahoo');
  assert.equal(providerOf('a@docomo.ne.jp'), 'docomo');
  assert.equal(providerOf('a@softbank.ne.jp'), 'softbank');
  assert.equal(providerOf('a@i.softbank.jp'), 'isoftbank');
  assert.equal(providerOf('a@au.com'), 'au');
  assert.equal(providerOf('a@ezweb.ne.jp'), 'au');
  assert.equal(providerOf('a@ocn.ne.jp'), 'ocn');
  assert.equal(providerOf('a@biglobe.ne.jp'), 'biglobe');
  assert.equal(providerOf('a@so-net.ne.jp'), 'sonet');
  assert.equal(providerOf('a@nifty.com'), 'nifty');
  assert.equal(providerOf('a@zoho.com'), 'zoho');
  assert.equal(providerOf('a@example.com'), 'other');
  assert.equal(serversFor('icloud').smtp.host, 'smtp.mail.me.com');
  assert.equal(serversFor('icloud').smtp.port, 587);
  assert.equal(serversFor('softbank').smtp.host, 'smtp.softbank.ne.jp');
  assert.equal(serversFor('isoftbank').imap.host, 'imap.softbank.jp');
  assert.equal(serversFor('ocn').smtp.host, 'smtp.ocn.ne.jp');
  assert.equal(serversFor('biglobe').imap.host, 'mail.biglobe.ne.jp');
  assert.equal(serversFor('sonet').smtp.port, 587);
  assert.equal(serversFor('nifty').smtp.host, 'smtp.nifty.com');
  assert.equal(serversFor('au').ok, false);
  assert.equal(validateServers({ smtp: { host: '1.2.3.4', port: 465 }, imap: { host: 'imap.example.com', port: 993 } }).ok, false);
  assert.equal(validateServers({ smtp: { host: 'smtp.example.com', port: 25 }, imap: { host: 'imap.example.com', port: 993 } }).ok, false);
  const detected = await detectProvider('example.com', async (url) => {
    assert.match(String(url), /cloudflare-dns\.com\/dns-query/);
    assert.match(String(url), /type=MX/);
    return new Response(JSON.stringify({ Answer: [{ data: '1 aspmx.l.google.com.' }] }), { status: 200 });
  });
  assert.equal(detected, 'workspace');
  const outlook = await detectProvider('example.com', async () => new Response(JSON.stringify({ Answer: [{ data: '10 example.mail.protection.outlook.com.' }] }), { status: 200 }));
  assert.equal(outlook, 'microsoft');
});

await test('アプリパスワードは AES-256-GCM で往復し、壊すと読めない', async () => {
  const packed = await encryptSecret(KEY, 'app-password');
  assert.equal(packed.ok, true);
  assert.match(packed.packed, /^v1:[0-9a-f]+:[0-9a-f]+$/);
  const opened = await decryptSecret(KEY, packed.packed);
  assert.equal(opened.plain, 'app-password');
  const flipped = packed.packed.replace(/.$/, packed.packed.endsWith('0') ? '1' : '0');
  const broken = await decryptSecret(KEY, flipped);
  assert.equal(broken.ok, false);
  assert.equal((await encryptSecret('zz', 'x')).ok, false);
});

await test('SMTP はログインだけなら送らず、DATA のあとで切れたら再送しない', async () => {
  const login = scripted([
    ...smtpGreeting([{ code: 220, lines: ['220 go'] }, { code: 250, lines: ['250 tls'] }, { code: 235, lines: ['235 ok'] }, { code: 221, lines: ['221 bye'] }])
  ]);
  const checked = await smtpSession(login, { secureTransport: 'starttls', username: 'owner@icloud.com', secret: 'app-secret' });
  assert.equal(checked.ok, true);
  assert.equal(login.sent.some((line) => String(line).startsWith('MAIL FROM')), false);
  assert.equal(login.sent.includes('[starttls]'), true);
  const decoded = Buffer.from(login.sent.find((line) => String(line).startsWith('AUTH PLAIN ')).slice('AUTH PLAIN '.length), 'base64').toString('utf8');
  assert.equal(decoded, `\u0000owner@icloud.com\u0000app-secret`);

  const oauth = scripted([...smtpGreeting([{ code: 235, lines: ['235 ok'] }, { code: 221, lines: ['221 bye'] }])]);
  const xo = await smtpSession(oauth, { username: 'a@outlook.com', secret: 'oauth2:token-1' });
  assert.equal(xo.ok, true);
  const xoLine = oauth.sent.find((line) => String(line).startsWith('AUTH XOAUTH2 '));
  assert.equal(Buffer.from(xoLine.slice('AUTH XOAUTH2 '.length), 'base64').toString('utf8'), 'user=a@outlook.com\u0001auth=Bearer token-1\u0001\u0001');
  assert.equal(xoauth2Initial('a@outlook.com', 'token-1'), xoLine.slice('AUTH XOAUTH2 '.length));

  const sent = scripted([
    ...smtpGreeting([
      { code: 235, lines: ['235 ok'] },
      { code: 250, lines: ['250 mail'] },
      { code: 250, lines: ['250 rcpt'] },
      { code: 354, lines: ['354 go'] },
      { code: 250, lines: ['250 queued'] },
      { code: 221, lines: ['221 bye'] }
    ])
  ]);
  const body = 'hello\r\n.secret';
  const delivered = await smtpSession(sent, { username: 'a@nifty.com', secret: 'pw', from: 'a@nifty.com', rcpt: ['sato@example.com'], data: body });
  assert.equal(delivered.ok, true);
  assert.equal(delivered.uncertain, undefined);
  const stuffed = sent.sent.find((line) => String(line).includes('.secret'));
  assert.match(stuffed, /\r\n\.\.secret\r\n\.\r\n$/);
  assert.equal(dotStuff(body).includes('..secret'), true);

  const uncertainTransport = scripted(
    [...smtpGreeting([{ code: 235, lines: ['235 ok'] }, { code: 250, lines: ['250 mail'] }, { code: 250, lines: ['250 rcpt'] }, { code: 354, lines: ['354 go'] }])],
    { failOnRead: true }
  );
  const uncertain = await smtpSession(uncertainTransport, { username: 'a@nifty.com', secret: 'pw', from: 'a@nifty.com', rcpt: ['sato@example.com'], data: 'hello' });
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.uncertain, true);
  assert.equal(uncertainTransport.sent.filter((line) => String(line).startsWith('MAIL FROM')).length, 1);
});

await test('IMAP は XOAUTH2 と送信済み APPEND を話す', async () => {
  const login = scripted([{ ok: true, lines: ['* OK'] }, { ok: true, lines: ['A1 OK'] }]);
  const signed = await imapLogin(login, { username: 'a@outlook.com', secret: 'oauth2:token-1' });
  assert.equal(signed.ok, true);
  assert.match(login.sent[0], /AUTHENTICATE XOAUTH2 /);
  assert.equal(login.sent.some((line) => String(line).startsWith('A1 LOGIN')), false);
  const mailbox = sentMailbox({ lines: ['* LIST (\\HasNoChildren \\Sent) "/" "Sent Messages"', 'A2 OK'] });
  assert.equal(mailbox, 'Sent Messages');
  const append = scripted([{ continuation: true }, { ok: true, lines: ['A3 OK'] }]);
  const saved = await imapAppend(append, 'Sent', 'From: a@nifty.com\r\n\r\nhello');
  assert.equal(saved.ok, true);
  assert.match(append.sent[0], /APPEND "Sent"/);
  assert.equal(plainInitial('u', 'p').length > 0, true);
});

await test('受信は本文を保存せず、失敗しても投げない', async () => {
  const env = envWithKv();
  const raw = [
    'From: Sato <sato@example.com>',
    'To: owner@icloud.com',
    'Cc: cc@example.com',
    'Message-ID: <m1@example.com>',
    'X-Forwarded-For: owner@icloud.com',
    'Subject: hi',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'あ'.repeat(400)
  ].join('\r\n');
  await worker.email({ raw, from: 'sato@example.com', headers: new Headers() }, env);
  const index = JSON.parse(await env.CHATGPT_KV.get('email-thread-index'));
  const thread = await getEmailThread(env, index[0]);
  assert.equal(thread.owner, 'owner@icloud.com');
  assert.equal(thread.from_address, 'sato@example.com');
  assert.equal(thread.message_id, '<m1@example.com>');
  assert.equal(Object.hasOwn(thread, 'body'), false);
  assert.equal(thread.quote_text.length <= 280, true);
  assert.equal(thread.quote_text.includes('あ'), true);
  await worker.email({ raw, from: 'sato@example.com', headers: new Headers() }, env);
  const again = JSON.parse(await env.CHATGPT_KV.get('email-thread-index'));
  assert.equal(again.length, 1);
  await worker.email({ get raw() { throw new Error('boom'); } }, env);
  await worker.email(null, env);
});

await test('設定ページは IMAP と SMTP のログインだけ確認し、メールは送らない', async () => {
  const env = { ...envWithKv(), OAUTH_ADMIN_KEY: 'admin-key', MAIL_TOKEN_ENCRYPTION_KEY: KEY };
  const connects = [];
  env.MAIL_CONNECT = ({ port }) => {
    connects.push(port);
    if (port === 993) return scripted([{ ok: true, lines: ['* OK'] }, { ok: true, lines: ['A1 OK'] }]);
    return scripted([...smtpGreeting([{ code: 220, lines: ['220 go'] }, { code: 250, lines: ['250 tls'] }, { code: 235, lines: ['235 ok'] }, { code: 221, lines: ['221 bye'] }])]);
  };
  const issued = await worker.fetch(new Request('https://example.com/auth/mail-app/issue?key=admin-key&address=owner@icloud.com'), env);
  const text = await issued.text();
  const code = new URL(text.split('\n')[1]).searchParams.get('c');
  const form = new URLSearchParams({ c: code, password: 'app-secret-value' });
  const saved = await worker.fetch(
    new Request(`https://example.com/auth/mail-app/setup?c=${code}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form
    }),
    env
  );
  assert.match(await saved.text(), /メールは送っていません/);
  const link = JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com'));
  assert.equal(link.status, 'active');
  assert.equal(link.provider, 'icloud');
  assert.match(link.password_enc, /^v1:/);
  assert.equal(JSON.stringify(link).includes('app-secret-value'), false);
  assert.equal(connects.includes(587), true);
  assert.equal(connects.includes(993), true);
  const bad = { ...envWithKv(), OAUTH_ADMIN_KEY: 'admin-key', MAIL_TOKEN_ENCRYPTION_KEY: KEY };
  let attempts = 0;
  bad.MAIL_CONNECT = ({ port }) => {
    attempts += 1;
    if (port === 993) return scripted([{ ok: true, lines: ['* OK'] }, { ok: false, lines: ['A1 NO'] }]);
    return scripted([...smtpGreeting([{ code: 220, lines: ['220 go'] }, { code: 250, lines: ['250 tls'] }, { code: 535, lines: ['535 no'] }])]);
  };
  const second = await worker.fetch(new Request('https://example.com/auth/mail-app/issue?key=admin-key&address=owner@yahoo.co.jp'), bad);
  const secondCode = new URL((await second.text()).split('\n')[1]).searchParams.get('c');
  for (let i = 0; i < 5; i += 1) {
    await worker.fetch(
      new Request(`https://example.com/auth/mail-app/setup?c=${secondCode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ c: secondCode, password: 'wrong' })
      }),
      bad
    );
  }
  const before = attempts;
  const locked = await worker.fetch(
    new Request(`https://example.com/auth/mail-app/setup?c=${secondCode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ c: secondCode, password: 'wrong' })
    }),
    bad
  );
  assert.match(await locked.text(), /試行回数/);
  assert.equal(attempts, before);
});

await test('iCloud は SMTP でスレッドの宛先へ送り、認証失敗は error、不明なら再送しない', async () => {
  const env = { ...envWithKv(), MAIL_TOKEN_ENCRYPTION_KEY: KEY };
  const packed = await encryptSecret(KEY, 'app-secret');
  await env.CHATGPT_KV.put(
    'mail-link:owner@icloud.com',
    JSON.stringify({
      kind: 'operator',
      address: 'owner@icloud.com',
      provider: 'icloud',
      owner: 'owner@icloud.com',
      password_enc: packed.packed,
      status: 'active',
      sent_ids: [],
      servers_json: { login: 'owner@icloud.com' }
    })
  );
  await env.CHATGPT_KV.put('mail-link-index', JSON.stringify(['owner@icloud.com']));
  const thread = {
    id: 'thread-1',
    message_id: '<m1@example.com>',
    reply_to_address: 'sato@example.com',
    from_address: 'sato@example.com',
    to_address: 'owner@icloud.com',
    cc_address: '',
    bcc_address: '',
    reference_ids: '<root@example.com>',
    owner: 'owner@icloud.com'
  };
  let opens = 0;
  const smtpLogs = [];
  env.MAIL_CONNECT = ({ port }) => {
    opens += 1;
    if (port === 993) {
      return scripted([
        { ok: true, lines: ['* OK'] },
        { ok: true, lines: ['A1 OK'] },
        { ok: true, lines: ['* LIST (\\Sent) "/" "Sent Messages"', 'A2 OK'] },
        { continuation: true },
        { ok: true, lines: ['A3 OK'] }
      ]);
    }
    const transport = scripted([
      ...smtpGreeting([
        { code: 220, lines: ['220 go'] },
        { code: 250, lines: ['250 tls'] },
        { code: 235, lines: ['235 ok'] },
        { code: 250, lines: ['250 mail'] },
        { code: 250, lines: ['250 rcpt'] },
        { code: 354, lines: ['354 go'] },
        { code: 250, lines: ['250 queued'] },
        { code: 221, lines: ['221 bye'] }
      ])
    ]);
    smtpLogs.push(transport);
    return transport;
  };
  const sent = await deliverReply(env, {
    sender: { linked: true, transport: 'smtp', address: 'owner@icloud.com', provider: 'icloud', label: 'iCloud', link: JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com')) },
    thread,
    subject: 'Re: 納期の確認',
    body: '来週です。'
  });
  assert.equal(sent.sent, true);
  assert.equal(sent.uncertain, false);
  const transcript = smtpLogs[0].sent.map(String).join('\n');
  assert.match(transcript, /RCPT TO:<sato@example.com>/);
  assert.equal(transcript.includes('evil@example.com'), false);
  assert.match(transcript, /In-Reply-To: <m1@example.com>/);
  const link = JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com'));
  assert.equal(link.sent_ids.length, 1);
  assert.match(link.sent_ids[0], /@icloud\.com>$/);
  const headers = `In-Reply-To: ${thread.message_id}\r\n`;
  await pollAnsweredThreads(env, { headersFor: async () => headers });
  const answered = JSON.parse(await env.CHATGPT_KV.get('email-thread:thread-1') || 'null');
  assert.equal(answered, null);

  const stored = {
    ...thread,
    subject: '納期',
    quote_text: '短い',
    received_at: Date.now(),
    recipient_hash: 'hash'
  };
  await env.CHATGPT_KV.put('email-thread:thread-1', JSON.stringify(stored));
  await env.CHATGPT_KV.put(`email-thread-msgid:${thread.message_id}`, 'thread-1');
  await pollAnsweredThreads(env, { headersFor: async () => headers });
  const marked = await getEmailThread(env, 'thread-1');
  assert.ok(marked.answered_at);

  opens = 0;
  env.MAIL_CONNECT = () => {
    opens += 1;
    return scripted(
      [...smtpGreeting([{ code: 220, lines: ['220 go'] }, { code: 250, lines: ['250 tls'] }, { code: 235, lines: ['235 ok'] }, { code: 250, lines: ['250 mail'] }, { code: 250, lines: ['250 rcpt'] }, { code: 354, lines: ['354 go'] }])],
      { failOnRead: true }
    );
  };
  const before = JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com')).sent_ids.length;
  const unclear = await deliverReply(env, {
    sender: { linked: true, transport: 'smtp', address: 'owner@icloud.com', provider: 'icloud', label: 'iCloud', link: JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com')) },
    thread,
    subject: 'Re: 納期の確認',
    body: '来週です。'
  });
  assert.equal(unclear.uncertain, true);
  assert.equal(unclear.sent, false);
  assert.equal(opens, 1);
  assert.equal(JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com')).sent_ids.length, before);

  env.MAIL_CONNECT = () => scripted([...smtpGreeting([{ code: 220, lines: ['220 go'] }, { code: 250, lines: ['250 tls'] }, { code: 535, lines: ['535 no'] }])]);
  const denied = await deliverReply(env, {
    sender: { linked: true, transport: 'smtp', address: 'owner@icloud.com', provider: 'icloud', label: 'iCloud', link: JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com')) },
    thread,
    subject: 'Re: 納期の確認',
    body: '来週です。'
  });
  assert.equal(denied.reason, 'smtp_auth_failed');
  assert.equal(JSON.parse(await env.CHATGPT_KV.get('mail-link:owner@icloud.com')).status, 'error');
});

await test('転送先アドレスは owner にせず、X-Forwarded-For の本人だけを残す', async () => {
  for (const routing of ['notify@kimitotalk.link', 'reply@kimitotalk.link']) {
    const fields = threadFromParsed(
      { from: [{ address: 'sender@example.com' }], messageId: '<a@example.com>' },
      { from: routing }
    );
    assert.equal(fields.owner, '');
  }
  const kept = threadFromParsed(
    { from: [{ address: 'sender@example.com' }], messageId: '<b@example.com>' },
    { from: 'owner@icloud.com' }
  );
  assert.equal(kept.owner, 'owner@icloud.com');
  const forwarded = threadFromParsed(
    {
      headers: [{ key: 'x-forwarded-for', value: 'owner@icloud.com' }],
      from: [{ address: 'sender@example.com' }],
      messageId: '<c@example.com>'
    },
    { from: 'reply@kimitotalk.link' }
  );
  assert.equal(forwarded.owner, 'owner@icloud.com');
});

await test('Microsoft は OAuth が揃ったときだけ送信経路になる', async () => {
  const env = {
    MS_OAUTH_ENABLED: '1',
    MS_CLIENT_ID: 'ms-client',
    MS_CLIENT_SECRET: 'ms-secret',
    WORKER_PUBLIC_URL: 'https://reply.kimitotalk.link'
  };
  const url = buildMicrosoftAuthUrl(env, 'state-1', 'owner@outlook.com');
  assert.match(url, /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/);
  assert.match(url, /prompt=select_account/);
  assert.match(url, /login_hint=owner%40outlook\.com/);
  assert.match(url, /IMAP\.AccessAsUser\.All/);
  assert.match(url, /SMTP\.Send/);
  assert.match(url, /offline_access/);
  assert.match(url, /redirect_uri=https%3A%2F%2Freply\.kimitotalk\.link%2Fauth%2Fms%2Fcallback/);
  const off = await worker.fetch(new Request('https://example.com/auth/ms/start?key=admin'), envWithKv());
  assert.equal(off.status, 404);
});

if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
