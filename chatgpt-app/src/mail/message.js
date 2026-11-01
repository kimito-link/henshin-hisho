import { encodedHeader } from '../gmail.js';

function randomHex(bytes) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buffer].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function angle(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('<') && text.endsWith('>')) return text;
  return `<${text.replace(/^<|>$/g, '')}>`;
}

export function newMessageId(fromAddress) {
  const domain = String(fromAddress || '').split('@')[1] || 'kimitotalk.link';
  return `<${randomHex(8)}@${domain}>`;
}

export function referenceHeader(referenceIds, messageId) {
  return [referenceIds, messageId].filter(Boolean).join(' ').trim();
}

export function buildRfc822({ from, to, cc, bcc, subject, body, messageId, inReplyTo, references }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : '',
    bcc ? `Bcc: ${bcc}` : '',
    messageId ? `Message-ID: ${angle(messageId)}` : '',
    inReplyTo ? `In-Reply-To: ${angle(inReplyTo)}` : '',
    references ? `References: ${references}` : '',
    `Subject: ${encodedHeader(subject || '')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${body || ''}`;
}
