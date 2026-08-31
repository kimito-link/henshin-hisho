// 移植元: partnership_program_website/scripts/lib/asc-rejection-classify.mjs
//        (Exosome/scripts/lib/asc-rejection-classify.mjs と同一内容)
//
// App Store の却下を分類し、asc-review-check ワークフローが次のアクションを
// 自動で選べるようにする。アプリ固有値は持たない(hint 内のドメイン例は
// app.config.json の productionDomain を参照する旨に一般化済み)。
//
// Apple の reject feedback の在り処:
//   - Resolution Center スレッド(UI のみ、安定 API 無し)
//   - appStoreReviewActionItems / betaAppReviewActionItems(構造化された修正項目)
//   - チーム agent へのメール(API 外)
//
// 重要: appStoreReviewDetails.notes は「開発者が Apple に読ませる」フィールドで、
// Apple は書き込まない。これを Apple の feedback として読むと誤分類するので読まない。

const PATTERNS = [
  {
    code: 'TWO_THREE_TEN',
    label: 'Guideline 2.3.10 — other-platform reference',
    regex: /(android|google\s?play|play\s?store|amazon\s?appstore|galaxy\s?store)/i,
    action: 'retry-after-metadata-fix',
    hint:
      'Metadata mentions a non-Apple platform. Edit description-ja.txt / keywords-ja.txt / release-notes to stay platform-neutral and re-push.',
  },
  {
    code: 'SCREENSHOT',
    label: 'Screenshot rejection',
    regex: /screenshot|misleading|app preview|inaccurate/i,
    action: 'retry-with-fresh-screenshots',
    hint:
      'Screenshots failed visual review. Improve the screenshot capture step (add captions / multiple slides) then re-trigger the iOS release workflow.',
  },
  {
    code: 'DEMO_ACCOUNT',
    label: 'Demo account / sign-in required',
    regex: /demo\s?account|sign[- ]?in|credentials|login|unable to access/i,
    action: 'add-demo-account-secret',
    hint:
      'Reviewer could not access the app. Set IOS_REVIEW_DEMO_USERNAME / IOS_REVIEW_DEMO_PASSWORD repo secrets with a working account on <app.config.json identity.productionDomain>, then re-trigger the iOS release workflow.',
  },
  {
    code: 'PRIVACY',
    label: 'Privacy policy / data collection',
    regex: /privacy|data collection|app privacy|tracking/i,
    action: 'review-app-privacy-form',
    hint:
      'App Privacy form needs adjustment in ASC web UI. Compare disclosed data types with what the app actually collects.',
  },
  {
    code: 'CRASH_BUG',
    label: 'Crash or bug in build',
    regex: /crash|bug|freeze|hang|broken/i,
    action: 'fix-and-rebuild',
    hint:
      'Build crashed during review. Fix the bug, push to main, the iOS workflow will rebuild and resubmit automatically.',
  },
  {
    code: 'INVALID_BINARY',
    label: 'Invalid binary',
    regex: /invalid binary|missing.*entitlement|signing/i,
    action: 'rebuild-and-resubmit',
    hint:
      'Binary failed Apple processing. This is often transient; re-trigger the iOS release workflow.',
  },
];

export function classifyRejection({ state, feedbackText = '' }) {
  const text = `${state} ${feedbackText}`;
  for (const p of PATTERNS) {
    if (p.regex.test(text)) {
      return {
        code: p.code,
        label: p.label,
        action: p.action,
        hint: p.hint,
      };
    }
  }
  if (state === 'INVALID_BINARY') return PATTERNS.find((p) => p.code === 'INVALID_BINARY');
  return {
    code: 'UNKNOWN',
    label: `Unclassified (${state})`,
    action: 'manual-review',
    hint:
      'No matching pattern. Open the App Store Connect rejection email and decide between (a) metadata change + re-push, (b) code fix + re-push, or (c) ASC UI work.',
  };
}

// Apple が書き込むエンドポイントだけを読む。appStoreReviewDetails は
// 「開発者が Apple に読ませる」notes なので意図的に読まない(誤分類防止)。
export async function fetchRejectionFeedback(api, versionId) {
  const chunks = [];
  try {
    const r = await api(
      'GET',
      `/v1/appStoreVersions/${versionId}/appStoreReviewActionItems?limit=20`,
    );
    for (const it of r?.data || []) {
      const a = it.attributes || {};
      const line = [a.title, a.reason, a.details, a.fixIt].filter(Boolean).join(' | ').slice(0, 600);
      if (line) chunks.push(`[reviewActionItem] ${line}`);
    }
  } catch (_e) {
    /* 404 = none; ignore */
  }
  try {
    const r = await api(
      'GET',
      `/v1/appStoreVersions/${versionId}/appStoreVersionSubmission`,
    );
    const attrs = r?.data?.attributes;
    if (attrs && Object.keys(attrs).length > 0) {
      chunks.push(`[versionSubmission] ${JSON.stringify(attrs).slice(0, 500)}`);
    }
  } catch (_e) {
    /* ignore */
  }
  return chunks.join('\n');
}
