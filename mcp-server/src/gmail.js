/**
 * gmail.js — Gmail API (読み取り専用) の薄いラッパー。
 *
 * 【掟】このモジュールは読むだけ。送信・下書き作成・既読化などの書き込み系エンドポイントは
 * 一切呼ばない（メッセージへの既読フラグは Gmail API 上「既読にする」ことになるため、
 * 未読判定に使う list/get は既読化を伴わない範囲のみ使う）。
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FETCH_TIMEOUT_MS = 8000;

async function gmailFetch(accessToken, path) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`gmail api ${path} failed: ${res.status} ${JSON.stringify(json)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * Gmail検索クエリでメッセージID一覧を取る。
 * @param {string} accessToken
 * @param {string} query 例: 'from:(coconala.com) newer_than:2d is:unread'
 * @param {number} maxResults
 */
export async function searchMessages(accessToken, query, maxResults = 10) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const json = await gmailFetch(accessToken, `/messages?${params.toString()}`);
  return Array.isArray(json.messages) ? json.messages : [];
}

function headerValue(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    // Cloudflare Workers has atob() globally.
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  // text/plainが無ければ本文なしとして扱う(html decodeまではしない — 過剰実装を避ける)。
  return '';
}

/**
 * メッセージ本文の要約に使う最小限のフィールドだけを返す。
 * 全文は返さない（音声要約用にsnippetと件名・送信者で十分。深掘りはPhase 2で検討）。
 */
export async function getMessageSummary(accessToken, messageId) {
  const json = await gmailFetch(
    accessToken,
    `/messages/${messageId}?format=full&fields=id,snippet,internalDate,payload(headers,mimeType,body,parts)`
  );
  const headers = json.payload?.headers || [];
  const bodyText = extractPlainText(json.payload) || json.snippet || '';
  return {
    id: json.id,
    from: headerValue(headers, 'From'),
    subject: headerValue(headers, 'Subject'),
    snippet: json.snippet || '',
    body: bodyText.slice(0, 2000), // 過剰な本文取り込みを避ける上限
    internalDate: Number(json.internalDate) || 0
  };
}
