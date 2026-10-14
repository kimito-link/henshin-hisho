/**
 * mcp.js — MCP (Model Context Protocol) の最小実装。Streamable HTTP、単一ツール(inbox_digest)のみ。
 *
 * 外部SDKに依存しない理由: henshin-hisho backend と同じ「依存ゼロ」方針を踏襲する。
 * ツールが1個だけの現段階では、JSON-RPC 2.0 のディスパッチを自前で書く方が
 * 依存追跡・デプロイサイズの両面でシンプル。ツールが増えたら @modelcontextprotocol/sdk 採用を再検討する。
 *
 * 仕様: https://modelcontextprotocol.io/ の Streamable HTTP transport。
 * 対応メソッド: initialize / tools/list / tools/call のみ（今回の用途に必要な最小集合）。
 */
import { buildInboxDigest } from './digest.js';
import { getAccessToken } from './oauth.js';

// フォールバックのみ。initializeでは基本的にクライアントが送ってきたバージョンを
// そのまま返す（MCP仕様上、サーバーが対応可能ならクライアント指定に合わせるのが正）。
const FALLBACK_PROTOCOL_VERSION = '2026-06-18';

const TOOLS = [
  {
    name: 'inbox_digest',
    description:
      '未読・新着の連絡（Chatwork/ココナラ/ランサーズの通知メール）をまとめて取得する。読み取り専用。返信・送信は一切しない。金額・期限・対応要否が本文から読み取れない場合はnullを返す（推測しない）。',
    inputSchema: {
      type: 'object',
      properties: {
        since_hours: {
          type: 'number',
          description: '何時間前までの連絡を対象にするか（既定24）',
          default: 24
        }
      }
    }
  }
];

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function callTool(env, name, args) {
  if (name !== 'inbox_digest') {
    throw Object.assign(new Error(`unknown tool: ${name}`), { rpcCode: -32602 });
  }
  let accessToken;
  try {
    accessToken = await getAccessToken(env);
  } catch (e) {
    if (e.code === 'not_connected') {
      return {
        content: [
          {
            type: 'text',
            text: 'Gmail連携が未設定です。管理者に /oauth/start を開いて連携してもらってください。'
          }
        ],
        isError: true
      };
    }
    throw e;
  }
  const digest = await buildInboxDigest(accessToken, { sinceHours: args?.since_hours });
  return {
    content: [{ type: 'text', text: JSON.stringify(digest) }]
  };
}

export async function handleMcpRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(jsonRpcError(null, -32700, 'parse error')), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { id, method, params } = body || {};

  if (method === 'initialize') {
    return Response.json(
      jsonRpcResult(id, {
        protocolVersion: params?.protocolVersion || FALLBACK_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'henshin-hisho-mcp', version: '0.1.0' }
      })
    );
  }

  if (method === 'tools/list') {
    return Response.json(jsonRpcResult(id, { tools: TOOLS }));
  }

  if (method === 'tools/call') {
    try {
      const result = await callTool(env, params?.name, params?.arguments);
      return Response.json(jsonRpcResult(id, result));
    } catch (e) {
      return Response.json(jsonRpcError(id, e.rpcCode || -32000, e.message));
    }
  }

  if (method === 'notifications/initialized') {
    // 通知系(idなし)。応答不要だが空200を返す。
    return new Response(null, { status: 202 });
  }

  return Response.json(jsonRpcError(id, -32601, `method not found: ${method}`));
}
