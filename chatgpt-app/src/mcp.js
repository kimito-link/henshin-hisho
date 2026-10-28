import { billingView, consumeGeneration, PRICE_YEN, startTrial } from './billing.js';
import { buildCompose, compareSendState, fallbackText } from './compose.js';
import { generateCandidates } from './drafts.js';
import { buildGoogleAuthUrl } from './gmail.js';
import { deliverReply, resolveReplySender, senderFields } from './mail/send.js';
import { threadRecipients } from './mail/threads.js';
import { mcpCorsHeaders, normalizeEmail, publicOrigin, validDeskId } from './http.js';
import { accessTokenRecord } from './mcp-oauth.js';
import { getIncoming, listIncoming } from './incoming.js';
import { applyInstruction, assessMessage, buildCandidates, compareSnapshot, handoffFor, PATENT_LABEL, reviewConfirmation } from './reply.js';
import { listShiori, saveShiori } from './shiori.js';
import { WIDGET_HTML } from './widget.js';

const RESOURCE_URI = 'ui://henshin-hisho/reply-form.html';
const RESOURCE_MIME = 'text/html;profile=mcp-app';
const FALLBACK_PROTOCOL_VERSION = '2026-06-18';

function uiMeta(appOnly = false) {
  const ui = { resourceUri: RESOURCE_URI };
  if (appOnly) ui.visibility = ['app'];
  return {
    ui,
    'ui/resourceUri': RESOURCE_URI,
    'openai/outputTemplate': RESOURCE_URI
  };
}

const TOOLS = [
  {
    name: 'open_reply_desk',
    title: 'メールの作成カードを開く',
    description: '宛先・件名・本文の作成カードを開く。送信はしない。候補が必要なら propose_replies を使う。',
    inputSchema: messageSchema(),
    _meta: uiMeta()
  },
  {
    name: 'propose_replies',
    title: '返信の作成カードを作る',
    description:
      '受け取ったメールへの返信カードを返す。宛先は元メールか、しおりの「さっきの人」から解決する。件名は Re: を付ける。本文は候補の先頭で、候補には相手の気持ち（分類・点数・理由）が付く。LLM は backend の下書き API を通し、使えないときは定型文にする。送信はしない。',
    inputSchema: messageSchema(),
    _meta: uiMeta()
  },
  {
    name: 'list_incoming',
    title: '届いたメールを見る',
    description: '転送（Cloudflare Email Routing）で取り込んだ受信メールを新しい順に返す。送信はしない。',
    inputSchema: { type: 'object', properties: {} },
    _meta: uiMeta()
  },
  {
    name: 'get_incoming',
    title: '届いたメールを1件見る',
    description: '受信メールを1件返す。そのあと propose_replies に incomingId を渡す。送信はしない。',
    inputSchema: { type: 'object', properties: { incomingId: { type: 'string' } }, required: ['incomingId'] },
    _meta: uiMeta()
  },
  {
    name: 'save_shiori',
    title: 'しおりに残す',
    description: '本文と選んだ候補をしおりとして残す。送信はしない。',
    inputSchema: {
      type: 'object',
      properties: { ...messageSchema().properties, candidateText: { type: 'string' }, riskLevel: { type: 'string' } }
    },
    _meta: uiMeta()
  },
  {
    name: 'list_shiori',
    title: 'しおりを見る',
    description: '保存したしおりを新しい順に返す。送信はしない。',
    inputSchema: { type: 'object', properties: { deskId: { type: 'string' }, email: { type: 'string' } } },
    _meta: uiMeta()
  },
  {
    name: 'confirm_candidate',
    title: '確認してコピー用の文面を渡す',
    description: '人が確認したあとだけ、コピー用の文面を返す。状態が違えば渡さない。送信はしない。カードからのみ呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        humanConfirmed: { type: 'boolean' },
        riskAcknowledged: { type: 'boolean' },
        riskLevel: { type: 'string' },
        channel: { type: 'string' },
        deskId: { type: 'string' },
        snapshotId: { type: 'string' }
      },
      required: ['text', 'humanConfirmed']
    },
    _meta: uiMeta(true)
  },
  {
    name: 'save_compose_draft',
    title: '下書きをアプリに保存する',
    description: '作成中の宛先・件名・本文をアプリ側に保存する。Gmail の下書きにはしない。送信はしない。カードからのみ呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: {
        deskId: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' }
      }
    },
    _meta: uiMeta(true)
  },
  {
    name: 'send_reply',
    title: '作成カードから送信する',
    description:
      'カードの「送信」を押したときだけ送る。差出人が Gmail / Workspace なら Gmail API、それ以外の接続済みアドレスなら SMTP。宛先は保存した受信スレッドだけを使い、直前に取り直す。違えば送らず再確認を求める。モデルからは呼ばない。',
    inputSchema: {
      type: 'object',
      properties: {
        userApproved: { type: 'boolean' },
        reconfirmed: { type: 'boolean' },
        sendNonce: { type: 'string' },
        snapshotId: { type: 'string' },
        riskAcknowledged: { type: 'boolean' },
        riskLevel: { type: 'string' },
        channel: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['userApproved', 'sendNonce', 'snapshotId']
    },
    _meta: uiMeta(true)
  },
  {
    name: 'start_trial',
    title: '14日のお試しを始める',
    description: `メールアドレスで${14}日のお試しを開始する。同じメールで二度は開始しない。送信はしない。`,
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string' }, deskId: { type: 'string' } },
      required: ['email']
    },
    _meta: uiMeta()
  },
  {
    name: 'billing_status',
    title: 'プランを確認する',
    description: `メールアドレスのプランと料金（月額${PRICE_YEN}円）を返す。送信はしない。`,
    inputSchema: { type: 'object', properties: { email: { type: 'string' }, deskId: { type: 'string' } } },
    _meta: uiMeta()
  }
];

