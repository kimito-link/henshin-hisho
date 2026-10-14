/**
 * digest.js — Gmail通知メールから inbox_digest 用のサマリーを組み立てる。
 *
 * 【原則】(2026-09-03 設計合意)
 *  - 金額・期限・need_reply は本文から明確に読み取れたときだけ埋める。推測で埋めない。
 *  - 対応が必要(priority) / 情報のみ(info) / 取得失敗(skipped) の3分類のみ。
 *  - このモジュールは読むだけ。返信・既読化はしない。
 */
import { searchMessages, getMessageSummary } from './gmail.js';

/**
 * サービスごとの検索クエリ。件名・本文のパースはせず、Gmail検索構文で絞り込むだけ
 * （「本文まで正確に読む」のはPhase 2、まずはメール一覧の存在検知から）。
 */
const SERVICE_QUERIES = [
  {
    source: 'coconala',
    label: 'ココナラ',
    query: 'from:(coconala.com OR mail.coconala.com) newer_than:2d'
  },
  {
    source: 'lancers',
    label: 'ランサーズ',
    query: 'from:(lancers.jp OR lancers.co.jp) newer_than:2d'
  },
  {
    source: 'chatwork',
    label: 'Chatwork',
    query: 'from:(chatwork.com) newer_than:2d'
  }
];

/**
 * 「返信・対応が要る」ことを示唆する語（本文/件名からの検出、日本語の通知メールに限定）。
 * ★「依頼」「受注」「新しいメッセージ」は通知メール全般にヒットしすぎる誤検出源だったため除外
 * （2026-09-06 Fableレビューで指摘）。返信・締切系の、より確度の高い語に絞る。
 */
const NEED_REPLY_PATTERNS = /(返信|お待ちして|ご確認ください|ご対応|至急|期限|締切|催促)/;
// 金額表記(¥1,000 / 1000円 等)。「0円」「,円」のような空値は誤検出になるため桁数を要求する。
const AMOUNT_PATTERN = /([¥￥]\s?[1-9][\d,]*|[1-9][\d,]*\s?円)/;
/**
 * 日付表記。★「今日」「明日」「今週中」は販促メール（「今日のおすすめ」等）にも頻出し
 * 誤検出源だったため除外（2026-09-06 Fableレビューで指摘）。「読めなければ埋めない」原則を
 * 優先し、曖昧さのない絶対日付表記のみを対象にする。
 */
const DEADLINE_PATTERN = /(\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2})/;

function detectAmount(text) {
  const m = String(text || '').match(AMOUNT_PATTERN);
  return m ? m[0] : null;
}

function detectDeadline(text) {
  const m = String(text || '').match(DEADLINE_PATTERN);
  return m ? m[0] : null;
}

function detectNeedReply(text) {
  return NEED_REPLY_PATTERNS.test(String(text || ''));
}

/**
 * @param {object} env
 * @param {{ sinceHours?: number }} opts
 * @returns {{ priority: object[], info: object[], skipped: string[], checkedAt: string }}
 */
export async function buildInboxDigest(accessToken, opts = {}) {
  const sinceHours = Number(opts.sinceHours) || 24;
  const priority = [];
  const info = [];
  const skipped = [];

  for (const service of SERVICE_QUERIES) {
    let messageRefs;
    try {
      // newer_than はGmail検索構文上「日」単位が最小のため、時間指定は取得後にフィルタする。
      messageRefs = await searchMessages(accessToken, service.query, 10);
    } catch (e) {
      skipped.push(`${service.source}: search_failed (${e.message.slice(0, 120)})`);
      continue;
    }

    if (!messageRefs.length) continue; // 未読(該当)なしの入り口は開かない

    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
    for (const ref of messageRefs) {
      let summary;
      try {
        summary = await getMessageSummary(accessToken, ref.id);
      } catch (e) {
        skipped.push(`${service.source}:${ref.id} fetch_failed (${e.message.slice(0, 120)})`);
        continue;
      }
      if (summary.internalDate && summary.internalDate < cutoff) continue;

      const text = `${summary.subject} ${summary.body}`;
      const item = {
        source: service.source,
        from: summary.from,
        subject: summary.subject,
        snippet: summary.snippet,
        amount: detectAmount(text),
        deadline: detectDeadline(text),
        need_reply: detectNeedReply(text)
      };
      if (item.need_reply || item.amount || item.deadline) {
        priority.push(item);
      } else {
        info.push(item);
      }
    }
  }

  return {
    priority,
    info,
    skipped,
    checked_at: new Date().toISOString()
  };
}
