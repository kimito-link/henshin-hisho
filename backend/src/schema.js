export const CHANNELS = Object.freeze(['paste', 'gmail', 'line', 'comment']);
export const INBOX_STATUSES = Object.freeze([
  'untriaged',
  'needs_human_review',
  'triaged',
  'draft_ready',
  'sent',
  'done',
  'snoozed',
  'ignored'
]);
export const RISK_LEVELS = Object.freeze(['unknown', 'low', 'medium', 'high']);

export function normalizeText(value, maxLength = 0) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
  return maxLength > 0 && text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function normalizeTimestamp(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeContact(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    name: normalizeText(source.name, 160),
    email: normalizeText(source.email, 240).toLowerCase(),
    externalUserId: normalizeText(source.externalUserId, 240)
  };
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function randomSuffix() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function makeInboxItemId(channel = 'paste', now = Date.now()) {
  return `${channel}_${now}_${randomSuffix()}`;
}

export function normalizeInboxItem(item = {}, options = {}) {
  const now = normalizeTimestamp(options.now, Date.now());
  const source = item && typeof item === 'object' ? item : {};
  const channel = pickEnum(source.channel, CHANNELS, 'paste');
  const id = normalizeText(source.id || makeInboxItemId(channel, now), 200);
  if (!id) throw new Error('inbox item id is required');

  return {
    id,
    channel,
    externalId: normalizeText(source.externalId, 240),
    from: normalizeContact(source.from),
    subject: normalizeText(source.subject, 500),
    excerpt: normalizeText(source.excerpt || source.body || source.latestText, 240),
    body: normalizeText(source.body || source.latestText),
    receivedAt: normalizeTimestamp(source.receivedAt, now),
    triage: source.triage && typeof source.triage === 'object' ? source.triage : null,
    draft: source.draft && typeof source.draft === 'object' ? source.draft : null,
    status: pickEnum(source.status, INBOX_STATUSES, 'untriaged'),
    riskLevel: pickEnum(source.riskLevel, RISK_LEVELS, 'unknown'),
    riskConfirmed: source.riskConfirmed === true,
    secretaryNote: source.secretaryNote && typeof source.secretaryNote === 'object'
      ? {
        tone: normalizeText(source.secretaryNote.tone, 40) || 'polite',
        intent: normalizeText(source.secretaryNote.intent, 500),
        extraContext: normalizeText(source.secretaryNote.extraContext, 1000),
        updatedAt: normalizeTimestamp(source.secretaryNote.updatedAt, now)
      }
      : null,
    sourceMeta: source.sourceMeta && typeof source.sourceMeta === 'object' ? source.sourceMeta : {},
    createdAt: normalizeTimestamp(source.createdAt, now),
    updatedAt: normalizeTimestamp(source.updatedAt, now)
  };
}
