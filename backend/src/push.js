import { deleteKey, putJson } from './kv.js';

function isValidSubscription(value = {}) {
  return Boolean(value && typeof value === 'object' && value.endpoint && value.keys?.p256dh && value.keys?.auth);
}

function isValidNativeToken(value = {}) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.platform === 'ios-apns' &&
    typeof value.token === 'string' &&
    value.token.trim().length >= 16
  );
}

export function publicPushConfig(env) {
  return {
    vapidPublicKey: String(env.VAPID_PUBLIC_KEY || ''),
    delivery: 'subscription_or_native_token_saved_delivery_not_implemented'
  };
}

export async function savePushSubscription(env, userId, subscription) {
  if (isValidNativeToken(subscription)) {
    await putJson(env, `push-sub:${userId}`, {
      platform: 'ios-apns',
      token: subscription.token.trim(),
      environment: subscription.environment === 'sandbox' ? 'sandbox' : 'production',
      createdAt: Date.now()
    });
    return { ok: true };
  }
  if (!isValidSubscription(subscription)) return { ok: false, reason: 'invalid_subscription' };
  await putJson(env, `push-sub:${userId}`, {
    platform: 'web-push',
    endpoint: String(subscription.endpoint),
    keys: {
      p256dh: String(subscription.keys.p256dh),
      auth: String(subscription.keys.auth)
    },
    createdAt: Date.now()
  });
  return { ok: true };
}

export async function deletePushSubscription(env, userId) {
  await deleteKey(env, `push-sub:${userId}`);
  return { ok: true };
}
