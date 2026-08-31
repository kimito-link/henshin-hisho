import { normalizeText } from './schema.js';

const DRAFT_TONE_INSTRUCTIONS = Object.freeze({
  polite: '丁寧に',
  firm: 'はっきり強めに、ただし攻撃的にしない',
  calm: '冷静に感情を抑えて',
  casual: 'いつもの砕けた調子で'
});

export function pickTone(value) {
  return Object.prototype.hasOwnProperty.call(DRAFT_TONE_INSTRUCTIONS, value) ? value : 'polite';
}

const BUNDLE_POLICY_LABEL = {
  encourage: 'まとめ売りを積極的に提案してよい',
  case_by_case: 'まとめ売りは状況に応じて提案する'
};

const INDUSTRY_TEMPLATE_LABEL = {
  seisaku: '制作・受託業として、納期や仕様範囲にも触れてよい',
  butsuhan: '物販・卸業として、数量や在庫状況にも触れてよい',
  service: 'サービス業として、提供内容の範囲にも触れてよい'
};

function formatSender(item = {}) {
  return normalizeText(item.from?.name || item.from?.email || item.from?.externalUserId || '', 240) || '不明';
}

export function normalizeSecretaryNote(note = {}, options = {}) {
  const tone = pickTone(note?.tone || options.tone || 'polite');
  return {
    tone,
    intent: normalizeText(note?.intent || options.intent || '', 500),
    extraContext: normalizeText(note?.extraContext || options.extraContext || '', 1000),
    updatedAt: options.now ?? Date.now()
  };
}

export function buildDraftPrompt(item = {}, options = {}) {
  const note = normalizeSecretaryNote(item.secretaryNote, options);
  const subject = normalizeText(item.subject, 500) || '(件名なし)';
  const from = formatSender(item);
  const summary = normalizeText(item.triage?.summary, 800);
  const body = normalizeText(item.body || item.excerpt).slice(0, 3000);
  const intent = note.intent || normalizeText(item.triage?.draftIntent, 500) || '内容を確認して返信する';
  const riskLevel = normalizeText(item.riskLevel || item.triage?.riskLevel || 'unknown', 40);
  const requiresHoldingTone = riskLevel === 'high' || item.triage?.requiresHumanApproval === true;

  const lines = [
    '以下のメッセージに対する返信下書きを1通だけ作成してください。',
    '出力は本文のみです。JSON、Markdown、見出し、箇条書き、複数案は禁止です。',
    '送信は人間が行います。自動送信の文言や処理は含めないでください。',
    '',
    `チャネル: ${normalizeText(item.channel, 40)}`,
    `件名: ${subject}`,
    `差出人: ${from}`,
    `riskLevel: ${riskLevel}`,
    '',
    '返信意図:',
    intent,
    '',
    `トーン: ${DRAFT_TONE_INSTRUCTIONS[note.tone]}`
  ];

  if (options.accountPolicy) {
    const p = options.accountPolicy;
    const policyLines = [];
    if (p.industryTemplate && INDUSTRY_TEMPLATE_LABEL[p.industryTemplate]) {
      policyLines.push(`- ${INDUSTRY_TEMPLATE_LABEL[p.industryTemplate]}。`);
    }
    if (p.discountCeilingPercent != null) {
      policyLines.push(`- 値引きは最大${p.discountCeilingPercent}%まで。これを超える条件は提示せず、承認が必要な旨を添える。`);
    }
    if (p.minOrderValueYen != null) {
      policyLines.push(`- 最低受注額は${p.minOrderValueYen}円。`);
    }
    if (p.bundlePolicy !== 'none') {
      policyLines.push(`- まとめ売り方針: ${BUNDLE_POLICY_LABEL[p.bundlePolicy]}`);
    }
    if (p.freeformNote) {
      policyLines.push(`- 補足方針: ${p.freeformNote}`);
    }
    if (policyLines.length > 0) {
      lines.push('', '【会社の方針(数値の制約は必ず守ること。言い回しは上記トーン指定を優先)】', ...policyLines);
    }
  }

  if (note.extraContext) lines.push('', '追加事情:', note.extraContext);
  if (summary) lines.push('', '元メッセージ要約:', summary);
  else lines.push('', '元メッセージ本文抜粋:', body || '(本文なし)');
  if (summary && body) lines.push('', '本文抜粋:', body);

  if (requiresHoldingTone) {
    lines.push(
      '',
      '重要: このメッセージは高リスクまたは人間確認が必要です。断定・約束・法的な決めつけを避け、事実整理と「確認のうえ改めてご連絡いたします」などの保留表現にしてください。'
    );
  }

  return lines.join('\n');
}

export async function generateDraftBody(item = {}, options = {}) {
  const callLLM = options.callLLM;
  if (typeof callLLM !== 'function') throw new Error('call_llm_required');
  const content = await callLLM({
    userPrompt: buildDraftPrompt(item, options),
    mode: 'app_draft',
    maxTokensOverride: 800,
    temperatureOverride: 0.4
  });
  return normalizeText(content);
}