function messageSchema() {
  return {
    type: 'object',
    properties: {
      sender: { type: 'string', description: '相手の名前またはメールアドレス' },
      to: { type: 'string', description: '宛先。空なら相手のメールアドレスを使う' },
      from: { type: 'string', description: '表示用。送信時の差出人は接続済みアカウントから決める' },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      subject: { type: 'string', description: '相手の件名。返信では Re: を付ける' },
      body: { type: 'string', description: '相手からの本文' },
      channel: { type: 'string', enum: ['email', 'line', 'chatwork', 'other'] },
      tone: { type: 'string', enum: ['polite', 'firm', 'calm', 'casual'] },
      intent: { type: 'string', description: '返信の意図' },
      instruction: { type: 'string', description: '自然文の指示。さっきの人、など' },
      email: { type: 'string', description: '利用者のメールアドレス' },
      deskId: { type: 'string' },
      incomingId: { type: 'string', description: '取り込んだ受信メールの id' },
      discountCeilingPercent: { type: 'integer' },
      minOrderValueYen: { type: 'integer' }
    }
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function respond(request, body, status = 200) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...mcpCorsHeaders()
  };
  const session = request.headers.get('mcp-session-id');
  if (session) headers['mcp-session-id'] = session;
  return new Response(JSON.stringify(body), { status, headers });
}

function deskOf(input = {}) {
  return { ...input, deskId: validDeskId(input.deskId) || crypto.randomUUID() };
}

async function present(env, input, origin, extra = {}) {
  const desk = deskOf(input);
  const assessment = assessMessage(desk);
  const billing = extra.billing || (await billingView(env, desk.email));
  const shiori = await listShiori(env, desk);
  const thread = extra.incoming || null;
  let compose = extra.compose;
  if (!compose) {
    compose = buildCompose(desk, extra.reference || {});
    if (thread) {
      const recipients = threadRecipients(thread);
      compose.to = recipients.to || thread.from || compose.to;
      compose.cc = recipients.cc;
      compose.bcc = recipients.bcc;
      compose.threadId = thread.id || '';
      compose.incomingId = thread.id || '';
    }
    Object.assign(compose, senderFields(await resolveReplySender(env, { thread, origin }), origin));
  }
  const payload = {
    ok: extra.ok !== false,
    reason: extra.reason || '',
    deskId: desk.deskId,
    sender: assessment.message.sender,
    subject: assessment.message.subject,
    body: assessment.message.body,
    intent: assessment.message.intent,
    tone: assessment.message.tone,
    channel: assessment.message.channel,
    discountCeilingPercent: assessment.message.discountCeilingPercent,
    minOrderValueYen: assessment.message.minOrderValueYen,
    classification: assessment.classification,
    handoff: extra.handoff || assessment.handoff,
    risk: assessment.risk,
    shiori: shiori.items || [],
    billing,
    priceUrl: `${origin}/price/`,
    patentLabel: PATENT_LABEL,
    compose,
    draftSource: extra.draftSource || '',
    sent: extra.sent === true
  };
  if (Object.prototype.hasOwnProperty.call(extra, 'candidates')) payload.candidates = extra.candidates;
  if (extra.reference) payload.reference = extra.reference;
  if (extra.instruction) payload.instruction = extra.instruction;
  if (extra.snapshotId !== undefined) payload.snapshotId = extra.snapshotId;
  if (extra.stateCheck) payload.stateCheck = extra.stateCheck;
  if (extra.reconfirm) payload.reconfirm = true;
  if (extra.incoming) payload.incoming = extra.incoming;
  return payload;
}

