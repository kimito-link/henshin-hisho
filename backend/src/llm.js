import { resolveModel } from './cost-guard.js';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
// 原価ガード(cost-guard.js)の見積りは文字数で行う。見積りより長いプロンプトを黙って送らないよう、
// ここでも上限を持つ（切り詰めると末尾の【依頼】が消えるので、切らずに断る）。
export const MAX_PROMPT_CHARS = 30000;
const DEFAULT_TIMEOUT_MS = 25000;

function normalizeString(value) {
  return String(value || '').trim();
}

function timeoutMs(env) {
  const n = Number(env.LLM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

// cost-guard: guarded — 呼び出し元が costGuard()（src/cost-guard.js）で予約し、その reservation を
// options.reservation に渡したときだけ呼ぶ。渡されなければ fetch せずに断る。
export async function callOpenRouter(env, {
  userPrompt,
  mode = 'app',
  modelOverride = '',
  maxTokensOverride = 800,
  temperatureOverride = 0.4
} = {}, options = {}) {
  if (!options.reservation?.budgetKey) throw new Error('cost_guard_required');
  const apiKey = normalizeString(env.OPENROUTER_API_KEY);
  if (!apiKey) throw new Error('llm_not_configured');
  const prompt = String(userPrompt || '');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error('prompt_too_long');
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://henshin-hisho.link',
      'X-Title': `AI返信秘書 ${mode}`
    },
    body: JSON.stringify({
      model: resolveModel(env, modelOverride),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokensOverride,
      temperature: temperatureOverride
    }),
    // 応答が返らないまま Worker が待ち続けないよう、時間で打ち切る。
    signal: AbortSignal.timeout(timeoutMs(env))
  });
  if (!response.ok) throw new Error(`llm_status_${response.status}`);
  const body = await response.json();
  return String(body?.choices?.[0]?.message?.content || '');
}
