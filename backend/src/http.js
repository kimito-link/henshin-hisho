// CORS と JSON レスポンスの共通ヘルパ。**許可オリジンの正はこのファイル1箇所**。
//
// 経緯: 以前 inbox.js に「単一オリジン完全一致」の旧 jsonResponse コピーが残っており、
// APP_ALLOWED_ORIGIN をカンマ区切りリストにした途端 /inbox 系だけ ACAO が消える事故が
// 起きた(Web も iOS も受信箱が読めなくなる)。レスポンスを作る側は必ずここを import する。
//
// 許可オリジン。Web に加えて、Capacitor ネイティブアプリの WebView オリジンを許可する。
// iOS: **`capacitor://localhost`**。Capacitor の WebView URLスキームは server.iosScheme(既定 "capacitor")。
//   ⚠️ capacitor.config.json の `ios.scheme` は「Xcodeビルドスキーム名」でありURLスキームではない
//   (これを URLスキームと誤読し henshinhisho://localhost だけ許可 → 4回目の 2.1 却下を生んだ)。
// Android: androidScheme 未指定 = Capacitor 既定 https → Origin は https://localhost
// これを許可しないと、サーバーが 200 を返しても WebView が CORS でレスポンスを破棄し、
// アプリ内のログインが必ず失敗する(App Store 2.1「サインインできない」却下の真因)。
// APP_ALLOWED_ORIGIN(カンマ区切り)で上書き可能。'*' は全許可。
const DEFAULT_ALLOWED_ORIGINS = [
  'https://henshin-hisho.link',
  'capacitor://localhost', // iOS (Capacitor server.iosScheme 既定)
  'henshinhisho://localhost', // iOS (将来 server.iosScheme を変更した場合に備えて残す)
  'https://localhost', // Android (Capacitor default scheme)
];

export function allowedOrigins(env) {
  const raw = String(env.APP_ALLOWED_ORIGIN || '').trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowList = allowedOrigins(env);
  const headers = { Vary: 'Origin' };
  const wildcard = allowList.includes('*');
  if (origin && (wildcard || allowList.includes(origin))) {
    // ACAO には「マッチした実オリジン」を返す(リストは返せない)。
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }
  return headers;
}

export function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env)
    }
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
