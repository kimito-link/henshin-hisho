import { clip } from './http.js';

/** 画面に出す出願表示。請求の範囲をここで説明しない。 */
export const PATENT_LABEL =
  '特許出願中（特願2026-155882・特願2026-040421・特願2026-041494・特願2026-206930・特願2026-227084）';

const TONES = new Set(['polite', 'firm', 'calm', 'casual']);
const CHANNELS = new Set(['email', 'line', 'chatwork', 'other']);

/** backend/src/triage.js の高リスク語と同じ。1語でも人間確認に上げる。 */
const HIGH_RISK = [
  ['返金', '返金に触れている'],
  ['契約', '契約に触れている'],
  ['法務', '法務に触れている'],
  ['訴訟', '訴訟に触れている'],
  ['医療', '医療に触れている'],
  ['診断', '診断に触れている'],
  ['金融', '金融に触れている'],
  ['請求', '請求に触れている'],
  ['個人情報', '個人情報に触れている'],
  ['クレーム', 'クレームに触れている'],
  ['損害賠償', '損害賠償に触れている'],
  ['合意', '合意に触れている'],
  ['約束', '約束に触れている']
];

const MEDIUM_RISK = [
  ['見積', '見積りに触れている'],
  ['納期', '納期に触れている'],
  ['値引', '値引きに触れている'],
  ['割引', '割引に触れている'],
  ['キャンセル', 'キャンセルに触れている'],
  ['至急', '急ぎの依頼に触れている']
];

const TONE_LABEL = {
  polite: '丁寧',
  firm: 'はっきり',
  calm: '冷静',
  casual: '砕けた調子'
};

