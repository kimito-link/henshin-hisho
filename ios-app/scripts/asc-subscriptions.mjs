#!/usr/bin/env node
// 定期購入の商品定義を表示する。既定は dry-run。ストアへは送らない。
import { subscriptionRequests } from './lib/asc-pricing.mjs';

const apply = process.argv.includes('--apply');
const request = subscriptionRequests(process.env.ASC_APP_ID || null);
if (apply && process.env.APPLY_STORE_CHANGES !== '1') {
  console.error('dry-run のままです。送信するには APPLY_STORE_CHANGES=1 と --apply が必要です。この実行では送りません。');
}
console.log(JSON.stringify({ ...request, applyRequested: apply, sent: false }, null, 2));
