import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { WIRED_PROVIDERS } from '../src/providers.js';
import { PATENT_LABEL } from '../src/reply.js';
import { envWithKv } from './helpers.js';

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

async function rpc(env, method, params, headers = {}) {
  const response = await worker.fetch(
    new Request('https://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    }),
    env
  );
  return { status: response.status, body: await response.json(), headers: response.headers };
}

await test('www と http と末尾スラッシュを揃える', async () => {
  const env = envWithKv();
  const moved = await worker.fetch(
    new Request('http://internal/price', {
      headers: { 'x-forwarded-host': 'www.example.com', 'x-forwarded-proto': 'http' }
    }),
    env
  );
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get('location'), 'https://example.com/price/');
  const local = await worker.fetch(new Request('http://localhost:8787/price'), env);
  assert.equal(local.status, 308);
  assert.equal(local.headers.get('location'), 'http://localhost:8787/price/');
  const root = await worker.fetch(new Request('https://example.com/'), env);
  assert.equal(root.headers.get('location'), 'https://example.com/price/');
});

await test('料金ページは月額と特許表示だけを出し、任意のnoticeは無視する', async () => {
  const response = await worker.fetch(new Request('https://example.com/price/?notice=%3Cscript%3E'), envWithKv());
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /2,980/);
  assert.match(html, /29,800/);
  assert.match(html, /\/price\//);
  assert.doesNotMatch(html, /index\.html/);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes(PATENT_LABEL));
  assert.equal(html.includes('22026'), false);
});

await test('フォームプレビューは候補ツールと送信しない旨を含む', async () => {
  const response = await worker.fetch(new Request('https://example.com/preview/reply-form/'), envWithKv());
  const html = await response.text();
  assert.match(html, /propose_replies/);
  assert.match(html, /confirm_candidate/);
  assert.match(html, /このメールは未送信です/);
  assert.match(html, /差出人/);
  assert.match(html, /宛先/);
  assert.match(html, /下書き保存/);
  assert.match(html, /id="sendButton"/);
  assert.match(html, /ui\/initialize/);
  assert.match(html, /相手の気持ち/);
  assert.match(html, /candidate\.emotion/);
  assert.ok(html.includes(PATENT_LABEL));
  assert.ok(html.includes('特願2026-159882'));
  assert.ok(html.includes('特願2026-041498'));
  assert.equal(html.includes('155882'), false);
  assert.equal(html.includes('041494'), false);
  assert.equal(html.includes('22026'), false);
});

await test('MCPのツールとUIリソースがつながる', async () => {
  const env = envWithKv();
  const listed = await rpc(env, 'tools/list');
  const names = listed.body.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('propose_replies'));
  assert.equal(listed.body.result.tools[0]._meta.ui.resourceUri, 'ui://henshin-hisho/reply-form.html');
  assert.equal(listed.body.result.tools[0]._meta['openai/outputTemplate'], 'ui://henshin-hisho/reply-form.html');
  const init = await rpc(env, 'initialize', { protocolVersion: '2026-06-18', capabilities: {} });
  assert.deepEqual(init.body.result.capabilities.extensions['io.modelcontextprotocol/ui'].mimeTypes, ['text/html;profile=mcp-app']);
  const resource = await rpc(env, 'resources/read', { uri: 'ui://henshin-hisho/reply-form.html' });
  assert.equal(resource.body.result.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.body.result.contents[0].text, /返信候補/);
});

await test('高リスクの候補は確認前にコピー文面を返さない', async () => {
  const env = envWithKv();
  const proposed = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { sender: '山田', subject: '返金', body: '全額返金してください', deskId: 'desk-high-01', channel: 'line' }
  });
  const data = proposed.body.result.structuredContent;
  assert.equal(data.ok, true);
  assert.equal(data.sent, false);
  assert.equal(data.risk.level, 'high');
  assert.equal(data.candidates.length, 3);
  assert.match(data.handoff, /LINE/);
  assert.match(data.priceUrl, /\/price\/$/);
  const blocked = await rpc(env, 'tools/call', {
    name: 'confirm_candidate',
    arguments: { text: data.candidates[0].text, humanConfirmed: true, riskLevel: 'high', channel: 'line' }
  });
  assert.equal(blocked.body.result.structuredContent.ok, false);
  assert.equal(blocked.body.result.structuredContent.sent, false);
  assert.equal(blocked.body.result.structuredContent.copyText, undefined);
});

