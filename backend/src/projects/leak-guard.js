/**
 * leak-guard.js — LLMが生成した「顧客向け返信案」セクションに、内部ログにしか
 * 出現しない金額情報が混入していないかを機械的に検証する。
 *
 * ★実演で確認した実損（2026-08-31）: assist.jsのプロンプトは「内部ログの内容を
 *   顧客向け返信案に含めない」と明示しているが、これは指示であって強制ではなく、
 *   実際にエンジニアの内部見積もり金額（原価）がそのまま顧客向け返信案に混入した。
 *   visibility.js/db.jsの二段階防御は「どのメッセージをプロンプトに渡すか」を守るが、
 *   「プロンプトに渡した内部情報をLLMが出力に漏らさないか」までは守れない。
 *   このモジュールは出力側の第3の防御層として、混入を検出したら顧客向け返信案
 *   セクションを安全側（非表示）に倒す。
 */

/**
 * 本文中の金額表現を抽出する。「4万円」「40,000円」「¥40,000」「4万」等の表記ゆれに対応。
 * @param {string} text
 * @returns {string[]} 正規化済み金額表現（数値の文字列）の配列
 */
function extractAmounts(text) {
  const amounts = [];
  const src = String(text || '');

  // 全角数字を半角に正規化してから検出する
  const normalized = src.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

  // 1) "40,000円" "40000円" "¥40,000"
  for (const m of normalized.matchAll(/[¥￥]?\s?(\d{1,3}(?:,\d{3})+|\d{4,})\s?円/g)) {
    amounts.push(m[1].replace(/,/g, ''));
  }
  // 2) "4万円" "4万" "4.5万円"
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?)\s?万\s?円?/g)) {
    amounts.push(String(Math.round(Number(m[1]) * 10000)));
  }
  return amounts;
}

/**
 * LLM出力全文から「■ 顧客向け返信案」セクションだけを取り出す。
 * @param {string} fullText
 * @returns {{ before: string, section: string } | null} セクションが無ければnull
 */
function extractCustomerReplySection(fullText) {
  const src = String(fullText || '');
  const marker = '■ 顧客向け返信案';
  const idx = src.indexOf(marker);
  if (idx === -1) return null;
  return { before: src.slice(0, idx), section: src.slice(idx) };
}

/**
 * 「顧客向け返信案」セクションに、内部ログにのみ現れる金額が混入していないか検証する。
 * 混入があれば、そのセクションを警告文に差し替えた全文を返す。
 *
 * @param {string} fullText LLM出力全文
 * @param {object[]} publicMessages visibility='public'のメッセージ配列（body必須）
 * @param {object[]} internalMessages visibility!=='public'のメッセージ配列（body必須）
 * @returns {{ text: string, leakBlocked: boolean, blockedAmounts: string[] }}
 */
export function guardCustomerReplySection(fullText, publicMessages, internalMessages) {
  const extracted = extractCustomerReplySection(fullText);
  if (!extracted) {
    // 返信案セクションが無いモード(status/reconcile)ではチェック不要。
    return { text: fullText, leakBlocked: false, blockedAmounts: [] };
  }

  const publicAmounts = new Set((publicMessages || []).flatMap((m) => extractAmounts(m.body)));
  const internalOnlyAmounts = new Set(
    (internalMessages || [])
      .flatMap((m) => extractAmounts(m.body))
      .filter((a) => !publicAmounts.has(a))
  );

  if (internalOnlyAmounts.size === 0) {
    return { text: fullText, leakBlocked: false, blockedAmounts: [] };
  }

  const sectionAmounts = new Set(extractAmounts(extracted.section));
  const blockedAmounts = [...internalOnlyAmounts].filter((a) => sectionAmounts.has(a));

  if (blockedAmounts.length === 0) {
    return { text: fullText, leakBlocked: false, blockedAmounts: [] };
  }

  const safeSection =
    '■ 顧客向け返信案\n' +
    '（生成された返信案に、内部ログにのみ存在する金額情報が含まれていたため、安全のため非表示にしました。' +
    'お手数ですが、この案件の状況整理を確認のうえ、金額は自分の言葉で顧客へお伝えください。）';

  return {
    text: extracted.before + safeSection,
    leakBlocked: true,
    blockedAmounts
  };
}
