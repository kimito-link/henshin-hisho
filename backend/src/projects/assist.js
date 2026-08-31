/**
 * assist.js — 発言照合・状況把握・返信案生成のプロンプト構築とLLM呼び出し。
 *
 * 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md E節。
 * ★llm.js の callOpenRouter は system role非対応（user role単発のみ）のため、
 *   システム指示・few-shot・コンテキストを1本のuserPrompt文字列に畳む（llm.jsは改造しない）。
 * ★顧客向け返信案の「引用可能な事実」は必ず audience:'customer_facing' の結果だけから組み立てる。
 *   公開ログと内部ログをプロンプト内でも別セクションに分け、内部情報が顧客向け返信に
 *   混入していないかをAI自身にも意識させる（ただしこれは保険であり、visibility.js/db.jsの
 *   二段階防御が主防御であることに変わりはない）。
 */

import { callOpenRouter } from '../llm.js';
import { maskSecrets } from './masker.js';

const SENDER_ROLE_LABEL_JA = {
  internal: '運営者',
  engineer: 'エンジニア',
  customer: '顧客',
  unknown: '不明'
};

const SYSTEM_INSTRUCTION = `あなたは受託開発の運営者を支える「案件照合秘書」です。以下の会話ログを読み、依頼された作業を行ってください。

【絶対に守るルール】
1. 金額・納期・作業範囲を自分で確定しない。確定していない事項は「未確定」と明記する。
2. 事実と推測を必ず分ける。ログに書かれていることだけが【事実】。相手の意図の解釈は
   【推測】とし、「〜という受け取り方をしているように見えます」の形で書く。断定しない。
3. 作業範囲の変更・追加がログに現れたら、必ず「金額の前提を再確認すべき」と指摘する。
4. 顧客と内部（運営者・エンジニア）の認識に食い違いの可能性があるときは、
   顧客への提示文より先に「内部で認識を確認する」行動を提案する。
5. 【内部ログ】セクションの内容（原価・内部相談・***でマスクされた情報）は、
   顧客向け返信案の本文に一切含めない。引用してよいのは【公開ログ】の内容だけ。
6. *** はマスク済みの秘匿情報である。復元・推測をしない。

【出力形式】
■ 状況の整理
【事実】（ログの引用。発言者・日付つき）
【推測】（推測である旨を明記した解釈）
■ 食い違い・確認すべき点（金額・範囲・納期。なければ「なし」と書く）
■ 次の一手の提案（内部確認が先か、顧客返信が先かを明示）
■ 顧客向け返信案（依頼が返信案作成のときのみ。公開ログの情報だけで構成）`;

const FEW_SHOT = `【例1: 金額の食い違い】
公開ログ: [ココナラ|顧客] 「予算15万円くらいでお願いしたいです」
内部ログ: [Chatwork|エンジニア] 「この内容だと原価で18万はかかります」
良い出力:
■ 食い違い・確認すべき点
【事実】顧客は「予算15万円くらい」と発言（ココナラ）。エンジニアは「原価で18万」と発言（Chatwork）。
【推測】このままでは3万円以上の逆ざやになるように見えます。ただし作業範囲の解釈が
双方で異なる可能性があります。
■ 次の一手の提案
顧客へ金額を提示する前に、エンジニアと作業範囲の内訳を確認することを勧めます。
（顧客向け返信案には18万円という原価情報を含めていない点に注意）

【例2: 作業範囲の変化】
公開ログ: [ココナラ|顧客] 「やっぱりデザインは5ページでなく8ページにしたいです」
良い出力:
■ 食い違い・確認すべき点
【事実】顧客がページ数を5→8に変更したいと発言。
【推測】顧客は現在の見積もり金額のまま8ページになると受け取っているように見えます。
■ 次の一手の提案
ページ数変更は作業範囲の変更です。金額の前提を再確認し、追加費用の要否を
内部で確認してから顧客に回答することを勧めます。`;

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function formatLog(messages) {
  if (!messages.length) return '（該当する発言はありません）';
  return messages
    .map((m) => `[${formatDate(m.sent_at)}][${m.channel_source}|${SENDER_ROLE_LABEL_JA[m.sender_role] || m.sender_role}] ${m.sender_display_name || '（不明）'}: ${m.body}`)
    .join('\n');
}

const MODE_INSTRUCTION = {
  status: 'この案件の現状を出力形式に従って整理してください。',
  reconcile: '公開ログと内部ログを照合し、金額・範囲・納期の食い違いを出力形式に従って報告してください。',
  draft_reply: '' // intentと組み合わせて動的に生成（buildAssistPrompt内）
};

/**
 * @param {{ project: object, channels: object[], publicMessages: object[], internalMessages: object[], mode: 'status'|'reconcile'|'draft_reply', intent?: string }} params
 * @returns {string} callOpenRouterへ渡す1本のuserPrompt
 */
export function buildAssistPrompt({ project, channels, publicMessages, internalMessages, mode, intent }) {
  const channelSummary = channels
    .map((c) => `- ${c.label || c.source}（${c.source}, ${c.counterpart_role}）: ${c.description_masked || '（概要なし）'}`)
    .join('\n');

  const instruction =
    mode === 'draft_reply'
      ? `次の意図で顧客向け返信案を作成してください。意図: ${intent || '（指定なし。状況に応じた自然な返信）'}。返信案は公開ログの情報だけで構成してください。`
      : MODE_INSTRUCTION[mode] || MODE_INSTRUCTION.status;

  return `${SYSTEM_INSTRUCTION}

${FEW_SHOT}

【案件カルテ】
案件名: ${project.name}
カルテ: ${project.summary || '（未記入）'}
チャネル概要:
${channelSummary || '（チャネル未登録）'}

【公開ログ】（顧客も見ている会話。返信案で引用してよいのはここだけ）
${formatLog(publicMessages)}

【内部ログ】（顧客には見せない。照合の材料にのみ使う）
${formatLog(internalMessages)}

【依頼】
${instruction}`;
}

/**
 * @param {object} env
 * @param {{ project: object, channels: object[], allMessages: object[], mode: string, intent?: string }} params
 * @returns {Promise<{ text: string, masked: boolean }>}
 */
export async function runAssist(env, { project, channels, allMessages, mode, intent }) {
  const publicMessages = allMessages.filter((m) => m.visibility === 'public');
  const internalMessages = allMessages.filter((m) => m.visibility !== 'public');
  const userPrompt = buildAssistPrompt({ project, channels, publicMessages, internalMessages, mode, intent });
  const rawText = await callOpenRouter(env, {
    userPrompt,
    mode: 'project-assist',
    maxTokensOverride: 1500,
    temperatureOverride: 0.3
  });
  // 保険としての最終サニタイズ。主防御はvisibility設計であることに変わりはない。
  const { text, masked } = maskSecrets(rawText);
  return { text, masked };
}
