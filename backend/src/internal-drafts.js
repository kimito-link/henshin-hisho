import { accountPolicyForUser } from './account-policy.js';
import { costGuard, estimateCallMilli, resolveModel } from './cost-guard.js';
import { buildDraftPrompt, DRAFT_MAX_TOKENS, generateDraftBody } from './draft-gen.js';
import { jsonResponse, readJson } from './http.js';
import { callOpenRouter } from './llm.js';
import { getUser } from './kv.js';

const TONES = new Set(['polite', 'firm', 'calm', 'casual']);

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ''));
  const right = new TextEncoder().encode(String(b || ''));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** ChatGPT 側の回数を通過した候補本文だけを、costGuard 越しに作る。 */
export async function handleInternalReplyDrafts(request, env, options = {}) {
  if (!env.INTERNAL_DRAFT_TOKEN || !timingSafeEqual(bearer(request), env.INTERNAL_DRAFT_TOKEN)) {
    return jsonResponse(request, env, { ok: false, reason: 'unauthorized' }, 401);
  }
  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  const user = await getUser(env, String(payload.userId || ''));
  if (!user) return jsonResponse(request, env, { ok: false, reason: 'user_not_found' }, 404);

  const tones = (Array.isArray(payload.tones) ? payload.tones : ['polite', 'calm', 'firm'])
    .filter((tone) => TONES.has(tone))
    .slice(0, 3);
  if (tones.length === 0) return jsonResponse(request, env, { ok: false, reason: 'invalid_tone' }, 400);

  const accountPolicy = accountPolicyForUser(user);
  const candidates = [];
  for (const tone of tones) {
    const item = {
      channel: 'email',
      subject: payload.subject,
      body: payload.body,
      from: { name: payload.sender || '', email: payload.sender || '' },
      riskLevel: payload.riskLevel || 'low',
      triage: {
        riskLevel: payload.riskLevel || 'low',
        requiresHumanApproval: payload.riskLevel === 'high',
        summary: ''
      },
      secretaryNote: { tone, intent: payload.intent || '' }
    };
    const guard = await costGuard(env, user, {
      estimateMilli: estimateCallMilli({
        model: resolveModel(env),
        promptChars: buildDraftPrompt(item, { accountPolicy }).length,
        maxTokens: DRAFT_MAX_TOKENS
      })
    });
    if (!guard.ok) {
      return jsonResponse(
        request,
        env,
        { ok: false, reason: guard.body.reason, candidates },
        guard.status
      );
    }
    try {
      const text = await generateDraftBody(item, {
        callLLM: (args) => callOpenRouter(env, args, { ...options, reservation: guard.reservation }),
        accountPolicy
      });
      candidates.push({ tone, text });
    } catch (error) {
      const reason = error?.message === 'llm_not_configured' ? 'llm_not_configured' : 'draft_failed';
      return jsonResponse(request, env, { ok: false, reason, candidates }, reason === 'llm_not_configured' ? 503 : 502);
    }
  }
  return jsonResponse(request, env, { ok: true, candidates });
}
