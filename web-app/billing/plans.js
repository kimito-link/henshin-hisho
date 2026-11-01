/**
 * 返信秘書の料金の正本。Web の Stripe、会話の作成カード、App Store、Google Play はここを読む。
 * 金額は日本円の税込表示。ストアへは送らない。
 */
export const APPLE_BUNDLE_ID = 'jp.besttrust.henshinhisho';
export const PLAY_PACKAGE_NAME = 'jp.besttrust.henshinhisho';
/** Apple Root CA - G3 の公開 SHA-256。秘密ではない。 */
export const APPLE_ROOT_CA_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
export const OPERATOR_NAME = '株式会社ベストトラスト';
export const PATENT_FOOTER =
  '特許出願中（特願2026-159882・特願2026-040421・特願2026-041498・特願2026-206930・特願2026-227084）';

export const PRICE_YEN = 2980;
export const ANNUAL_YEN = 29800;
export const TRIAL_DAYS = 14;

export const PLANS = Object.freeze([
  Object.freeze({
    id: 'monthly',
    label: '月額',
    interval: 'month',
    priceYen: PRICE_YEN,
    stripeEnv: 'STRIPE_PRICE_ID',
    appleProductId: 'jp.besttrust.henshinhisho.monthly',
    playProductId: 'henshin_hisho',
    playBasePlanId: 'monthly',
    playBillingPeriod: 'P1M'
  }),
  Object.freeze({
    id: 'annual',
    label: '年額',
    interval: 'year',
    priceYen: ANNUAL_YEN,
    stripeEnv: 'STRIPE_ANNUAL_PRICE_ID',
    appleProductId: 'jp.besttrust.henshinhisho.annual',
    playProductId: 'henshin_hisho',
    playBasePlanId: 'annual',
    playBillingPeriod: 'P1Y'
  })
]);

export function planById(id) {
  return PLANS.find((plan) => plan.id === id) || PLANS[0];
}

export function planByAppleProduct(productId) {
  return PLANS.find((plan) => plan.appleProductId === productId) || null;
}

export function planByPlayBasePlan(basePlanId) {
  return PLANS.find((plan) => plan.playBasePlanId === basePlanId) || null;
}
