/**
 * 一つの契約記録を、Stripe / App Store / Google Play / ライセンス鍵から合成する。
 * どれか一つが有効なら、そのメールアドレスの全画面が開く。
 */
export function mergeEntitlement(record = {}, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const sources = record.sources && typeof record.sources === 'object' ? record.sources : null;
  const sourceNames = sources ? Object.keys(sources) : [];
  let activeEnd = null;
  if (sourceNames.length > 0) {
    for (const source of Object.values(sources)) {
      if (!source?.active) continue;
      const end = Number(source.currentPeriodEnd || 0);
      if (!end || end > now) {
        if (!end || activeEnd === 0) activeEnd = 0;
        else activeEnd = activeEnd == null ? end : Math.max(activeEnd, end);
      }
    }
  } else if (record.plan === 'active') {
    const end = Number(record.currentPeriodEnd || 0);
    if (!end || end > now) activeEnd = end;
  }
  if (activeEnd != null) {
    return { plan: 'active', trialDaysRemaining: 0, currentPeriodEnd: activeEnd, unlocked: true };
  }
  const trialEndsAt = Number(record.trialEndsAt || 0);
  if (trialEndsAt > now) {
    return {
      plan: 'trial',
      trialDaysRemaining: Math.max(0, Math.ceil((trialEndsAt - now) / 86400)),
      currentPeriodEnd: Number(record.currentPeriodEnd || 0),
      unlocked: true
    };
  }
  if (record.plan || record.trialEndsAt || sourceNames.length > 0) {
    return {
      plan: 'expired',
      trialDaysRemaining: 0,
      currentPeriodEnd: Number(record.currentPeriodEnd || 0),
      unlocked: false
    };
  }
  return { plan: 'none', trialDaysRemaining: 0, currentPeriodEnd: 0, unlocked: false };
}

export function withSource(record = {}, name, source) {
  return {
    ...record,
    sources: {
      ...(record.sources || {}),
      [name]: { ...(record.sources?.[name] || {}), ...source }
    }
  };
}

export function applyMergedPlan(record = {}, nowMs = Date.now()) {
  const merged = mergeEntitlement(record, nowMs);
  return {
    ...record,
    plan: merged.plan,
    currentPeriodEnd: merged.currentPeriodEnd,
    updatedAt: Math.floor(nowMs / 1000)
  };
}
