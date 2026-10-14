/**
 * index.js — henshin-hisho-mcp Worker のエントリポイント。
 *
 * ルーティング:
 *   GET  /oauth/start     人間がブラウザで開く。OAUTH_ADMIN_KEY必須。Google同意画面へリダイレクト（初回のみ）
 *   GET  /oauth/callback  Googleからのコールバック。state検証＋アカウント検証の後、Refresh TokenをKVに保存
 *   POST /mcp             MCP Streamable HTTP エンドポイント（Grokから呼ばれる）
 *
 * 認証: /mcp は MCP_ACCESS_TOKEN（Secretsに登録する固定トークン）を
 *   Authorization: Bearer で要求する。このURLは公開される前提なので、
 *   誰でも叩ける状態を避けるための最小限のゲート。
 *
 * ★/oauth/start は当初無認証だった。第三者がこのURLを直接開いて自分のGoogle
 *   アカウントで同意すると、KVの gmail_refresh_token が上書きされ連携が乗っ取られる
 *   （state無しだとCSRFでも同じことが起きる）。OAUTH_ADMIN_KEY・state・
 *   ALLOWED_GMAIL検証の3点で塞ぐ（2026-09-06 Fableレビューで指摘）。
 */
import { buildAuthUrl, exchangeCodeForTokens, saveRefreshToken, verifyAccountEmail } from './oauth.js';
import { handleMcpRequest } from './mcp.js';

const OAUTH_STATE_PREFIX = 'oauth_state:';
const OAUTH_STATE_TTL_SECONDS = 600;

function timingSafeEqual(a, b) {
  const bufA = new TextEncoder().encode(String(a || ''));
  const bufB = new TextEncoder().encode(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i += 1) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

function requireMcpAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!env.MCP_ACCESS_TOKEN || !timingSafeEqual(token, env.MCP_ACCESS_TOKEN)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/oauth/start' && request.method === 'GET') {
      const adminKey = url.searchParams.get('key');
      if (!env.OAUTH_ADMIN_KEY || !timingSafeEqual(adminKey, env.OAUTH_ADMIN_KEY)) {
        return new Response('forbidden: ?key=<OAUTH_ADMIN_KEY> が必要です', { status: 403 });
      }
      const state = crypto.randomUUID();
      await env.MCP_KV.put(`${OAUTH_STATE_PREFIX}${state}`, '1', { expirationTtl: OAUTH_STATE_TTL_SECONDS });
      return Response.redirect(buildAuthUrl(request, env, state), 302);
    }

    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');
      if (error) {
        return new Response(`連携がキャンセルされました: ${error}`, { status: 400 });
      }
      if (!code) {
        return new Response('code がありません', { status: 400 });
      }
      const stateKey = `${OAUTH_STATE_PREFIX}${state || ''}`;
      const stateValid = state && (await env.MCP_KV.get(stateKey));
      if (!stateValid) {
        return new Response('無効なリクエストです（stateの検証に失敗しました）。もう一度 /oauth/start からやり直してください。', {
          status: 400
        });
      }
      await env.MCP_KV.delete(stateKey); // 再利用防止（1回使い切り）
      try {
        const tokens = await exchangeCodeForTokens(request, env, code);
        if (!tokens.refresh_token) {
          return new Response(
            '既に連携済みの可能性があります（refresh_tokenが発行されませんでした）。Googleアカウント設定からこのアプリのアクセスを一度取り消してから、もう一度 /oauth/start を開いてください。',
            { status: 400 }
          );
        }
        const accountOk = await verifyAccountEmail(env, tokens.access_token);
        if (!accountOk) {
          return new Response('許可されていないGoogleアカウントです。連携は保存されませんでした。', { status: 403 });
        }
        await saveRefreshToken(env, tokens.refresh_token);
        return new Response('Gmail連携が完了しました。このタブは閉じて大丈夫です。', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      } catch (e) {
        return new Response(`連携に失敗しました: ${e.message}`, { status: 500 });
      }
    }

    if (url.pathname === '/mcp' && request.method === 'POST') {
      const authError = requireMcpAuth(request, env);
      if (authError) return authError;
      return handleMcpRequest(request, env);
    }

    // Streamable HTTP transportはSSE(GET)未対応。仕様上は405が正
    // （404だと「MCPサーバーとして存在しない」と誤判定するクライアントがある）。
    if (url.pathname === '/mcp') {
      return new Response('method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('henshin-hisho-mcp: OK', { headers: { 'Content-Type': 'text/plain' } });
    }

    return new Response('not found', { status: 404 });
  }
};
