import { normalizeText } from './schema.js';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function userKey(userId) {
  return `users:${userId}`;
}

export function emailIndexKey(email) {
  return `email-index:${normalizeEmail(email)}`;
}

export function sessionKey(token) {
  return `session:${token}`;
}

export function magicKey(token) {
  return `magic:${token}`;
}

export async function getJson(env, key) {
  const raw = await env.APP_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putJson(env, key, value, options = {}) {
  await env.APP_KV.put(key, JSON.stringify(value), options);
  return value;
}

export async function deleteKey(env, key) {
  if (typeof env.APP_KV.delete === 'function') await env.APP_KV.delete(key);
}

export async function listKeys(env, prefix) {
  if (typeof env.APP_KV.list !== 'function') return [];
  const result = await env.APP_KV.list({ prefix });
  return Array.isArray(result?.keys) ? result.keys.map((entry) => entry.name).filter(Boolean) : [];
}

export async function getUser(env, userId) {
  return await getJson(env, userKey(userId));
}

export async function putUser(env, user) {
  await putJson(env, userKey(user.id), user);
  return user;
}

export async function getUserIdByEmail(env, email) {
  return normalizeText(await env.APP_KV.get(emailIndexKey(email)));
}

export async function deleteUserData(env, user) {
  const userId = user?.id || '';
  if (!userId) return;

  await deleteKey(env, userKey(userId));
  if (user.email) await deleteKey(env, emailIndexKey(user.email));

  const sessionKeys = await listKeys(env, 'session:');
  for (const key of sessionKeys) {
    const session = await getJson(env, key);
    if (session?.userId === userId) await deleteKey(env, key);
  }

  const magicKeys = await listKeys(env, 'magic:');
  for (const key of magicKeys) {
    const magic = await getJson(env, key);
    if (magic?.userId === userId || magic?.email === user.email) await deleteKey(env, key);
  }

  const inboxKeys = await listKeys(env, `inbox:${userId}:`);
  for (const key of inboxKeys) await deleteKey(env, key);
}
