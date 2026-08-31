export function requiresRiskConfirmation(item = {}) {
  return item.riskLevel === 'high' || item.triage?.riskLevel === 'high' || item.triage?.requiresHumanApproval === true;
}

export function canGenerateDraft(item = {}) {
  if (!requiresRiskConfirmation(item)) return { ok: true };
  if (item.riskConfirmed === true) return { ok: true };
  return { ok: false, reason: 'risk_confirmation_required' };
}

export function canSendLineMessage(item = {}, options = {}) {
  const draftCheck = canGenerateDraft(item);
  if (!draftCheck.ok) return draftCheck;
  if (options.confirmSend !== true) return { ok: false, reason: 'explicit_send_confirmation_required' };
  return { ok: true };
}
