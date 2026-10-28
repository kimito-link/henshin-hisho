#!/usr/bin/env node
// Google Play の定期購入定義を表示する。既定は dry-run。ストアへは送らない。
import { playSubscriptionDefinition } from './lib/play-api.mjs';

const apply = process.argv.includes('--apply');
const definition = playSubscriptionDefinition(process.env.PLAY_PACKAGE_NAME || undefined);
if (apply && process.env.APPLY_STORE_CHANGES !== '1') {
  console.error('dry-run のままです。送信するには APPLY_STORE_CHANGES=1 と --apply が必要です。この実行では送りません。');
}
console.log(JSON.stringify({
  dryRun: true,
  sent: false,
  applyRequested: apply,
  note: 'Play Console へは送りません。購入の確認 URL は playSubscriptionV2Url と同じです。',
  definition
}, null, 2));
