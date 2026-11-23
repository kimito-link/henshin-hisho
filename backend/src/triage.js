import { normalizeText } from './schema.js';
import { extractTriageJson } from './shared/ai-triage/json-repair.mjs';

export { extractTriageJson };

export const TRIAGE_CATEGORIES = Object.freeze([
  'reply_needed',
  'schedule',
  'invoice',
  'support',
  'sales',
  'legal',
  'medical',
  'financial',
  'spam_or_promo',
  'fyi',
  'unknown'
]);
export const TRIAGE_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
export const TRIAGE_ACTIONS = Object.freeze([
  'create_draft',
  'ask_user',
  'mark_fyi',
  'snooze',
  'ignore',
  'needs_manual_review'
]);

const HIGH_RISK_CATEGORIES = new Set(['legal', 'medical', 'financial']);
export const RESCUE_MODEL = 'openai/gpt-4o-mini';
export const TRIAGE_MAX_TOKENS = 1100;

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeStringArray(value = [], maxItems = 5, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function keywordRiskOverlay(item, result) {
  const text = `${item.subject || ''}\n${item.body || ''}\n${item.excerpt || ''}`;
  const highRiskPattern = /(返金|契約|法務|訴訟|医療|診断|金融|請求|個人情報|クレーム|損害賠償|合意|約束)/;
  if (!highRiskPattern.test(text)) return result;
  const warnings = [...result.warnings];
  if (!warnings.includes('高リスク語句を検出したため人間確認が必要です')) {
    warnings.unshift('高リスク語句を検出したため人間確認が必要です');
  }
  return {
    ...result,
    riskLevel: 'high',
    requiresHumanApproval: true,
    suggestedAction: 'needs_manual_review',
    warnings
  };
}

export function normalizeTriageResult(value = {}, meta = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const parseStatus = meta.parseStatus || 'ok';
  let category = pickEnum(source.category, TRIAGE_CATEGORIES, 'unknown');
  let riskLevel = pickEnum(source.riskLevel, ['low', 'medium', 'high'], 'medium');
  let suggestedAction = pickEnum(source.suggestedAction, TRIAGE_ACTIONS, 'needs_manual_review');
  const warnings = normalizeStringArray(source.warnings, 5, 160);

  if (parseStatus === 'repaired') warnings.push('AI応答が途中で途切れたため一部項目を補完しました');
  if (HIGH_RISK_CATEGORIES.has(category)) {
    riskLevel = 'high';
    if (!warnings.includes('高リスクカテゴリのため人間確認が必要です')) {
      warnings.unshift('高リスクカテゴリのため人間確認が必要です');
    }
  }
  if (riskLevel === 'high') suggestedAction = 'needs_manual_review';

  return {
    category,
    priority: pickEnum(source.priority, TRIAGE_PRIORITIES, 'normal'),
    riskLevel,
    requiresHumanApproval: source.requiresHumanApproval === true || riskLevel === 'high',
    summary: normalizeText(source.summary, 240),
    detectedTasks: Array.isArray(source.detectedTasks)
      ? source.detectedTasks.slice(0, 5).map((task) => ({
        task: normalizeText(task?.task, 160),
        dueDateText: normalizeText(task?.dueDateText, 80),
        confidence: Math.max(0, Math.min(1, Number(task?.confidence || 0)))
      })).filter((task) => task.task)
      : [],
    suggestedAction,
    draftIntent: normalizeText(source.draftIntent, 240),
    warnings,
    parseStatus
  };
}

export function parseTriageContent(content, item = {}) {
  const { data, status } = extractTriageJson(content);
  return keywordRiskOverlay(item, normalizeTriageResult(data, { parseStatus: status }));
}

export function isRescueNeeded(triage = {}) {
  if (triage.parseStatus === 'failed') return true;
  if (triage.parseStatus === 'repaired' && triage.category === 'unknown') return true;
  return false;
}

export function buildTriagePrompt(item = {}) {
  return [
    '受信したメッセージを分類し、下記スキーマのJSONだけを返してください。前後に説明文・コードフェンス・余分な文字を付けないこと。',
    '送信・自動返信・自動挿入の判断はしないでください。',
    '高リスク(法務・医療・金融・契約・返金・個人情報・強いクレーム)は必ず riskLevel="high" かつ requiresHumanApproval=true にしてください。',
    'チャネルに依存せず、内容だけで判断してください。',
    '',
    '出力スキーマ(すべてのキーを必ず含める):',
    '{',
    `  "category": ${JSON.stringify([...TRIAGE_CATEGORIES])} のいずれか,`,
    `  "priority": ${JSON.stringify([...TRIAGE_PRIORITIES])} のいずれか,`,
    '  "riskLevel": "low" | "medium" | "high",',
    '  "requiresHumanApproval": true または false,',
    '  "summary": "1〜2文の日本語要約",',
    `  "suggestedAction": ${JSON.stringify([...TRIAGE_ACTIONS])} のいずれか,`,
    '  "draftIntent": "返信する場合の意図(不要なら空文字)",',
    '  "warnings": ["注意点があれば最大5件、なければ空配列"]',
    '}',
    '',
    '例: {"category":"support","priority":"normal","riskLevel":"low","requiresHumanApproval":false,"summary":"商品の使い方に関する質問。","suggestedAction":"create_draft","draftIntent":"使い方を案内する","warnings":[]}',
    '',
    `チャネル: ${normalizeText(item.channel, 40)}`,
    `件名: ${normalizeText(item.subject, 500) || '(件名なし)'}`,
    `差出人: ${normalizeText(item.from?.name || item.from?.email || item.from?.externalUserId, 240) || '不明'}`,
    '',
    '本文:',
    normalizeText(item.body || item.excerpt).slice(0, 3000)
  ].join('\n');
}

export async function triageInboxItem(item = {}, options = {}) {
  const callLLM = options.callLLM;
  if (typeof callLLM !== 'function') throw new Error('call_llm_required');
  const prompt = buildTriagePrompt(item);
  const content = await callLLM({
    userPrompt: prompt,
    mode: 'app_triage',
    maxTokensOverride: TRIAGE_MAX_TOKENS,
    temperatureOverride: 0.4
  });
  let triage = parseTriageContent(content, item);

  if (isRescueNeeded(triage)) {
    try {
      const rescueContent = await callLLM({
        userPrompt: prompt,
        mode: 'app_triage',
        maxTokensOverride: TRIAGE_MAX_TOKENS,
        temperatureOverride: 0.4,
        modelOverride: RESCUE_MODEL
      });
      const rescued = parseTriageContent(rescueContent, item);
      if (rescued.parseStatus !== 'failed') triage = rescued;
    } catch {
      // Keep first safe result.
    }
  }
  return triage;
}
