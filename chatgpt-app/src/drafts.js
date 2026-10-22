import { buildCandidates, predictRecipientEmotion } from './reply.js';

function withSource(candidates, source) {
  return candidates.map((candidate) => ({ ...candidate, source }));
}

/** アプリ側の回数を通過したあとだけ backend の下書き API を呼ぶ。失敗時は定型文。 */
export async function generateCandidates(env, assessment, fetchImpl = fetch) {
  const templates = withSource(buildCandidates(assessment), 'template');
  if (!env.BACKEND_URL || !env.INTERNAL_DRAFT_TOKEN || !env.DRAFT_SERVICE_USER_ID) {
    return { candidates: templates, draftSource: 'template', draftReason: 'llm_not_configured' };
  }
  const message = assessment.message;
  try {
    const response = await fetchImpl(`${String(env.BACKEND_URL).replace(/\/$/, '')}/internal/reply-drafts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.INTERNAL_DRAFT_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        userId: env.DRAFT_SERVICE_USER_ID,
        sender: message.sender,
        subject: message.subject,
        body: message.body,
        intent: message.intent,
        riskLevel: assessment.risk.level,
        tones: templates.map((candidate) => candidate.tone)
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
      return {
        candidates: templates,
        draftSource: 'template',
        draftReason: payload?.reason || 'llm_unavailable'
      };
    }
    const merged = templates.map((template, index) => {
      const text = String(payload.candidates[index]?.text || '').trim();
      if (!text) return template;
      const next = {
        ...template,
        text: text.slice(0, 4000),
        source: 'llm',
        holding: assessment.risk.level === 'high' || message.forceHolding === true
      };
      return { ...next, emotion: predictRecipientEmotion(next, assessment.risk) };
    });
    const usedLlm = merged.some((candidate) => candidate.source === 'llm');
    return {
      candidates: merged,
      draftSource: usedLlm ? 'llm' : 'template',
      draftReason: usedLlm ? '' : 'llm_unavailable'
    };
  } catch {
    return { candidates: templates, draftSource: 'template', draftReason: 'llm_failed' };
  }
}
