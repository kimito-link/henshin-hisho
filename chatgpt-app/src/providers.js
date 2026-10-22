/**
 * 接続済みの送受信経路。
 * linebot（kimito-link/linebot）はこの環境から読めなかったため、
 * オーナーが確定した経路だけを載せる。読んでいない経路の設定名は作らない。
 *
 * 送信: Gmail API。スコープは gmail.send + openid + userinfo.email だけ。
 * 受信: 貼り付け、および Cloudflare Email Routing への転送を取り込む口。
 */

export const WIRED_PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'gmail',
    label: 'Gmail',
    inbound: false,
    outbound: true,
    scopes: Object.freeze([
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.send'
    ])
  }),
  Object.freeze({
    id: 'email_routing',
    label: 'Cloudflare Email Routing',
    inbound: true,
    outbound: false,
    scopes: Object.freeze([])
  })
]);

export function providerById(id) {
  return WIRED_PROVIDERS.find((provider) => provider.id === id) || null;
}

export function outboundProviders() {
  return WIRED_PROVIDERS.filter((provider) => provider.outbound);
}

export function inboundProviders() {
  return WIRED_PROVIDERS.filter((provider) => provider.inbound);
}
