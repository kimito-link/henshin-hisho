import { clip } from './http.js';

/** 画面に出す出願番号。請求の文言はここに写さない。 */
export const PATENT_APPLICATIONS = Object.freeze([
  '特願2026-159882',
  '特願2026-040421',
  '特願2026-041498',
  '特願2026-206930',
  '特願2026-227084'
]);

export const PATENT_LABEL = `特許出願中（${PATENT_APPLICATIONS.join('・')}）`;

const ELLIPSIS = /さっきの人|前回の相手|この前の人|先の方|例の人/;

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
    minOrderValueYen: optionalInt(input.minOrderValueYen, 0, 100000000),
    forceHolding: input.forceHolding === true
  };
}

/** 自然文の指示を、トーン・保留・「さっきの人」に分ける。 */
export function parseInstruction(text) {
  const raw = clip(text, 500);
  let tone = '';
  if (/丁寧/.test(raw)) tone = 'polite';
  else if (/はっきり|強め/.test(raw)) tone = 'firm';
  else if (/冷静/.test(raw)) tone = 'calm';
  else if (/砕け|カジュアル/.test(raw)) tone = 'casual';
  const action = /保留|約束しない|まだ決めない/.test(raw) ? 'hold' : 'reply';
  const focus = raw
    .replace(ELLIPSIS, '')
    .replace(/丁寧に|はっきり|冷静に|砕けた調子で|カジュアルに|強めに/g, '')
    .replace(/返して|返信して|伝えて|送って/g, '')
    .replace(/[にへ]、?|[、。]/g, '')
    .trim()
    .slice(0, 500);
  return { raw, refersToPrevious: ELLIPSIS.test(raw), tone, action, focus };
}

/** 「さっきの人」はしおりの直近だけを使う。無いときは相手を作らない。 */
export function applyInstruction(input = {}, history = []) {
  const parsed = parseInstruction(input.instruction || input.intent || '');
  const next = { ...input };
  if (parsed.tone) next.tone = parsed.tone;
  if (parsed.focus) next.intent = parsed.focus;
  if (parsed.action === 'hold') next.forceHolding = true;
  if (!parsed.refersToPrevious) {
    return { input: next, instruction: parsed, reference: { resolved: false, refersToPrevious: false } };
  }
  const previous = (Array.isArray(history) ? history : []).find((item) => item && (item.sender || item.subject || item.excerpt));
  if (!previous) {
    return {
      input: next,
      instruction: parsed,
      reference: { resolved: false, refersToPrevious: true, reason: 'no_previous_person' }
    };
  }
  if (!clip(next.sender, 120)) next.sender = previous.sender || '';
  if (!clip(next.subject, 200) && previous.subject) next.subject = previous.subject;
  if (!clip(next.body, 4000) && previous.excerpt) next.body = previous.excerpt;
  return {
    input: next,
    instruction: parsed,
    reference: {
      resolved: true,
      refersToPrevious: true,
      shioriId: previous.id || '',
      sender: next.sender || '',
      subject: next.subject || ''
    }
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
  return 'このメールは未送信です。送るときは、カードの「送信」を押してください。';
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

export function predictRecipientEmotion(candidate, risk = {}) {
  if (candidate.holding && candidate.id === 'hold-facts') {
    return { category: '納得', score: 70, reason: '事実の整理だけなので、相手が話の位置を追いやすい' };
  }
  if (candidate.holding && candidate.id === 'hold-boundary') {
    return { category: '負担', score: 46, reason: '条件を確定しないと先に伝わるので、相手は待ち時間を負担に感じやすい' };
  }
  if (candidate.holding) {
    return { category: '安心', score: 74, reason: '断定や約束を避けているので、相手が期待しすぎにくい' };
  }
  if (candidate.tone === 'firm') {
    return risk.level === 'medium'
      ? { category: '負担', score: 48, reason: '条件を先に示すので、相手は判断しやすい一方で圧を感じることがある' }
      : { category: '納得', score: 62, reason: '確定している事実から先に伝えるので、相手が判断しやすい' };
  }
  if (candidate.tone === 'calm') {
    return { category: '納得', score: 71, reason: '状況を整理して返すので、相手が内容を理解しやすい' };
  }
  if (candidate.tone === 'casual') {
    return risk.level === 'low'
      ? { category: '安心', score: 66, reason: '近い距離の言い方で、相手が構えにくい' }
      : { category: '困惑', score: 44, reason: 'くだけた調子が、相手には軽く見えることがある' };
  }
  return { category: '安心', score: 76, reason: '丁寧な受け答えで、相手が構えにくい' };
}

function withEmotion(candidate, risk) {
  return { ...candidate, emotion: predictRecipientEmotion(candidate, risk) };
}

export function buildCandidates(assessment) {
  const { message, risk, classification } = assessment;
  if (classification === 'notice' || !message.body) return [];
  if (risk.level === 'high' || message.forceHolding) {
    return [
      { id: 'hold-polite', tone: 'polite', label: '丁寧な保留', holding: true, text: holdingText(message, 'polite') },
      { id: 'hold-facts', tone: 'calm', label: '事実の整理', holding: true, text: holdingText(message, 'facts') },
      { id: 'hold-boundary', tone: 'firm', label: '条件は未確定', holding: true, text: holdingText(message, 'boundary') }
    ].map((candidate) => withEmotion(candidate, risk));
  }
  return toneOrder(message.tone)
    .map((tone) => ({
      id: `tone-${tone}`,
      tone,
      label: TONE_LABEL[tone],
      holding: false,
      text: draftText(message, tone)
    }))
    .map((candidate) => withEmotion(candidate, risk));
}

/** コピー直前に、作成時の文面と危険度がまだ同じかを見る。 */
export function compareSnapshot(snapshot, review) {
  if (!snapshot || !Array.isArray(snapshot.texts)) return { ok: false, reason: 'state_mismatch' };
  if (snapshot.riskLevel !== review.riskLevel) return { ok: false, reason: 'state_mismatch' };
  if (!snapshot.texts.includes(review.copyText)) return { ok: false, reason: 'state_mismatch' };
  return { ok: true };
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
