import { nowSeconds } from './crypto.js';
import { deleteKey, getJson, listKeys, putJson, putUser } from './kv.js';
import { sendMail } from './mailer.js';

export const DEFAULT_DIGEST_SETTINGS = Object.freeze({
  enabled: true,
  hour: 8,
  timezone: 'Asia/Tokyo',
  channel: 'email'
});

const ACTIVE_STATUSES = new Set(['triaged', 'draft_ready', 'needs_human_review']);
const DONE_STATUSES = new Set(['sent', 'ignored', 'ignore', 'done']);

function normalizeDigestSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const hour = Number(source.hour);
  const channel = ['push', 'email', 'both'].includes(source.channel) ? source.channel : DEFAULT_DIGEST_SETTINGS.channel;
  return {
    enabled: source.enabled !== false,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_SETTINGS.hour,
    timezone: String(source.timezone || DEFAULT_DIGEST_SETTINGS.timezone),
    channel
  };
}

export function digestSettingsForUser(user = {}) {
  return normalizeDigestSettings(user.digest);
}

export async function updateDigestSettings(env, user, patch = {}) {
  const updated = {
    ...user,
    digest: normalizeDigestSettings({ ...digestSettingsForUser(user), ...patch }),
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  return updated.digest;
}

export async function listUserIds(env) {
  const keys = await listKeys(env, 'users:');
  return keys.map((key) => key.slice('users:'.length)).filter(Boolean);
}

export async function listInboxItemsForUser(env, userId) {
  const keys = await listKeys(env, `inbox:${userId}:`);
  const items = [];
  for (const key of keys) {
    const item = await getJson(env, key);
    if (item) items.push(item);
  }
  return items;
}

function isToday(timestamp, now, timezone) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return format.format(new Date(timestamp)) === format.format(new Date(now));
}

function isUnhandled(item = {}) {
  const status = String(item.status || '');
  if (DONE_STATUSES.has(status)) return false;
  if (ACTIVE_STATUSES.has(status)) return true;
  return false;
}

export function aggregateDailyDigest(items = [], options = {}) {
  const now = options.now ?? Date.now();
  const timezone = options.timezone || DEFAULT_DIGEST_SETTINGS.timezone;
  const todayItems = items.filter((item) => {
    const timestamp = Number(item.receivedAt || item.createdAt || 0);
    return timestamp > 0 && isToday(timestamp, now, timezone) && isUnhandled(item);
  });
  return {
    needsReply: todayItems.filter((item) => item.triage?.suggestedAction === 'create_draft' || item.triage?.category === 'reply_needed').length,
    highRisk: todayItems.filter((item) => item.riskLevel === 'high' || item.triage?.riskLevel === 'high' || item.triage?.requiresHumanApproval).length,
    urgent: todayItems.filter((item) => item.triage?.priority === 'urgent').length,
    later: todayItems.filter((item) => item.triage?.suggestedAction === 'snooze' || item.status === 'snoozed').length,
    total: todayItems.length
  };
}

export function currentHourInTimezone(now = Date.now(), timezone = DEFAULT_DIGEST_SETTINGS.timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date(now));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return hour === 24 ? 0 : hour;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createDigestUnsubscribeToken(env, userId) {
  const issuedAt = nowSeconds();
  const payload = `${userId}.${issuedAt}`;
  const signature = await hmacHex(env.SESSION_SECRET || '', payload);
  return `${payload}.${signature}`;
}

async function verifyDigestUnsubscribeToken(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, issuedAt, signature] = parts;
  const ageSeconds = nowSeconds() - Number(issuedAt || 0);
  if (!userId || !Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > 60 * 60 * 24 * 365) return null;
  const expected = await hmacHex(env.SESSION_SECRET || '', `${userId}.${issuedAt}`);
  return expected === signature ? userId : null;
}

export async function unsubscribeDigestByToken(env, token) {
  const userId = await verifyDigestUnsubscribeToken(env, token);
  if (!userId) return { ok: false, reason: 'invalid_token' };
  const user = await getJson(env, `users:${userId}`);
  if (!user) return { ok: false, reason: 'user_not_found' };
  await updateDigestSettings(env, user, { enabled: false });
  await deleteKey(env, `push-sub:${userId}`);
  return { ok: true };
}

export function buildDigestEmailText(summary = {}, options = {}) {
  const appUrl = options.appUrl || 'https://henshin-hisho.link/app/';
  const unsubscribeUrl = options.unsubscribeUrl || '';
  const main = summary.total > 0
    ? `おはようございます。本日の要返信${summary.needsReply}件・危険${summary.highRisk}件・後回し${summary.later}件です。`
    : 'おはようございます。今日はすべて対応済みです。';
  return [
    main,
    '',
    `至急: ${summary.urgent || 0}件`,
    `要返信: ${summary.needsReply || 0}件`,
    `危険: ${summary.highRisk || 0}件`,
    `後回し: ${summary.later || 0}件`,
    '',
    `受信箱を開く: ${appUrl}`,
    '',
    unsubscribeUrl ? `配信停止: ${unsubscribeUrl}` : ''
  ].filter((line) => line !== '').join('\n');
}

export async function sendDigestForUser(env, user, options = {}) {
  const settings = digestSettingsForUser(user);
  if (!settings.enabled) return { ok: true, skipped: 'disabled' };
  const items = await listInboxItemsForUser(env, user.id);
  const summary = aggregateDailyDigest(items, { now: options.now ?? Date.now(), timezone: settings.timezone });
  if (summary.total === 0 && options.force !== true) return { ok: true, skipped: 'empty' };
  const appUrl = String(env.APP_BASE_URL || 'https://henshin-hisho.link/app/');
  const unsubscribeToken = await createDigestUnsubscribeToken(env, user.id);
  const apiBase = String(env.APP_WORKER_BASE_URL || 'https://henshin-hisho-app.info-a40.workers.dev');
  const unsubscribeUrl = `${apiBase}/digest/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}`;
  const text = buildDigestEmailText(summary, { appUrl, unsubscribeUrl });

  if (settings.channel === 'email' || settings.channel === 'both') {
    const mail = await sendMail(env, {
      to: user.email,
      subject: '【AI返信秘書】本日の要対応ダイジェスト',
      text
    });
    if (!mail.ok) return mail;
  }

  return {
    ok: true,
    summary,
    push: settings.channel === 'push' || settings.channel === 'both' ? 'subscription_saved_delivery_not_implemented' : 'not_requested'
  };
}

export async function runDigestSchedule(env, options = {}) {
  const now = options.now ?? Date.now();
  const userIds = await listUserIds(env);
  const results = [];
  for (const userId of userIds) {
    const user = await getJson(env, `users:${userId}`);
    if (!user) continue;
    const settings = digestSettingsForUser(user);
    if (!settings.enabled) continue;
    if (currentHourInTimezone(now, settings.timezone) !== settings.hour) continue;
    results.push({ userId, result: await sendDigestForUser(env, user, { now }) });
  }
  return results;
}