async function prepareInput(env, input) {
  const listed = await listShiori(env, input);
  const prepared = applyInstruction(input, listed.items || []);
  const source = { ...prepared.input };
  let incoming = null;
  if (source.incomingId) {
    incoming = await getIncoming(env, source.incomingId);
    if (incoming) {
      if (!source.sender) source.sender = incoming.from;
      if (!source.subject) source.subject = incoming.subject;
      if (!source.body) source.body = incoming.body;
      const recipients = threadRecipients(incoming);
      source.to = recipients.to || incoming.from;
      source.cc = recipients.cc;
      source.bcc = recipients.bcc;
      source.incomingId = incoming.id;
    }
  }
  return { ...prepared, input: source, incoming };
}

async function storeSnapshot(env, assessment, candidates, compose, incoming) {
  const sendNonce = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const snapshot = {
    id: snapshotId,
    riskLevel: assessment.risk.level,
    texts: candidates.map((candidate) => candidate.text),
    to: compose.to,
    cc: compose.cc,
    bcc: compose.bcc,
    subject: compose.subject,
    body: compose.body,
    incomingId: incoming?.id || '',
    incomingHash: incoming?.hash || '',
    threadId: incoming?.id || '',
    threadHash: incoming?.hash || '',
    sendNonce
  };
  if (!candidates.length) return { snapshotId: '', stateCheck: 'not_needed', sendNonce: '' };
  if (!env.CHATGPT_KV) return { snapshotId, stateCheck: 'not_stored', sendNonce };
  await env.CHATGPT_KV.put(`snapshot:${snapshotId}`, JSON.stringify(snapshot), { expirationTtl: 86400 });
  return { snapshotId, stateCheck: 'stored', sendNonce };
}

function toolResult(payload, meta) {
  const result = {
    isError: payload.ok === false,
    content: [{ type: 'text', text: fallbackText(payload) }],
    structuredContent: payload
  };
  if (meta) result._meta = meta;
  return result;
}

