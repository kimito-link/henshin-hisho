import { nowSeconds } from './crypto.js';
import { currentHourInTimezone, digestSettingsForUser, listInboxItemsForUser, listUserIds } from './digest.js';
import { getJson, putUser } from './kv.js';
import { sendMail } from './mailer.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function weeklyReportSettingsForUser(user = {}) {
  const source = user.weeklyReport && typeof user.weeklyReport === 'object' ? user.weeklyReport : {};
  return { enabled: source.enabled !== false };
}

export async function updateReportSettings(env, user, patch = {}) {
  const avgCaseValue = Number(patch.avgCaseValue);
  const updated = {
    ...user,
    weeklyReport: {
      ...weeklyReportSettingsForUser(user),
      enabled: patch.enabled !== false
    },
    avgCaseValue: Number.isFinite(avgCaseValue) && avgCaseValue > 0 ? Math.floor(avgCaseValue) : 0,
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  return {
    weeklyReport: weeklyReportSettingsForUser(updated),
    avgCaseValue: updated.avgCaseValue
  };
}

function inLastSevenDays(item = {}, now = Date.now()) {
  const timestamp = Number(item.receivedAt || item.createdAt || item.updatedAt || 0);
  return timestamp > 0 && timestamp >= now - WEEK_MS && timestamp <= now;
}

function isHighRiskStopped(item = {}) {
  return (item.riskLevel === 'high' || item.triage?.riskLevel === 'high' || item.triage?.requiresHumanApproval) && item.riskConfirmed === true;
}

function hasReplyDraft(item = {}) {
  const needsReply = item.triage?.suggestedAction === 'create_draft' || item.triage?.category === 'reply_needed' || item.triage?.category === 'support';
  return needsReply && Boolean(item.draft?.body || item.status === 'draft_ready' || item.status === 'sent');
}

export function aggregateWeeklyReport(items = [], options = {}) {
  const now = options.now ?? Date.now();
  const avgCaseValue = Number(options.avgCaseValue || 0);
  const scoped = items.filter((item) => inLastSevenDays(item, now));
  const highRiskStopped = scoped.filter(isHighRiskStopped).length;
  const replyDrafts = scoped.filter(hasReplyDraft).length;
  const completed = scoped.filter((item) => item.status === 'sent' || item.status === 'done').length;
  const estimatedAvoidedLoss = avgCaseValue > 0 ? highRiskStopped * avgCaseValue : 0;
  return {
    highRiskStopped,
    replyDrafts,
    completed,
    estimatedAvoidedLoss,
    avgCaseValue: avgCaseValue > 0 ? avgCaseValue : 0,
    hasAmount: avgCaseValue > 0
  };
}

export function buildWeeklyReportText(summary = {}, options = {}) {
  const appUrl = options.appUrl || 'https://henshin-hisho.link/app/';
  const lines = [
    summary.highRiskStopped > 0
      ? `今週、危ない返信を${summary.highRiskStopped}件、送信前に止めました。`
      : '今週は危険な返信はありませんでした。安全に対応できています。',
    '',
    `返信漏れ防止: ${summary.replyDrafts || 0}件`,
    `対応済み: ${summary.completed || 0}件`
  ];

  if (summary.hasAmount) {
    lines.push(
      '',
      `推定損失回避額: ${summary.estimatedAvoidedLoss.toLocaleString('ja-JP')}円`,
      `算定根拠: 客単価${summary.avgCaseValue.toLocaleString('ja-JP')}円 × 危ない返信${summary.highRiskStopped}件`
    );
  }

  lines.push('', `週次レポートを見る: ${appUrl}`);
  return lines.join('\n');
}

function isWeeklySendTime(now, settings) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, weekday: 'short' }).format(new Date(now));
  return weekday === 'Mon' && currentHourInTimezone(now, settings.timezone) === settings.hour;
}

export async function weeklyReportForUser(env, user, options = {}) {
  const items = await listInboxItemsForUser(env, user.id);
  const summary = aggregateWeeklyReport(items, {
    now: options.now ?? Date.now(),
    avgCaseValue: Number(user.avgCaseValue || 0)
  });
  return {
    ok: true,
    summary,
    text: buildWeeklyReportText(summary, { appUrl: String(env.APP_BASE_URL || 'https://henshin-hisho.link/app/') })
  };
}

export async function sendWeeklyReportForUser(env, user, options = {}) {
  const settings = weeklyReportSettingsForUser(user);
  if (!settings.enabled) return { ok: true, skipped: 'disabled' };
  const report = await weeklyReportForUser(env, user, options);
  const mail = await sendMail(env, {
    to: user.email,
    subject: '【AI返信秘書】今週の成果レポート',
    text: report.text
  });
  if (!mail.ok) return mail;
  return report;
}

export async function runWeeklyReportSchedule(env, options = {}) {
  const now = options.now ?? Date.now();
  const userIds = await listUserIds(env);
  const results = [];
  for (const userId of userIds) {
    const user = await getJson(env, `users:${userId}`);
    if (!user) continue;
    const digest = digestSettingsForUser(user);
    if (!isWeeklySendTime(now, digest)) continue;
    if (!weeklyReportSettingsForUser(user).enabled) continue;
    results.push({ userId, result: await sendWeeklyReportForUser(env, user, { now }) });
  }
  return results;
}