function optionalInt(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

export function normalizeMessage(input = {}) {
  const tone = TONES.has(input.tone) ? input.tone : 'polite';
  const channel = CHANNELS.has(input.channel) ? input.channel : 'email';
  return {
    sender: clip(input.sender, 120),
    subject: clip(input.subject, 200),
    body: clip(input.body, 4000),
    intent: clip(input.intent, 500),
    tone,
    channel,
    discountCeilingPercent: optionalInt(input.discountCeilingPercent, 0, 100),
    minOrderValueYen: optionalInt(input.minOrderValueYen, 0, 100000000)
  };
}

function looksLikeNotice(message) {
  const sender = message.sender.toLowerCase();
  if (/(no-?reply|noreply|mailer-daemon|notification@|notifications@)/.test(sender)) return true;
  const text = `${message.subject}\n${message.body}`;
  return /(配信専用|自動配信|ニュースレター|配信停止|メールマガジン)/.test(text);
}

export function assessMessage(input = {}) {
  const message = normalizeMessage(input);
  const text = `${message.subject}\n${message.body}\n${message.sender}`;
  const reasons = [];
  let highHits = 0;
  for (const [word, reason] of HIGH_RISK) {
    if (text.includes(word)) {
      highHits += 1;
      reasons.push(reason);
    }
  }
  let mediumHits = 0;
  if (highHits === 0) {
    for (const [word, reason] of MEDIUM_RISK) {
      if (text.includes(word)) {
        mediumHits += 1;
        reasons.push(reason);
      }
    }
  }
  const notice = looksLikeNotice(message);
  let level = 'low';
  let score = 18;
  if (highHits > 0) {
    level = 'high';
    score = Math.min(100, 64 + highHits * 12);
  } else if (mediumHits > 0) {
    level = 'medium';
    score = Math.min(69, 18 + mediumHits * 14);
  }
  if (reasons.length === 0) reasons.push('危険な約束や契約の語句は見当たらない');
  if (notice && level !== 'high') reasons.push('通知・自動配信として振り分けた');
  const classification = notice && level !== 'high' ? 'notice' : 'needs_reply';
  return {
    message,
    classification,
    handoff: handoffFor(message.channel),
    risk: {
      score,
      level,
      reasons,
      requiresHumanApproval: level === 'high'
    }
  };
}

export function handoffFor(channel) {
  if (channel === 'line') {
    return 'この文面は下書きです。LINEへの送信は行いません。確認のあと、ご自身のLINEから送ってください。';
  }
  if (channel === 'chatwork') {
    return 'この文面は下書きです。Chatworkへの送信は行いません。確認のあと、ご自身で送ってください。';
  }
  return 'この文面は下書きです。メールの送信は行いません。確認のあと、ご自身で送ってください。';
}

function greeting(sender) {
  const name = sender.replace(/様$/, '').trim();
  return name ? `${name} 様` : 'ご担当者様';
}

function topicLine(message) {
  if (message.subject) return `「${message.subject}」の件です。`;
  if (message.intent) return `${message.intent}についてです。`;
  return 'いただいたご連絡についてです。';
}

function policySuffix(message) {
  const asked = `${message.subject}\n${message.body}\n${message.intent}`;
  if (!/(値引|割引|見積|金額|料金|価格|円)/.test(asked)) return '';
  const lines = [];
  if (message.discountCeilingPercent != null) lines.push(`値引きは最大${message.discountCeilingPercent}%までです。`);
  if (message.minOrderValueYen != null) lines.push(`最低受注額は${message.minOrderValueYen}円です。`);
  return lines.length ? `\n${lines.join('')}` : '';
}

function holdingText(message, variant) {
  const head = `${greeting(message.sender)}\n\n${topicLine(message)}ご連絡ありがとうございます。`;
  if (variant === 'facts') {
    return `${head}\n受け取った内容を整理し、確認が終わってから改めてご連絡いたします。現時点ではお約束できません。\n\nよろしくお願いいたします。`;
  }
  if (variant === 'boundary') {
    return `${head}\n現時点で条件を確定することはできません。確認のうえ、改めてご連絡いたします。\n\nよろしくお願いいたします。`;
  }
  return `${head}\n内容を確認し、改めてご連絡いたします。断定やお約束は控えさせてください。\n\nよろしくお願いいたします。`;
}

function draftText(message, tone) {
  const head = `${greeting(message.sender)}\n\n${topicLine(message)}`;
  const intent = message.intent ? `${message.intent}という趣旨でお返事します。` : '内容を確認してお返事します。';
  const suffix = policySuffix(message);
  if (tone === 'firm') {
    return `${head}${intent}\n進め方は、確定している事実だけを先にお伝えします。${suffix}\n\nよろしくお願いいたします。`;
  }
  if (tone === 'calm') {
    return `${head}${intent}\n状況を整理し、不明点があれば確認してから追ってご連絡します。${suffix}\n\nよろしくお願いいたします。`;
  }
  if (tone === 'casual') {
    return `${head}ありがとうございます。${intent}\n分かる範囲でお返事します。${suffix}\n\nよろしくお願いいたします。`;
  }
  return `${head}ご連絡ありがとうございます。${intent}\n分かりやすくお返事いたします。${suffix}\n\nよろしくお願いいたします。`;
}

function toneOrder(tone) {
  const rest = ['polite', 'calm', 'firm', 'casual'].filter((item) => item !== tone);
  return [tone, rest[0], rest[1]];
}

export function buildCandidates(assessment) {
  const { message, risk, classification } = assessment;
  if (classification === 'notice' || !message.body) return [];
  if (risk.level === 'high') {
    return [
      { id: 'hold-polite', tone: 'polite', label: '丁寧な保留', holding: true, text: holdingText(message, 'polite') },
      { id: 'hold-facts', tone: 'calm', label: '事実の整理', holding: true, text: holdingText(message, 'facts') },
      { id: 'hold-boundary', tone: 'firm', label: '条件は未確定', holding: true, text: holdingText(message, 'boundary') }
    ];
  }
  return toneOrder(message.tone).map((tone) => ({
    id: `tone-${tone}`,
    tone,
    label: TONE_LABEL[tone],
    holding: false,
    text: draftText(message, tone)
  }));
}

/** 人がチェックしたあとにだけ、コピー用の文面を返す。送信はしない。 */
export function reviewConfirmation(input = {}) {
  if (input.humanConfirmed !== true) return { ok: false, reason: 'human_confirmation_required', sent: false };
  const riskLevel = clip(input.riskLevel || input.risk?.level || 'unknown', 20);
  if (riskLevel === 'high' && input.riskAcknowledged !== true) {
    return { ok: false, reason: 'risk_acknowledgement_required', sent: false };
  }
  const copyText = clip(input.text, 4000);
  if (!copyText) return { ok: false, reason: 'empty_candidate', sent: false };
  return { ok: true, copyText, riskLevel, sent: false };
}