async function loadSnapshot(env, id) {
  if (!env.CHATGPT_KV || !id) return null;
  const raw = await env.CHATGPT_KV.get(`snapshot:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function callTool(env, name, args, origin, accountEmail = '') {
  const input = { ...(args && typeof args === 'object' ? args : {}) };
  if (accountEmail) input.email = accountEmail;
  if (name === 'open_reply_desk') {
    const payload = await present(env, input, origin, { candidates: [] });
    return toolResult(payload);
  }
  if (name === 'list_incoming') {
    const listed = await listIncoming(env);
    const payload = await present(env, input, origin, { ok: listed.ok, reason: listed.reason || '', candidates: [] });
    payload.incomingItems = listed.items || [];
    return toolResult(payload);
  }
  if (name === 'get_incoming') {
    const item = await getIncoming(env, input.incomingId);
    const payload = await present(env, item ? { ...input, sender: item.from, subject: item.subject, body: item.body, to: item.from, incomingId: item.id } : input, origin, {
      ok: Boolean(item),
      reason: item ? '' : 'invalid_incoming',
      candidates: [],
      incoming: item
    });
    return toolResult(payload);
  }
  if (name === 'propose_replies') {
    const prepared = await prepareInput(env, input);
    const source = prepared.input;
    const context = { reference: prepared.reference, instruction: prepared.instruction, incoming: prepared.incoming };
    const assessment = assessMessage(source);
    if (!assessment.message.body) {
      const payload = await present(env, source, origin, { ok: false, reason: 'empty_message', candidates: [], ...context });
      return toolResult(payload);
    }
    if (assessment.classification === 'notice') {
      const payload = await present(env, source, origin, { candidates: [], ...context });
      return toolResult(payload);
    }
    const gate = await consumeGeneration(env, source);
    const generated = gate.ok
      ? await generateCandidates(env, assessment)
      : { candidates: buildCandidates(assessment), draftSource: 'template', draftReason: gate.reason };
    const compose = buildCompose(source, prepared.reference);
    if (prepared.incoming) {
      const recipients = threadRecipients(prepared.incoming);
      compose.to = recipients.to || prepared.incoming.from || compose.to;
      compose.cc = recipients.cc;
      compose.bcc = recipients.bcc;
      compose.threadId = prepared.incoming.id;
      compose.incomingId = prepared.incoming.id;
    }
    Object.assign(compose, senderFields(await resolveReplySender(env, { thread: prepared.incoming, origin }), origin));
    compose.body = generated.candidates[0]?.text || '';
    const snapshot = await storeSnapshot(env, assessment, generated.candidates, compose, prepared.incoming);
    const payload = await present(env, source, origin, {
      candidates: generated.candidates,
      billing: gate.billing || (await billingView(env, source.email)),
      compose,
      draftSource: generated.draftSource,
      reason: generated.draftReason || '',
      snapshotId: snapshot.snapshotId,
      stateCheck: snapshot.stateCheck,
      ...context
    });
    return toolResult(payload, snapshot.sendNonce ? { sendNonce: snapshot.sendNonce } : null);
  }
  if (name === 'save_shiori') {
    const saved = await saveShiori(env, input);
    const payload = await present(env, input, origin, { ok: saved.ok, reason: saved.reason || '' });
    return toolResult(payload);
  }
  if (name === 'list_shiori') {
    const payload = await present(env, input, origin);
    return toolResult(payload);
  }
  if (name === 'save_compose_draft') {
    if (!env.CHATGPT_KV) {
      const payload = await present(env, input, origin, { ok: false, reason: 'storage_not_configured', sent: false });
      return toolResult(payload);
    }
    const id = crypto.randomUUID();
    const compose = buildCompose(input, {});
    Object.assign(compose, senderFields(await resolveReplySender(env, { origin }), origin));
    compose.body = String(input.body || '').slice(0, 4000);
    compose.subject = String(input.subject || compose.subject).slice(0, 200);
    await env.CHATGPT_KV.put(`app-draft:${id}`, JSON.stringify({ id, compose, at: Date.now() }));
    const payload = await present(env, input, origin, { compose, sent: false });
    payload.draftId = id;
    return toolResult(payload);
  }
  if (name === 'send_reply') {
    const channel = input.channel || 'email';
    if (channel !== 'email') {
      const payload = await present(env, input, origin, { ok: false, reason: 'channel_not_email', sent: false, handoff: handoffFor(channel) });
      return toolResult(payload);
    }
    const snapshot = await loadSnapshot(env, input.snapshotId);
    const thread = snapshot?.threadId ? await getIncoming(env, snapshot.threadId) : null;
    const compared = compareSendState(snapshot, thread, input);
    const sender = await resolveReplySender(env, { thread, origin });
    const recipients = threadRecipients(thread);
    const compose = {
      ...senderFields(sender, origin),
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: input.subject || snapshot?.subject || '',
      body: input.body || snapshot?.body || '',
      threadId: thread?.id || '',
      incomingId: thread?.id || ''
    };
    if (!compared.ok) {
      const payload = await present(env, input, origin, {
        ok: false,
        reason: compared.reason,
        reconfirm: compared.reason === 'state_mismatch',
        sent: false,
        incoming: thread,
        compose
      });
      return toolResult(payload);
    }
    if (snapshot.riskLevel === 'high' && input.riskAcknowledged !== true) {
      const payload = await present(env, input, origin, { ok: false, reason: 'risk_acknowledgement_required', sent: false, compose });
      return toolResult(payload);
    }
    if (!sender.linked) {
      const payload = await present(env, input, origin, { ok: false, reason: 'mail_not_connected', sent: false, incoming: thread, compose });
      return toolResult(payload);
    }
    const sent = await deliverReply(env, {
      sender,
      thread,
      subject: input.subject || snapshot.subject,
      body: input.body ?? snapshot.body
    });
    const payload = await present(env, input, origin, {
      ok: sent.ok,
      reason: sent.ok ? '' : sent.reason,
      sent: sent.sent === true,
      incoming: thread,
      compose: { ...compose, subject: input.subject || snapshot.subject, body: input.body ?? snapshot.body }
    });
    payload.uncertain = sent.uncertain === true;
    if (sent.gmailId || sent.messageId) payload.providerMessageId = sent.gmailId || sent.messageId;
    return toolResult(payload);
  }
  if (name === 'confirm_candidate') {
    const review = reviewConfirmation(input);
    if (!review.ok) {
      return toolResult({ ok: false, reason: review.reason, sent: false, priceUrl: `${origin}/price/`, patentLabel: PATENT_LABEL, compose: {}, candidates: [] });
    }
    let stateCheck = 'not_stored';
    if (env.CHATGPT_KV) {
      const snapshot = await loadSnapshot(env, input.snapshotId);
      const compared = compareSnapshot(snapshot, review);
      if (!compared.ok) {
        return toolResult({
          ok: false,
          reason: 'state_mismatch',
          reconfirm: true,
          sent: false,
          priceUrl: `${origin}/price/`,
          patentLabel: PATENT_LABEL,
          compose: { body: '' },
          candidates: []
        });
      }
      stateCheck = 'matched';
    }
    return toolResult({
      ok: true,
      copyText: review.copyText,
      confirmation: { id: crypto.randomUUID(), sent: false },
      handoff: handoffFor(input.channel),
      stateCheck,
      sent: false,
      priceUrl: `${origin}/price/`,
      patentLabel: PATENT_LABEL,
      compose: { body: review.copyText, subject: '', to: '', from: '' },
      candidates: []
    });
  }
  if (name === 'start_trial') {
    const started = await startTrial(env, input.email);
    const payload = await present(env, input, origin, { ok: started.ok, reason: started.reason || '', billing: started.billing, candidates: [] });
    return toolResult(payload);
  }
  if (name === 'billing_status') {
    const billing = await billingView(env, input.email);
    const payload = await present(env, input, origin, { billing, candidates: [] });
    return toolResult(payload);
  }
  throw Object.assign(new Error(`unknown tool: ${name}`), { rpcCode: -32602 });
}

export async function handleMcpRequest(request, env) {
  const origin = publicOrigin(request);
  let body;
  try {
    body = await request.json();
  } catch {
    return respond(request, rpcError(null, -32700, 'parse error'), 400);
  }
  if (Array.isArray(body)) return respond(request, rpcError(null, -32600, 'batch not supported'), 400);
  const { id, method, params } = body || {};

  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const protocolVersion = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : FALLBACK_PROTOCOL_VERSION;
    return respond(
      request,
      rpcResult(id, {
        protocolVersion,
        capabilities: {
          tools: {},
          resources: {},
          extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [RESOURCE_MIME] } }
        },
        serverInfo: { name: 'henshin-hisho', version: '0.2.0' }
      })
    );
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return new Response(null, { status: 202, headers: mcpCorsHeaders() });
  }
  if (method === 'ping') return respond(request, rpcResult(id, {}));
  if (method === 'tools/list') return respond(request, rpcResult(id, { tools: TOOLS }));
  if (method === 'resources/list') {
    return respond(
      request,
      rpcResult(id, {
        resources: [{ uri: RESOURCE_URI, name: 'reply-form', description: 'メールの作成カード', mimeType: RESOURCE_MIME }]
      })
    );
  }
  if (method === 'resources/read') {
    if (params?.uri !== RESOURCE_URI) return respond(request, rpcError(id, -32002, 'resource not found'));
    return respond(request, rpcResult(id, { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME, text: WIDGET_HTML }] }));
  }
  if (method === 'tools/call') {
    try {
      const header = request.headers.get('authorization') || '';
      const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const access = await accessTokenRecord(env, bearer);
      const accountEmail = normalizeEmail(access?.accountEmail || '');
      const result = await callTool(env, params?.name, params?.arguments, origin, accountEmail);
      console.log(JSON.stringify({ event: 'mcp_tool', tool: params?.name || '', ok: result?.structuredContent?.ok !== false }));
      return respond(request, rpcResult(id, result));
    } catch (error) {
      console.log(JSON.stringify({ event: 'mcp_error', message: error?.message || 'error' }));
      return respond(request, rpcError(id, error.rpcCode || -32000, error.rpcCode ? error.message : 'server_error'));
    }
  }
  return respond(request, rpcError(id, -32601, `method not found: ${method}`));
}

export { buildGoogleAuthUrl };
