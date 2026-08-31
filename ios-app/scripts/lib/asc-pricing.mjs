// 移植元: partnership_program_website/scripts/lib/asc-pricing.mjs
//        (Exosome/scripts/lib/asc-pricing.mjs と同一内容)
//
// App Store の無料ティア価格設定。Apple は審査提出前に全アプリへ価格スケジュール
// (Tier 0 / $0 でも)を要求する(無いと STATE_ERROR.APP_PRICING_REQUIRED)。
// アプリ固有値は持たない。appId は呼び出し側(app.config.json 由来)が渡す。
// app.config.json を SSOT とする運用のため、このファイル自体は無改変で使える。
//
// v2 pricing API(2023導入)を使う。v1 /v1/appPrices は read-only。
// 冪等: 既に手動価格スケジュールがあればスキップ。

// このアプリの無料ティア(USD $0.00)の appPricePoint id を探す。
async function findFreePricePoint(api, appId) {
  let pageUrl = `/v1/apps/${appId}/appPricePoints?filter[territory]=USA&limit=200`;
  let sample = null;
  for (let i = 0; i < 8; i += 1) {
    const r = await api('GET', pageUrl);
    if (!sample && r.data?.[0]) sample = r.data[0];
    for (const p of r.data || []) {
      const customerPrice = p.attributes?.customerPrice;
      const num = Number(customerPrice);
      if (Number.isFinite(num) && num === 0) {
        return p.id;
      }
    }
    const next = r.links?.next;
    if (!next) break;
    pageUrl = next.replace('https://api.appstoreconnect.apple.com', '');
  }
  if (sample) {
    console.log(
      `  (no $0 USA price point found; sample row: ${JSON.stringify({
        id: sample.id,
        attrs: sample.attributes,
        rel: sample.relationships,
      }).slice(0, 600)})`,
    );
  }
  throw new Error(`No free-tier appPricePoint (USA, $0.00) found for app ${appId}`);
}

async function hasPriceSchedule(api, appId) {
  try {
    const r = await api(
      'GET',
      `/v2/apps/${appId}/appPriceSchedule?include=manualPrices&fields[appPriceSchedules]=manualPrices`,
    );
    const manual = r?.included?.filter((x) => x.type === 'appPrices') || [];
    return manual.length > 0;
  } catch (e) {
    if (String(e.message).includes('404')) return false;
    throw e;
  }
}

export async function ensureFreePricing(api, appId) {
  if (await hasPriceSchedule(api, appId)) {
    console.log(`  pricing schedule already set; nothing to do`);
    return { set: false };
  }
  const pricePointId = await findFreePricePoint(api, appId);
  console.log(`  applying free-tier pricing (appPricePoint id=${pricePointId})`);
  const tempId = '${free-price}';
  await api('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: appId } },
        manualPrices: { data: [{ type: 'appPrices', id: tempId }] },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
      },
    },
    included: [
      {
        type: 'appPrices',
        id: tempId,
        attributes: { startDate: null },
        relationships: {
          appPricePoint: { data: { type: 'appPricePoints', id: pricePointId } },
          territory: { data: { type: 'territories', id: 'USA' } },
        },
      },
    ],
  });
  return { set: true };
}
