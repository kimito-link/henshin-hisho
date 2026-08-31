export function isGmailConnectEnabled(env) {
  return String(env.GMAIL_CONNECT_ENABLED || 'false').toLowerCase() === 'true';
}

export async function connectGmail(env) {
  if (!isGmailConnectEnabled(env)) return { ok: false, reason: 'gmail_connect_disabled' };
  return { ok: false, reason: 'gmail_connector_not_implemented' };
}

export async function fetchGmailMessages(env) {
  if (!isGmailConnectEnabled(env)) return { ok: false, reason: 'gmail_connect_disabled' };
  return { ok: false, reason: 'gmail_connector_not_implemented' };
}

export async function insertGmailDraft(env) {
  if (!isGmailConnectEnabled(env)) return { ok: false, reason: 'gmail_connect_disabled' };
  return { ok: false, reason: 'gmail_connector_not_implemented' };
}
