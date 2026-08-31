import { accountPlan, linkLicense, login, requestMagicLink, requireAuth, signup } from './auth.js';
import { accountPolicyForUser, updateAccountPolicy } from './account-policy.js';
import { connectGmail } from './connectors/gmail.js';
import { handleLineWebhook } from './connectors/line.js';
import {
  digestSettingsForUser,
  runDigestSchedule,
  unsubscribeDigestByToken,
  updateDigestSettings
} from './digest.js';
import {
  handleConfirmRisk,
  handleDraft,
  handleInboxAssess,
  handleInboxList,
  handleSend,
  inboxRouteMatch
} from './inbox.js';
import { deleteUserData, putJson } from './kv.js';
import { deletePushSubscription, publicPushConfig, savePushSubscription } from './push.js';
import { handleProjectsRoute } from './projects/routes.js';
import { runChatworkSync } from './connectors/chatwork.js';
import { listAllChannelLinksBySource, loadStaffMap } from './projects/db.js';
import {
  runWeeklyReportSchedule,
  updateReportSettings,
  weeklyReportForUser,
  weeklyReportSettingsForUser
} from './weekly-report.js';
// CORS/JSONレスポンスの正は http.js(inbox.js と共通。コピーを作らない)。
import { allowedOrigins, corsHeaders, jsonResponse, readJson } from './http.js';

