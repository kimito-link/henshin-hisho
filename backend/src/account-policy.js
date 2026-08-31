import { nowSeconds } from './crypto.js';
import { putUser } from './kv.js';
import { normalizeText } from './schema.js';
import { pickTone } from './draft-gen.js';

export const DEFAULT_ACCOUNT_POLICY = Object.freeze({
  version: 0,
  industryTemplate: '',
  defaultTone: 'polite',
  discountCeilingPercent: null,
  minOrderValueYen: null,
  bundlePolicy: 'none',
  freeformNote: ''
});

const BUNDLE_POLICIES = new Set(['none', 'encourage', 'case_by_case']);
const INDUSTRY_TEMPLATES = new Set(['', 'seisaku', 'butsuhan', 'service']);

function normalizeAccountPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const discount = Number(source.discountCeilingPercent);
  const minOrder = Number(source.minOrderValueYen);
  return {
    version: Number.isInteger(source.version) ? source.version : 0,
    industryTemplate: INDUSTRY_TEMPLATES.has(source.industryTemplate) ? source.industryTemplate : '',
    defaultTone: pickTone(source.defaultTone),
    discountCeilingPercent: Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : null,
    minOrderValueYen: Number.isFinite(minOrder) && minOrder >= 0 ? Math.floor(minOrder) : null,
    bundlePolicy: BUNDLE_POLICIES.has(source.bundlePolicy) ? source.bundlePolicy : DEFAULT_ACCOUNT_POLICY.bundlePolicy,
    freeformNote: normalizeText(source.freeformNote, 1000)
  };
}

export function accountPolicyForUser(user = {}) {
  return normalizeAccountPolicy(user.accountPolicy);
}

export async function updateAccountPolicy(env, user, patch = {}) {
  const currentVersion = accountPolicyForUser(user).version;
  const merged = normalizeAccountPolicy({ ...accountPolicyForUser(user), ...patch, version: currentVersion });
  const updated = {
    ...user,
    accountPolicy: { ...merged, version: currentVersion + 1 },
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  return updated.accountPolicy;
}
