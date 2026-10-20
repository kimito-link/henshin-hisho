/**
 * cost-guard.js — LLM（OpenRouter）を呼ぶ前の原価ガード。
 *
 * 正本: ai-generic-rules/docs/policies/COST_SAFETY_POLICY.md（§3 守りの6層）。
 * 見本: kimitolink-linktree/lib/server/ouen/budget.ts reserveMilli（先に積んでから判定・超えたら戻す）。
 * 数字の根拠と「黒字の式」: backend/docs/COST-GUARD.md。
 *
 * 呼ぶ前に、上から順に全部通ったときだけ LLM を呼んでよい:
 *   L1 キルスイッチ   PAID_CALLS_DISABLED=1 → 全停止
 *   プラン           expired → 止める（無料登録の期限切れで無制限に使えた穴）
 *   L4 利用者の上限   trial = 試用期間あたり TRIAL_AI_CALLS 回 / active = 月あたり ACTIVE_MONTHLY_AI_CALLS 回
 *   L2 全体の日次予算 見積り額を予約。★プールを分ける（試用が使い切っても有料の人は止めない）:
 *                     trial = LLM_DAILY_BUDGET_MILLI / active = LLM_PAID_DAILY_BUDGET_MILLI（ミリドル）
 *
 * ★カウンタは D1（PROJECT_DB）の1文 UPSERT … RETURNING で原子的に積む。
 *   KV は読んでから書くので、同時に来た2件が両方通る（原子的でない）。
 * ★fail-closed: D1 が無い・SQL が失敗した・env の上限が数値として読めない → 呼ばない。
 *   既定値に黙って落とさない（上げたつもりが効いていない事故を防ぐ）。
 * ★呼んだ後に失敗しても予約は戻さない（課金済みかもしれないので、多く数える側に倒す）。
 */

import { accountPlan } from './auth.js';

// --- 既定値（★提案値。最終決定は本人。docs/COST-GUARD.md の表と一致させる） ---
export const DEFAULT_DAILY_BUDGET_MILLI = 1500; // 試用の全員分 $1.5/日
export const DEFAULT_PAID_DAILY_BUDGET_MILLI = 3000; // 有料の全員分 $3/日
export const DEFAULT_TRIAL_AI_CALLS = 60; // 試用14日間で60回
export const DEFAULT_ACTIVE_MONTHLY_AI_CALLS = 1500; // 有料1か月で1500回

// 試用切れ・試用の回数切れの表示に出す価格（★価格を変えたらここと docs/COST-GUARD.md を直す）。
const UPGRADE_HINT = '月額 2,980円（年額 29,800円）で続けられます。';

// --- 見積り（★上限と同じファイルから導く。別ファイルに数字を置かない） ---
// OpenRouter の価格（$/100万トークン、2026-10 時点の目安を安全側に丸めた値）。
// 日本語は1文字≒1トークン以上なので、文字数をそのままトークン数として数える（多めに見積もる側）。
const MODEL_PRICES = {
  'google/gemma-3-12b-it': { input: 0.1, output: 0.2 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 }
};
// ★表に無いモデル（APP_MODEL を高いモデルに変えた等）は最上位クラスの価格で見積もる。
//   こうすると日次予算が早く尽きて止まる（黙って高いモデルが無制限に回らない）。
const UNKNOWN_MODEL_PRICE = { input: 15, output: 75 };

export const DEFAULT_MODEL = 'google/gemma-3-12b-it';

/** llm.js と同じ規則で、実際に使われるモデル名を返す（見積りに使う）。 */
export function resolveModel(env, modelOverride = '') {
  return modelOverride || env.APP_MODEL || env.CHECKER_MODEL || DEFAULT_MODEL;
}

/** 1回の呼び出しの見積り（ミリドル、切り上げ・最低1）。 */
export function estimateCallMilli({ model, promptChars, maxTokens }) {
  const price = MODEL_PRICES[model] || UNKNOWN_MODEL_PRICE;
  const dollars = (Math.max(0, promptChars) * price.input + Math.max(0, maxTokens) * price.output) / 1_000_000;
  return Math.max(1, Math.ceil(dollars * 1000));
}

/** env から非負整数を読む。空なら既定値、読めなければ null（fail-closed の材料）。 */
export function readLimit(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function utcMonth(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 7);
}

function nextUtcDayStartSec(nowMs) {
  const d = new Date(nowMs);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
}

function nextUtcMonthStartSec(nowMs) {
  const d = new Date(nowMs);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000);
}

/** ★1文で積んで、積んだ後の値を返す（原子的）。 */
async function incrementCounter(db, key, amount, expiresAtSec) {
  const row = await db
    .prepare(
      'INSERT INTO cost_counters (key, value, expires_at) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT(key) DO UPDATE SET value = value + ?2 RETURNING value'
    )
    .bind(key, amount, expiresAtSec)
    .first();
  const value = Number(row?.value);
  if (!Number.isFinite(value)) throw new Error('counter_unreadable');
  return value;
}

