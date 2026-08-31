import { putJson } from '../kv.js';
import { normalizeInboxItem } from '../schema.js';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacSha256Base64(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

export async function verifyLineSignature(secret, rawBody, signature) {
  const normalizedSecret = String(secret || '').trim();
  const normalizedSignature = String(signature || '').trim();
  if (!normalizedSecret || !normalizedSignature) return false;
  const expected = await hmacSha256Base64(normalizedSecret, rawBody);
  return timingSafeEqual(expected, normalizedSignature);
}

async function resolveLineUserId(env, lineUserId) {
  const linked = await env.APP_KV.get(`line-user:${lineUserId}`);
  return linked || String(env.LINE_DEFAULT_USER_ID || '').trim();
}

async function writeLineInboxItem(env, userId, item) {
  const normalized = normalizeInboxItem(item, { now: Date.now() });
  await putJson(env, `inbox:${userId}:${normalized.id}`, normalized);
  return normalized;
}

function lineMessageToInboxItem(event = {}) {
  const message = event.message || {};
  const source = event.source || {};
  return {
    channel: 'line',
    externalId: String(message.id || event.webhookEventId || ''),
    from: {
      name: 'LINE',
      externalUserId: String(source.userId || '')
    },
    subject: 'LINEメッセージ',
    body: String(message.text || ''),
    receivedAt: Number(event.timestamp || Date.now()),
    sourceMeta: {
      lineUserId: String(source.userId || ''),
      replyToken: String(event.replyToken || '')
    }
  };
}

export async function handleLineWebhook(request, env) {
  const rawBody = await request.text();
  const isValid = await verifyLineSignature(
    env.LINE_CHANNEL_SECRET,
    rawBody,
    request.headers.get('x-line-signature')
  );
  if (!isValid) {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_line_signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  let stored = 0;
  for (const event of Array.isArray(payload.events) ? payload.events : []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const lineUserId = String(event.source?.userId || '');
    const userId = await resolveLineUserId(env, lineUserId);
    if (!userId) continue;
    await writeLineInboxItem(env, userId, lineMessageToInboxItem(event));
    stored += 1;
  }

  return new Response(JSON.stringify({ ok: true, stored }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function sendLineMessage(env, item = {}, body = '', options = {}) {
  const accessToken = String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!accessToken) return { ok: false, reason: 'line_not_configured' };
  const to = String(item.sourceMeta?.lineUserId || item.from?.externalUserId || '').trim();
  if (!to) return { ok: false, reason: 'missing_line_user_id' };
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: String(body || '') }]
    })
  });
  if (!response.ok) return { ok: false, reason: 'line_api_error', status: response.status };
  return { ok: true };
}
