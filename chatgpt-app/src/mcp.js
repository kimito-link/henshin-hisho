import { billingView, consumeGeneration, PRICE_YEN, startTrial } from './billing.js';
import { mcpCorsHeaders, publicOrigin, validDeskId } from './http.js';
import { applyInstruction, assessMessage, buildCandidates, compareSnapshot, handoffFor, PATENT_LABEL, reviewConfirmation } from './reply.js';
import { listShiori, saveShiori } from './shiori.js';
import { WIDGET_HTML } from './widget.js';

const RESOURCE_URI = 'ui://henshin-hisho/reply-form.html';
const RESOURCE_MIME = 'text/html;profile=mcp-app';
const FALLBACK_PROTOCOL_VERSION = '2026-06-18';

const UI_META = {
  ui: { resourceUri: RESOURCE_URI },
  'ui/resourceUri': RESOURCE_URI
};

const APP_ONLY = {
  ui: { resourceUri: RESOURCE_URI, visibility: ['app'] },
  'ui/resourceUri': RESOURCE_URI
};

const TOOLS = [
  {
    name: 'open_reply_desk',
    title: '返信候補フォームを開く',
    description:
      '受け取った連絡の返信候補フォームを開く。危険度の理由を表示する。メール・LINE・Chatworkへの送信はしない。候補が必要なら propose_replies を使う。',
    inputSchema: messageSchema(),
    _meta: UI_META
  },
  {
    name: 'propose_replies',
    title: '返信候補を作る',
    description:
      '本文と自然文の指示から、危険度（点数と理由）と返信候補を作る。各候補に、相手が受け取りそうな気持ち（分類・点数・理由）を付ける。「さっきの人」はしおりの直近に解決し、無いときは推測しない。通知メールは返信候補を作らず振り分ける。高リスクは保留表現だけにする。送信はしない。',
    inputSchema: messageSchema(),
    _meta: UI_META
  },
  {
    name: 'save_shiori',
    title: 'しおりに残す',
    description: '本文と選んだ候補をしおりとして残し、次に参照できるようにする。送信はしない。',
    inputSchema: {
      type: 'object',
      properties: {
        ...messageSchema().properties,
        candidateText: { type: 'string' },
        riskLevel: { type: 'string' }
      }
    },
    _meta: UI_META
  },
  {
    name: 'list_shiori',
    title: 'しおりを見る',
    description: '保存したしおりを新しい順に返す。送信はしない。',
    inputSchema: {
      type: 'object',
      properties: { deskId: { type: 'string' }, email: { type: 'string' } }
    },
    _meta: UI_META
  },
  {
    name: 'confirm_candidate',
    title: '確認してコピー用の文面を渡す',
    description:
      '人が確認チェックを入れた後だけ、コピー用の文面を返す。作成時に保存した文面と危険度を取り直し、不一致なら文面を渡さず再確認を求める。高リスクはリスク確認も必須。送信はしない。アプリのフォームからのみ呼ぶ。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        humanConfirmed: { type: 'boolean' },
        riskAcknowledged: { type: 'boolean' },
        riskLevel: { type: 'string' },
        channel: { type: 'string' },
        deskId: { type: 'string' }
      },
      required: ['text', 'humanConfirmed']
    },
    _meta: APP_ONLY
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
    _meta: UI_META
  },
  {
    name: 'billing_status',
    title: 'プランを確認する',
    description: `メールアドレスのプラン（プレビュー、お試し、有料、終了）と料金（月額${PRICE_YEN}円）を返す。`,
    inputSchema: {
      type: 'object',
      properties: { email: { type: 'string' }, deskId: { type: 'string' } }
    },
    _meta: UI_META
  }
];