async function decrementCounter(db, key, amount) {
  try {
    await db.prepare('UPDATE cost_counters SET value = value - ?2 WHERE key = ?1').bind(key, amount).run();
  } catch {
    // 戻せなくても止めるのが正しい（多く数える側に倒す）。
  }
}

/** 積んで、上限を超えていたら戻す。 */
async function reserveCounter(db, key, amount, limit, expiresAtSec) {
  const after = await incrementCounter(db, key, amount, expiresAtSec);
  if (after > limit) {
    await decrementCounter(db, key, amount);
    return { ok: false, used: after - amount, limit };
  }
  return { ok: true, used: after, limit };
}

const UNAVAILABLE_MESSAGE = 'ただいまAI機能を利用できません。時間をおいてお試しください。';

function deny(status, reason, message, extra = {}) {
  return { ok: false, status, body: { ok: false, reason, message, ...extra } };
}

/**
 * LLM を呼ぶ前に必ず通す。通ったときの reservation を callOpenRouter に渡す。
 * @param {object} env
 * @param {object} user requireAuth の user
 * @param {{ estimateMilli: number, nowMs?: number }} params
 * @returns {Promise<{ ok: true, reservation: object } | { ok: false, status: number, body: object }>}
 */
export async function costGuard(env, user, { estimateMilli, nowMs = Date.now() } = {}) {
  // L1 キルスイッチ
  if (String(env.PAID_CALLS_DISABLED || '').trim() === '1') {
    return deny(503, 'ai_paused', 'AI機能を一時停止しています。しばらくしてからお試しください。');
  }

  // プラン
  const account = accountPlan(user, Math.floor(nowMs / 1000));
  if (account.plan === 'expired') {
    return deny(402, 'plan_expired', `無料お試し期間が終了しました。${UPGRADE_HINT}`);
  }

  const db = env.PROJECT_DB;
  const budgetLimit =
    account.plan === 'active'
      ? readLimit(env.LLM_PAID_DAILY_BUDGET_MILLI, DEFAULT_PAID_DAILY_BUDGET_MILLI)
      : readLimit(env.LLM_DAILY_BUDGET_MILLI, DEFAULT_DAILY_BUDGET_MILLI);
  const userLimit =
    account.plan === 'active'
      ? readLimit(env.ACTIVE_MONTHLY_AI_CALLS, DEFAULT_ACTIVE_MONTHLY_AI_CALLS)
      : readLimit(env.TRIAL_AI_CALLS, DEFAULT_TRIAL_AI_CALLS);
  const cost = Math.ceil(Number(estimateMilli));
  // ★fail-closed: 数えられない・上限が読めない → 呼ばない
  if (!db || typeof db.prepare !== 'function' || budgetLimit === null || userLimit === null || !(cost > 0)) {
    return deny(503, 'cost_guard_unavailable', UNAVAILABLE_MESSAGE);
  }

  // L4 利用者の上限（1操作=1回）
  const userKey =
    account.plan === 'active' ? `user:${user.id}:active:${utcMonth(nowMs)}` : `user:${user.id}:trial`;
  const userResetsAt = account.plan === 'active' ? nextUtcMonthStartSec(nowMs) : Number(account.trialEndsAt || 0);
  const budgetKey = `budget:llm:${account.plan === 'active' ? 'paid' : 'trial'}:${utcDay(nowMs)}`;
  const budgetResetsAt = nextUtcDayStartSec(nowMs);

  try {
    const perUser = await reserveCounter(db, userKey, 1, userLimit, userResetsAt + 86400);
    if (!perUser.ok) {
      const message =
        account.plan === 'active'
          ? `今月のAI利用回数の上限（${userLimit}回）に達しました。翌月1日（UTC）に戻ります。`
          : `試用のAI利用回数（${userLimit}回）を使い切りました。${UPGRADE_HINT}`;
      return deny(429, 'user_quota_exhausted', message, { limit: userLimit, used: perUser.used, resetsAt: userResetsAt });
    }

    // L2 全体の日次予算
    const budget = await reserveCounter(db, budgetKey, cost, budgetLimit, budgetResetsAt + 14 * 86400);
    if (!budget.ok) {
      // ★まだ呼んでいないので、利用者の1回は戻す
      await decrementCounter(db, userKey, 1);
      return deny(429, 'daily_budget_exhausted', '本日のAI処理の上限に達しました。明日（UTC 0時）以降にお試しください。', {
        resetsAt: budgetResetsAt
      });
    }
    return { ok: true, reservation: { userKey, budgetKey, milli: cost, plan: account.plan } };
  } catch {
    return deny(503, 'cost_guard_unavailable', UNAVAILABLE_MESSAGE);
  }
}
