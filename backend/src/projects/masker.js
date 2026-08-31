/**
 * masker.js — 外部から取り込むメッセージ本文・概要欄に紛れた秘密情報を、
 * 保存する前に伏せる。
 *
 * 実演で確認した実例: Chatworkの概要欄に「パスコード: xxxx」「ID: xxxx」の形で
 * 管理画面の認証情報が直書きされていた。原文はD1に保存しない設計にしているため、
 * この関数を通した後の文字列だけが永続化される（visibility.mdの二段階防御とは別レイヤーの
 * 「取り込み時マスキング」であり、両方が揃って初めて安全になる）。
 */

/**
 * 秘密が入りやすいラベル密着型パターン（キー: 値）。日本語ラベル・全角コロンに対応。
 */
const LABELED_PATTERN =
  /((?:パスワード|パスコード|認証コード|pass(?:word|code)?|pw|pin|secret|token|api[-_ ]?key|ID|ｉｄ|ユーザー名|user(?:name)?)\s*[:：=＝]\s*)(\S+)/gi;

/**
 * ラベルに頼らない値そのもの検出: 32文字以上の英数記号連続（APIキー・ハッシュ等）。
 * URLの一部を誤って伏せないよう、直前がURLらしき文字列のときは対象外にする。
 */
const RAW_SECRET_PATTERN = /(?<!https?:\/\/[^\s]*)\b[A-Za-z0-9_-]{32,}\b/g;

/**
 * @param {string} text
 * @returns {{ text: string, masked: boolean }}
 */
export function maskSecrets(text) {
  let masked = false;
  let out = String(text || '');
  out = out.replace(LABELED_PATTERN, (_, label) => {
    masked = true;
    return `${label}***`;
  });
  out = out.replace(RAW_SECRET_PATTERN, () => {
    masked = true;
    return '***';
  });
  return { text: out, masked };
}