function messageSchema() {
  return {
    type: 'object',
    properties: {
      sender: { type: 'string', description: '差出人' },
      subject: { type: 'string', description: '件名' },
      body: { type: 'string', description: '相手からの本文' },
      channel: { type: 'string', enum: ['email', 'line', 'chatwork', 'other'] },
      tone: { type: 'string', enum: ['polite', 'firm', 'calm', 'casual'] },
      intent: { type: 'string', description: '返信の意図' },
      email: { type: 'string', description: '利用者のメールアドレス' },
      deskId: { type: 'string' },
      discountCeilingPercent: { type: 'integer', description: '値引き上限（%）' },
      minOrderValueYen: { type: 'integer', description: '最低受注額（円）' }
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
    handoff: assessment.handoff,
    risk: assessment.risk,
    shiori: shiori.items || [],
    billing,
    priceUrl: `${origin}/price/`,
    patentLabel: PATENT_LABEL,
    sent: false
  };
  if (Object.prototype.hasOwnProperty.call(extra, 'candidates')) payload.candidates = extra.candidates;
  if (extra.reference) payload.reference = extra.reference;
  if (extra.instruction) payload.instruction = extra.instruction;
  if (extra.snapshotId !== undefined) payload.snapshotId = extra.snapshotId;
  if (extra.stateCheck) payload.stateCheck = extra.stateCheck;
  return payload;
}

async function prepareInput(env, input) {
  const listed = await listShiori(env, input);
  return applyInstruction(input, listed.items || []);
}

async function storeSnapshot(env, assessment, candidates) {
  if (!candidates.length) return { snapshotId: '', stateCheck: 'not_needed' };
  const snapshotId = crypto.randomUUID();
  const snapshot = {
    id: snapshotId,
    riskLevel: assessment.risk.level,
    texts: candidates.map((candidate) => candidate.text)
  };
  if (!env.CHATGPT_KV) return { snapshotId, stateCheck: 'not_stored' };
  await env.CHATGPT_KV.put(`snapshot:${snapshotId}`, JSON.stringify(snapshot), { expirationTtl: 86400 });
  return { snapshotId, stateCheck: 'stored' };
}

function toolResult(payload, text) {
  return {
    isError: payload.ok === false,
    content: [{ type: 'text', text }],
    structuredContent: payload
  };
}

async function callTool(env, name, args, origin) {
  const input = args && typeof args === 'object' ? args : {};
  if (name === 'open_reply_desk') {
    const payload = await present(env, input, origin, { candidates: [] });
    return toolResult(payload, '返信候補フォームを開きました。送信はしていません。');
  }
  if (name === 'propose_replies') {
    const prepared = await prepareInput(env, input);
    const source = prepared.input;
    const context = { reference: prepared.reference, instruction: prepared.instruction };
    const assessment = assessMessage(source);
    if (!assessment.message.body) {
      const payload = await present(env, source, origin, { ok: false, reason: 'empty_message', candidates: [], ...context });
      return toolResult(payload, '本文が空です。送信はしていません。');
    }
    if (assessment.classification === 'notice') {
      const payload = await present(env, source, origin, { candidates: [], ...context });
      return toolResult(payload, '通知メールとして振り分けました。返信候補は作っていません。送信はしていません。');
    }
    const gate = await consumeGeneration(env, source);
    if (!gate.ok) {
      const payload = await present(env, source, origin, {
        ok: false,
        reason: gate.reason,
        billing: gate.billing,
        candidates: [],
        ...context
      });
      return toolResult(
        payload,
        `候補の作成にはお試し、または月額${PRICE_YEN}円のプランが必要です。危険度は表示しています。送信はしていません。`
      );
    }
    const candidates = buildCandidates(assessment);
    const snapshot = await storeSnapshot(env, assessment, candidates);
    const payload = await present(env, source, origin, {
      candidates,
      billing: gate.billing,
      snapshotId: snapshot.snapshotId,
      stateCheck: snapshot.stateCheck,
      ...context
    });
    const who = prepared.reference.resolved ? `さっきの人は${prepared.reference.sender || 'しおりの相手'}に解決しました。` : '';
    return toolResult(
      payload,
      `返信候補を${candidates.length}件作りました。各候補に相手の気持ち（分類・点数・理由）を付けました。危険度は${assessment.risk.level}（${assessment.risk.score}）。${who}送信はしていません。`
    );
  }
  if (name === 'save_shiori') {
    const saved = await saveShiori(env, input);
    const payload = await present(env, input, origin, { ok: saved.ok, reason: saved.reason || '' });
    return toolResult(payload, saved.ok ? 'しおりに残しました。送信はしていません。' : 'しおりに残せませんでした。送信はしていません。');
  }
  if (name === 'list_shiori') {
    const listed = await listShiori(env, input);
    const payload = await present(env, input, origin, { ok: listed.ok, reason: listed.reason || '' });
    return toolResult(payload, 'しおりを返しました。送信はしていません。');
  }
  if (name === 'confirm_candidate') {
    const review = reviewConfirmation(input);
    if (!review.ok) {
      return toolResult(
        { ok: false, reason: review.reason, sent: false, priceUrl: `${origin}/price/`, patentLabel: PATENT_LABEL },
        '確認が足りないため、文面を渡していません。送信はしていません。'
      );
    }
    let stateCheck = 'not_stored';
    if (env.CHATGPT_KV) {
      const snapshotId = String(input.snapshotId || '');
      const raw = snapshotId ? await env.CHATGPT_KV.get(`snapshot:${snapshotId}`) : null;
      let snapshot = null;
      try {
        snapshot = raw ? JSON.parse(raw) : null;
      } catch {
        snapshot = null;
      }
      const compared = compareSnapshot(snapshot, review);
      if (!compared.ok) {
        return toolResult(
          {
            ok: false,
            reason: 'state_mismatch',
            reconfirm: true,
            sent: false,
            priceUrl: `${origin}/price/`,
            patentLabel: PATENT_LABEL
          },
          '内容が変わったため、コピー用の文面は渡していません。候補を作り直して、もう一度確認してください。送信はしていません。'
        );
      }
      stateCheck = 'matched';
    }
    const id = crypto.randomUUID();
    if (env.CHATGPT_KV) {
      await env.CHATGPT_KV.put(
        `confirm:${id}`,
        JSON.stringify({
          id,
          at: Date.now(),
          riskLevel: review.riskLevel,
          channel: input.channel || 'email',
          sent: false,
          stateCheck
        })
      );
    }
    return toolResult(
      {
        ok: true,
        copyText: review.copyText,
        confirmation: { id, sent: false },
        handoff: handoffFor(input.channel),
        stateCheck,
        sent: false,
        priceUrl: `${origin}/price/`,
        patentLabel: PATENT_LABEL
      },
      '確認を記録しました。文面はコピー用です。送信はしていません。'
    );
  }
  if (name === 'start_trial') {
    const started = await startTrial(env, input.email);
    const payload = await present(env, input, origin, {
      ok: started.ok,
      reason: started.reason || '',
      billing: started.billing
    });
    return toolResult(payload, started.ok ? 'お試しの状態を返しました。送信はしていません。' : 'お試しを開始できません。送信はしていません。');
  }
  if (name === 'billing_status') {
    const billing = await billingView(env, input.email);
    const payload = await present(env, input, origin, { billing });
    return toolResult(payload, `プランは${billing.plan}です。月額${PRICE_YEN}円。送信はしていません。`);
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
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'henshin-hisho-chatgpt', version: '0.1.0' }
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
        resources: [
          {
            uri: RESOURCE_URI,
            name: 'reply-form',
            description: '返信候補フォーム',
            mimeType: RESOURCE_MIME
          }
        ]
      })
    );
  }
  if (method === 'resources/read') {
    if (params?.uri !== RESOURCE_URI) return respond(request, rpcError(id, -32002, 'resource not found'));
    return respond(
      request,
      rpcResult(id, {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME, text: WIDGET_HTML }]
      })
    );
  }
  if (method === 'tools/call') {
    try {
      const result = await callTool(env, params?.name, params?.arguments, origin);
      console.log(JSON.stringify({ event: 'mcp_tool', tool: params?.name || '', ok: result?.structuredContent?.ok !== false }));
      return respond(request, rpcResult(id, result));
    } catch (error) {
      console.log(JSON.stringify({ event: 'mcp_error', message: error?.message || 'error' }));
      return respond(request, rpcError(id, error.rpcCode || -32000, error.rpcCode ? error.message : 'server_error'));
    }
  }
  return respond(request, rpcError(id, -32601, `method not found: ${method}`));
}