await test('しおり保存は候補リストを上書きしない', async () => {
  const env = envWithKv();
  const saved = await rpc(env, 'tools/call', {
    name: 'save_shiori',
    arguments: { body: '明日の件です', subject: '確認', deskId: 'desk-shiori1', candidateText: '下書きです' }
  });
  assert.equal(Object.hasOwn(saved.body.result.structuredContent, 'candidates'), false);
  assert.equal(saved.body.result.structuredContent.shiori.length, 1);
  assert.equal(saved.body.result.structuredContent.sent, false);
});

await test('確認は作成時の状態を取り直し、違う文面は渡さない', async () => {
  const env = envWithKv();
  const proposed = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { sender: '佐藤', subject: '挨拶', body: '明日の会議の件です', deskId: 'desk-state-01' }
  });
  const data = proposed.body.result.structuredContent;
  assert.equal(data.stateCheck, 'stored');
  assert.ok(data.snapshotId);
  assert.ok(data.candidates[0].emotion.category);
  const confirmed = await rpc(env, 'tools/call', {
    name: 'confirm_candidate',
    arguments: {
      text: data.candidates[0].text,
      humanConfirmed: true,
      riskLevel: data.risk.level,
      snapshotId: data.snapshotId,
      channel: 'email'
    }
  });
  assert.equal(confirmed.body.result.structuredContent.ok, true);
  assert.equal(confirmed.body.result.structuredContent.stateCheck, 'matched');
  assert.equal(confirmed.body.result.structuredContent.sent, false);
  const changed = await rpc(env, 'tools/call', {
    name: 'confirm_candidate',
    arguments: {
      text: `${data.candidates[0].text}\n追記`,
      humanConfirmed: true,
      riskLevel: data.risk.level,
      snapshotId: data.snapshotId
    }
  });
  assert.equal(changed.body.result.structuredContent.reason, 'state_mismatch');
  assert.equal(changed.body.result.structuredContent.reconfirm, true);
  assert.equal(changed.body.result.structuredContent.copyText, undefined);
  assert.equal(changed.body.result.structuredContent.sent, false);
});

await test('さっきの人はしおりから解決する', async () => {
  const env = envWithKv();
  await rpc(env, 'tools/call', {
    name: 'save_shiori',
    arguments: { sender: '山田', subject: '納期の確認', body: '来週の納期を確認したいです。', deskId: 'desk-ellipsis1' }
  });
  const proposed = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { instruction: 'さっきの人に、納期だけ先に丁寧に返して', deskId: 'desk-ellipsis1' }
  });
  const data = proposed.body.result.structuredContent;
  assert.equal(data.reference.resolved, true);
  assert.equal(data.sender, '山田');
  assert.equal(data.tone, 'polite');
  assert.ok(data.candidates.length >= 1);
  assert.ok(data.candidates.every((candidate) => candidate.emotion && candidate.emotion.reason));
});

await test('通知はプレビュー回数を使わない', async () => {
  const env = envWithKv();
  const result = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { sender: 'noreply@example.com', subject: 'お知らせ', body: '自動配信です', deskId: 'desk-notice1' }
  });
  assert.equal(result.body.result.structuredContent.classification, 'notice');
  assert.equal(result.body.result.structuredContent.candidates.length, 0);
  assert.equal([...env.CHATGPT_KV.store.keys()].some((key) => key.startsWith('preview:')), false);
});

await test('お試し開始と別サイトからのPOST', async () => {
  const env = envWithKv();
  const ok = await worker.fetch(
    new Request('https://example.com/billing/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.com' },
      body: 'email=trial%40example.com'
    }),
    env
  );
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), 'https://example.com/price/?notice=trial_started');
  const opaque = await worker.fetch(
    new Request('https://example.com/billing/trial', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'null',
        'sec-fetch-site': 'same-origin'
      },
      body: 'email=opaque%40example.com'
    }),
    env
  );
  assert.equal(opaque.status, 303);
  assert.match(opaque.headers.get('location'), /notice=trial_started/);
  const cross = await worker.fetch(
    new Request('https://example.com/billing/trial', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site'
      },
      body: 'email=other%40example.com'
    }),
    env
  );
  assert.equal(cross.status, 303);
  assert.match(cross.headers.get('location'), /notice=forbidden/);
  assert.equal((await env.CHATGPT_KV.get('entitlement:other@example.com')), null);
});

