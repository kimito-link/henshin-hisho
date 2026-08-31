const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';

function normalizeString(value) {
  return String(value || '').trim();
}

export async function sendMail(env, { to, subject, text } = {}) {
  const apiKey = normalizeString(env.RESEND_API_KEY);
  const from = normalizeString(env.MAIL_FROM);
  const recipient = normalizeString(to);

  if (!apiKey) return { ok: false, reason: 'mailer_not_configured' };
  if (!from) return { ok: false, reason: 'mail_from_not_configured' };
  if (!recipient) return { ok: false, reason: 'missing_recipient' };

  const payload = {
    from,
    to: recipient,
    subject: String(subject || ''),
    text: String(text || '')
  };
  const replyTo = normalizeString(env.MAIL_REPLY_TO);
  if (replyTo) payload.reply_to = replyTo;

  try {
    const response = await fetch(RESEND_EMAILS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return { ok: false, reason: 'resend_api_error', status: response.status };
    const body = await response.json().catch(() => ({}));
    return { ok: true, id: normalizeString(body?.id) };
  } catch {
    return { ok: false, reason: 'resend_fetch_failed' };
  }
}
