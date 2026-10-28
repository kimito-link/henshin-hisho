/** @capgo/native-purchases（Capacitor 8 対応の維持版）経由の定期購入。 */
const PLANS = {
  monthly: {
    appleProductId: 'jp.besttrust.henshinhisho.monthly',
    playProductId: 'henshin_hisho',
    playBasePlanId: 'monthly'
  },
  annual: {
    appleProductId: 'jp.besttrust.henshinhisho.annual',
    playProductId: 'henshin_hisho',
    playBasePlanId: 'annual'
  }
};

function plugin() {
  return window.Capacitor?.Plugins?.NativePurchases || null;
}

export function storePlatform() {
  try {
    return window.Capacitor?.getPlatform?.() || 'web';
  } catch {
    return 'web';
  }
}

export async function purchasePlan(planId, accountToken) {
  const native = plugin();
  const plan = PLANS[planId];
  if (!native?.purchaseProduct || !plan) return { ok: false, reason: 'store_unavailable' };
  const android = storePlatform() === 'android';
  const result = await native.purchaseProduct({
    productIdentifier: android ? plan.playProductId : plan.appleProductId,
    productType: 'subs',
    planIdentifier: plan.playBasePlanId,
    appAccountToken: accountToken
  });
  return { ok: true, platform: storePlatform(), result: result || {} };
}

export async function restorePurchases() {
  const native = plugin();
  if (!native?.restorePurchases && !native?.getPurchases) return { ok: false, reason: 'store_unavailable' };
  if (native.restorePurchases) await native.restorePurchases();
  const listed = native.getPurchases ? await native.getPurchases() : [];
  const purchases = Array.isArray(listed) ? listed : listed?.purchases || [];
  return { ok: true, platform: storePlatform(), purchases };
}

export async function openStoreSubscriptions() {
  const native = plugin();
  if (!native?.manageSubscriptions) return { ok: false, reason: 'store_unavailable' };
  await native.manageSubscriptions();
  return { ok: true };
}