await test('アクセストークンが設定されていればMCPを守る', async () => {
  const env = { ...envWithKv(), MCP_ACCESS_TOKEN: 'secret-token' };
  const denied = await rpc(env, 'tools/list');
  assert.equal(denied.status, 401);
  const allowed = await rpc(env, 'tools/list', {}, { authorization: 'Bearer secret-token' });
  assert.equal(allowed.status, 200);
});

await test('Webhookの署名が違うとプランを変えない', async () => {
  const env = { ...envWithKv(), STRIPE_WEBHOOK_SECRET: 'whsec_test' };
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { metadata: { email: 'nope@example.com' }, customer: 'cus_x' } }
  });
  const stamp = Math.floor(Date.now() / 1000);
  const bad = await worker.fetch(
    new Request('https://example.com/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${stamp},v1=deadbeef` },
      body: payload
    }),
    env
  );
  assert.equal(bad.status, 400);
  const signature = createHmac('sha256', 'whsec_test').update(`${stamp}.${payload}`).digest('hex');
  const good = await worker.fetch(
    new Request('https://example.com/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': `t=${stamp},v1=${signature}` },
      body: payload
    }),
    env
  );
  assert.equal(good.status, 200);
  assert.ok(await env.CHATGPT_KV.get('entitlement:nope@example.com'));
});

await test('作成カードは宛先と件名と未送信の本文を返す', async () => {
  const env = envWithKv();
  const proposed = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { sender: 'sato@example.com', subject: '納期の確認', body: '来週の納期を教えてください。', deskId: 'desk-compose1' }
  });
  const data = proposed.body.result.structuredContent;
  const text = proposed.body.result.content[0].text;
  assert.equal(data.compose.to, 'sato@example.com');
  assert.equal(data.compose.subject, 'Re: 納期の確認');
  assert.equal(data.compose.body, data.candidates[0].text);
  assert.equal(data.sent, false);
  assert.match(text, /このメールは未送信です/);
  assert.match(text, /宛先: sato@example.com/);
  assert.match(text, /件名: Re: 納期の確認/);
  assert.equal(proposed.body.result._meta.sendNonce.length > 10, true);
  assert.equal(JSON.stringify(data).includes(proposed.body.result._meta.sendNonce), false);
  assert.equal(text.includes(proposed.body.result._meta.sendNonce), false);
});

await test('送信はカードの承認と状態の再確認が揃ったときだけ', async () => {
  const calls = [];
  const env = {
    ...envWithKv(),
    GOOGLE_CLIENT_SECRET: 'secret',
    GMAIL_FETCH: async (url) => {
      calls.push(String(url));
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'access' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
    }
  };
  const proposed = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { sender: 'sato@example.com', subject: '納期の確認', body: '来週の納期を教えてください。', deskId: 'desk-send-01' }
  });
  const data = proposed.body.result.structuredContent;
  const nonce = proposed.body.result._meta.sendNonce;
  await env.CHATGPT_KV.put('gmail-primary', 'owner@example.com');
  await env.CHATGPT_KV.put(
    'gmail-account:owner@example.com',
    JSON.stringify({ email: 'owner@example.com', refreshToken: 'refresh', provider: 'gmail' })
  );
  const blocked = await rpc(env, 'tools/call', {
    name: 'send_reply',
    arguments: { snapshotId: data.snapshotId, to: data.compose.to, subject: data.compose.subject, body: data.compose.body, userApproved: true }
  });
  assert.equal(blocked.body.result.structuredContent.sent, false);
  assert.equal(blocked.body.result.structuredContent.reason, 'approval_required');
  assert.equal(calls.length, 0);
  const edited = await rpc(env, 'tools/call', {
    name: 'send_reply',
    arguments: {
      snapshotId: data.snapshotId,
      sendNonce: nonce,
      userApproved: true,
      from: 'owner@example.com',
      to: data.compose.to,
      subject: data.compose.subject,
      body: `${data.compose.body}\n追記`
    }
  });
  assert.equal(edited.body.result.structuredContent.reason, 'state_mismatch');
  assert.equal(edited.body.result.structuredContent.reconfirm, true);
  assert.equal(edited.body.result.structuredContent.sent, false);
  assert.equal(calls.length, 0);
  const sent = await rpc(env, 'tools/call', {
    name: 'send_reply',
    arguments: {
      snapshotId: data.snapshotId,
      sendNonce: nonce,
      userApproved: true,
      reconfirmed: true,
      from: 'owner@example.com',
      to: data.compose.to,
      subject: data.compose.subject,
      body: `${data.compose.body}\n追記`
    }
  });
  assert.equal(sent.body.result.structuredContent.sent, true);
  assert.equal(sent.body.result.structuredContent.providerMessageId, 'msg-1');
  assert.equal(calls.some((url) => url.includes('gmail.readonly')), false);
});

