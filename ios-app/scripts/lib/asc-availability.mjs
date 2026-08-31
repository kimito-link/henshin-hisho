// 配信地域(App Availability)の自動設定。
//
// 背景: 審査に通っても配信地域が0件だと実機で「この国または地域では入手できません」
// になる(docs/TROUBLESHOOTING.md参照)。これまで asc-readonly-checks.mjs の
// checkTerritoriesConfigured は「0件を検出して警告する」だけで、実際の設定はASC UIで
// 手動だった。ここではその警告を自動修復に格上げする。
//
// エンドポイント: v1 availableTerritories は deprecated。
//   GET  /v1/apps/{id}/appAvailabilityV2                      → appAvailability の id を得る
//   PATCH /v1/appAvailabilities/{availabilityId}               → availableInNewTerritories を立てる
// availableInNewTerritories=true にすると、既存の全territory + Appleが将来追加する新territory
// にも自動追随して配信される(個々のterritoryIdを列挙するより堅牢)。
//
// 冪等: 既にterritoryAvailabilitiesが1件以上あれば何もしない。

async function getAppAvailabilityId(api, appId) {
  const avail = await api('GET', `/v1/apps/${appId}/appAvailabilityV2`);
  return avail?.data?.id || null;
}

async function countTerritoryAvailabilities(api, availabilityId) {
  const terr = await api(
    'GET',
    `/v2/appAvailabilities/${availabilityId}/territoryAvailabilities?limit=1`,
  );
  return (terr?.data || []).length;
}

export async function ensureAllTerritoriesAvailable(api, appId) {
  const availabilityId = await getAppAvailabilityId(api, appId);
  if (!availabilityId) {
    throw new Error('appAvailabilityV2 が見つからない(app未作成の可能性)');
  }

  const existing = await countTerritoryAvailabilities(api, availabilityId);
  if (existing > 0) {
    console.log('  territory availability already configured; nothing to do');
    return { set: false };
  }

  console.log(`  applying "all territories + auto new territories" (availabilityId=${availabilityId})`);
  await api('PATCH', `/v1/appAvailabilities/${availabilityId}`, {
    data: {
      type: 'appAvailabilities',
      id: availabilityId,
      attributes: { availableInNewTerritories: true },
    },
  });
  return { set: true };
}
