const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemma-3-12b-it';

function normalizeString(value) {
  return String(value || '').trim();
}

export async function callOpenRouter(env, {
  userPrompt,
  mode = 'app',
  modelOverride = '',
  maxTokensOverride = 800,
  temperatureOverride = 0.4
} = {}, options = {}) {
  const apiKey = normalizeString(env.OPENROUTER_API_KEY);
  if (!apiKey) throw new Error('llm_not_configured');
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
      model: modelOverride || env.APP_MODEL || env.CHECKER_MODEL || DEFAULT_MODEL,
      messages: [{ role: 'user', content: String(userPrompt || '') }],
      max_tokens: maxTokensOverride,
      temperature: temperatureOverride
    })
  });
  if (!response.ok) throw new Error(`llm_status_${response.status}`);
  const body = await response.json();
  return String(body?.choices?.[0]?.message?.content || '');
}