await test('下書きはアプリに残り、Gmail には送らない', async () => {
  const env = envWithKv();
  const saved = await rpc(env, 'tools/call', {
    name: 'save_compose_draft',
    arguments: { to: 'sato@example.com', subject: 'Re: 挨拶', body: '確認しました。', deskId: 'desk-draft-01' }
  });
  assert.equal(saved.body.result.structuredContent.sent, false);
  assert.ok(saved.body.result.structuredContent.draftId);
  assert.equal([...env.CHATGPT_KV.store.keys()].some((key) => key.startsWith('app-draft:')), true);
});

await test('転送メールは受信一覧に出て、送信前に取り直す', async () => {
  const env = { ...envWithKv(), INCOMING_FORWARD_TOKEN: 'forward-token' };
  const posted = await worker.fetch(
    new Request('https://example.com/incoming/forward', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-incoming-token': 'forward-token' },
      body: JSON.stringify({ from: 'sato@example.com', subject: '納期の確認', body: '来週でお願いします。', provider: 'email_routing' })
    }),
    env
  );
  const incoming = await posted.json();
  assert.equal(incoming.item.provider, 'email_routing');
  const listed = await rpc(env, 'tools/call', { name: 'list_incoming', arguments: {} });
  assert.equal(listed.body.result.structuredContent.incomingItems.length, 1);
  const proposed = await rpc(env, 'tools/call', {
    name: 'propose_replies',
    arguments: { incomingId: incoming.item.id, deskId: 'desk-incoming1' }
  });
  const data = proposed.body.result.structuredContent;
  assert.equal(data.compose.to, 'sato@example.com');
  await env.CHATGPT_KV.put(
    `incoming:${incoming.item.id}`,
    JSON.stringify({ ...incoming.item, body: '別の本文', hash: 'changed' })
  );
  const blocked = await rpc(env, 'tools/call', {
    name: 'send_reply',
    arguments: {
      snapshotId: data.snapshotId,
      sendNonce: proposed.body.result._meta.sendNonce,
      userApproved: true,
      to: data.compose.to,
      subject: data.compose.subject,
      body: data.compose.body
    }
  });
  assert.equal(blocked.body.result.structuredContent.reason, 'state_mismatch');
  assert.equal(blocked.body.result.structuredContent.sent, false);
});

await test('MCP の発見情報と Gmail の同意 URL', async () => {
  const env = { ...envWithKv(), OAUTH_ADMIN_KEY: 'admin-key' };
  const metadata = await worker.fetch(new Request('https://example.com/.well-known/oauth-protected-resource/mcp'), env);
  const body = await metadata.json();
  assert.equal(body.resource, 'https://example.com/mcp');
  assert.deepEqual(body.authorization_servers, ['https://example.com']);
  const auth = await worker.fetch(new Request('https://example.com/.well-known/oauth-authorization-server'), env);
  const server = await auth.json();
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
  const start = await worker.fetch(new Request('https://example.com/oauth/google/start?key=admin-key'), env);
  assert.equal(start.status, 302);
  const location = start.headers.get('location');
  assert.match(location, /899798982543-2jk3d2fp97c02js71opg7l1j9fa7oh5a/);
  assert.match(location, /gmail\.send/);
  assert.equal(location.includes('gmail.readonly'), false);
  assert.equal(location.includes('gmail.compose'), false);
  assert.equal(location.includes('gmail.modify'), false);
  assert.match(location, /reply\.kimitotalk\.link%2Foauth%2Fgoogle%2Fcallback/);
  assert.deepEqual(WIRED_PROVIDERS.map((provider) => provider.id), ['gmail', 'email_routing']);
  assert.equal(WIRED_PROVIDERS.find((provider) => provider.id === 'gmail').outbound, true);
  assert.equal(WIRED_PROVIDERS.find((provider) => provider.id === 'email_routing').inbound, true);
  assert.equal(WIRED_PROVIDERS.find((provider) => provider.id === 'email_routing').outbound, false);
});

if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