async function authAction(request, env, action) {
  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  try {
    const result = await action(env, payload);
    return jsonResponse(request, env, result.body, result.status);
  } catch (error) {
    if (error?.message === 'session_secret_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'session_secret_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function accountResponse(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    return jsonResponse(request, env, {
      ok: true,
      user: { id: auth.user.id, email: auth.user.email },
      account: accountPlan(auth.user),
      settings: {
        digest: digestSettingsForUser(auth.user),
        weeklyReport: weeklyReportSettingsForUser(auth.user),
        accountPolicy: accountPolicyForUser(auth.user),
        avgCaseValue: Number(auth.user.avgCaseValue || 0)
      },
      features: {
        gmailConnectEnabled: String(env.GMAIL_CONNECT_ENABLED || 'false').toLowerCase() === 'true'
      }
    });
  } catch (error) {
    if (error?.message === 'session_secret_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'session_secret_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function reportSettingsResponse(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    const payload = await readJson(request);
    if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
    const settings = await updateReportSettings(env, auth.user, payload);
    return jsonResponse(request, env, { ok: true, ...settings });
  } catch {
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function weeklyReportResponse(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
  const report = await weeklyReportForUser(env, auth.user);
  return jsonResponse(request, env, report);
}

async function digestSettingsResponse(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    const payload = await readJson(request);
    if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
    const digest = await updateDigestSettings(env, auth.user, payload);
    return jsonResponse(request, env, { ok: true, digest });
  } catch {
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function policySettingsResponse(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    const payload = await readJson(request);
    if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
    const accountPolicy = await updateAccountPolicy(env, auth.user, payload);
    return jsonResponse(request, env, { ok: true, accountPolicy });
  } catch {
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function digestUnsubscribeResponse(request, env) {
  const token = new URL(request.url).searchParams.get('t') || '';
  const result = await unsubscribeDigestByToken(env, token);
  return jsonResponse(request, env, result, result.ok ? 200 : 400);
}

async function pushSubscribeResponse(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  const result = await savePushSubscription(env, auth.user.id, payload.subscription || payload);
  return jsonResponse(request, env, result, result.ok ? 200 : 400);
}

async function pushUnsubscribeResponse(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
  return jsonResponse(request, env, await deletePushSubscription(env, auth.user.id));
}

async function deleteAccount(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    await deleteUserData(env, auth.user);
    return jsonResponse(request, env, { ok: true });
  } catch (error) {
    if (error?.message === 'session_secret_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'session_secret_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function linkLicenseResponse(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    const payload = await readJson(request);
    if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
    const result = await linkLicense(env, auth.user, payload);
    return jsonResponse(request, env, result.body, result.status);
  } catch (error) {
    if (error?.message === 'session_secret_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'session_secret_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function gmailConnectResponse(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
  const result = await connectGmail(env);
  return jsonResponse(request, env, result, result.ok ? 200 : 503);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 診断: 未許可Originからのリクエストを記録する(TTL 7日)。
    // 実機WebViewが実際に送るOriginは机上で当てられない(ios.scheme誤読で4回目の2.1却下)。
    // 次に「アプリだけ動かない」が起きたら、まず diag:unmatched-origin:* キーを見る。
    const reqOrigin = request.headers.get('Origin') || '';
    if (reqOrigin) {
      const allowList = allowedOrigins(env);
      if (!allowList.includes('*') && !allowList.includes(reqOrigin)) {
        const record = putJson(
          env,
          `diag:unmatched-origin:${reqOrigin}`,
          { origin: reqOrigin, path: url.pathname, lastSeen: Date.now() },
          { expirationTtl: 7 * 24 * 60 * 60 }
        ).catch(() => {});
        if (ctx?.waitUntil) ctx.waitUntil(record);
      }
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    if (url.pathname === '/auth/signup' && request.method === 'POST') {
      return await authAction(request, env, signup);
    }
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return await authAction(request, env, login);
    }
    if (url.pathname === '/auth/magic-link' && request.method === 'POST') {
      return await authAction(request, env, requestMagicLink);
    }
    if (url.pathname === '/account' && request.method === 'GET') {
      return await accountResponse(request, env);
    }
    if (url.pathname === '/account/delete' && request.method === 'POST') {
      return await deleteAccount(request, env);
    }
    if (url.pathname === '/account/link-license' && request.method === 'POST') {
      return await linkLicenseResponse(request, env);
    }
    if (url.pathname === '/account/digest-settings' && request.method === 'POST') {
      return await digestSettingsResponse(request, env);
    }
    if (url.pathname === '/account/report-settings' && request.method === 'POST') {
      return await reportSettingsResponse(request, env);
    }
    if (url.pathname === '/account/policy-settings' && request.method === 'POST') {
      return await policySettingsResponse(request, env);
    }
    if (url.pathname === '/report/weekly' && request.method === 'GET') {
      return await weeklyReportResponse(request, env);
    }
    if (url.pathname === '/digest/unsubscribe' && (request.method === 'POST' || request.method === 'GET')) {
      return await digestUnsubscribeResponse(request, env);
    }
    if (url.pathname === '/push/config' && request.method === 'GET') {
      return jsonResponse(request, env, { ok: true, push: publicPushConfig(env) });
    }
    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      return await pushSubscribeResponse(request, env);
    }
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      return await pushUnsubscribeResponse(request, env);
    }
    if (url.pathname === '/connectors/line/webhook' && request.method === 'POST') {
      return await handleLineWebhook(request, env);
    }
    if (url.pathname === '/connectors/gmail/connect' && request.method === 'POST') {
      return await gmailConnectResponse(request, env);
    }
    if (url.pathname === '/inbox' && request.method === 'GET') {
      return await handleInboxList(request, env);
    }
    if (url.pathname === '/inbox/assess' && request.method === 'POST') {
      return await handleInboxAssess(request, env);
    }

    const inboxMatch = inboxRouteMatch(url.pathname);
    if (inboxMatch?.action === 'draft' && request.method === 'POST') {
      return await handleDraft(request, env, inboxMatch.itemId);
    }
    if (inboxMatch?.action === 'confirm-risk' && request.method === 'POST') {
      return await handleConfirmRisk(request, env, inboxMatch.itemId);
    }
    if (inboxMatch?.action === 'send' && request.method === 'POST') {
      return await handleSend(request, env, inboxMatch.itemId);
    }

    if (url.pathname === '/projects' || url.pathname.startsWith('/projects/')) {
      return await handleProjectsRoute(request, env);
    }

    return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  },

  async scheduled(event, env) {
    const now = event?.scheduledTime || Date.now();
    await runDigestSchedule(env, { now });
    await runWeeklyReportSchedule(env, { now });
    if (env.PROJECT_DB) {
      try {
        const channels = await listAllChannelLinksBySource(env.PROJECT_DB, { source: 'chatwork' });
        const staffMap = await loadStaffMap(env.PROJECT_DB);
        await runChatworkSync(env, env.PROJECT_DB, channels, staffMap);
      } catch {
        // Chatwork API障害でdigest/weekly-reportを道連れにしない
      }
    }
  }
};
