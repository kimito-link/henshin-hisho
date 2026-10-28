/**
 * スマホ新法の外部購入リンク。このビルドではオフ。
 * オンにするときは、App Store Connect で許可された日本向けリンクだけを返す。
 * アプリ内に外部決済のアドレスは置かない。
 */
export const EXTERNAL_PURCHASE_LINK_ENABLED = false;

export function externalPurchaseHref() {
  if (EXTERNAL_PURCHASE_LINK_ENABLED !== true) return '';
  return 'https://henshin-hisho.link/app/#/plan';
}
