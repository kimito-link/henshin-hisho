import { PLANS, PLAY_PACKAGE_NAME } from './plans.js';

export function playSubscriptionV2Url(packageName, purchaseToken) {
  const pkg = encodeURIComponent(packageName || PLAY_PACKAGE_NAME);
  const token = encodeURIComponent(purchaseToken || '');
  return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${token}`;
}

const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED'
]);

export function assessPlaySubscription(body = {}, nowMs = Date.now()) {
  const line = (body.lineItems || [])[0] || {};
  const expiryMs = Date.parse(line.expiryTime || '') || 0;
  const active = ACTIVE_STATES.has(body.subscriptionState) && (!expiryMs || expiryMs > nowMs);
  const basePlanId = line.offerDetails?.basePlanId || '';
  const plan = PLANS.find((item) => item.playBasePlanId === basePlanId) || null;
  return {
    active,
    currentPeriodEnd: expiryMs ? Math.floor(expiryMs / 1000) : 0,
    productId: line.productId || PLANS[0].playProductId,
    planId: plan?.id || basePlanId,
    accountToken: String(body.externalAccountIdentifiers?.obfuscatedExternalAccountId || ''),
    purchaseToken: String(body.linkedPurchaseToken || body.purchaseToken || '')
  };
}

/** Play Console に出す購読の定義。dry-run がこの形を表示する。送信はしない。 */
export function playSubscriptionDefinition(packageName = PLAY_PACKAGE_NAME) {
  return {
    packageName,
    productId: PLANS[0].playProductId,
    basePlans: PLANS.map((plan) => ({
      basePlanId: plan.playBasePlanId,
      billingPeriod: plan.playBillingPeriod,
      priceYen: plan.priceYen,
      regionCode: 'JP',
      currency: 'JPY'
    }))
  };
}
