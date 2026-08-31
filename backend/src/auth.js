import {
  createOpaqueToken,
  createSignedSessionToken,
  hashPassword,
  nowSeconds,
  sessionTtlSeconds,
  verifyPassword,
  verifySignedSessionToken
} from './crypto.js';
import {
  emailIndexKey,
  getJson,
  getUser,
  getUserIdByEmail,
  magicKey,
  normalizeEmail,
  putJson,
  putUser,
  sessionKey
} from './kv.js';
import { sendMail } from './mailer.js';
import { normalizeText } from './schema.js';

const TRIAL_SECONDS = 60 * 60 * 24 * 14;

function isValidEmail(email) {
  return email.length > 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return String(password || '').length >= 8;
}

function publicUser(user = {}) {
  return {
    id: user.id,
    email: user.email,
    trialEndsAt: user.trialEndsAt,
    createdAt: user.createdAt
  };
}

function randomUserId() {
  return createOpaqueToken('user');
}

export function accountPlan(user = {}, now = nowSeconds()) {
  const currentPeriodEnd = Number(user.licenseCurrentPeriodEnd || 0);
  if (user.plan === 'active' && (!currentPeriodEnd || currentPeriodEnd > now)) {
    return {
      plan: 'active',
      trialEndsAt: user.trialEndsAt || 0,
      currentPeriodEnd,
      licenseKeyLinked: Boolean(user.licenseKey)
    };
  }
  if (Number(user.trialEndsAt || 0) > now) {
    return {
      plan: 'trial',
      trialEndsAt: user.trialEndsAt,
      trialDaysRemaining: Math.max(0, Math.ceil((user.trialEndsAt - now) / 86400)),
      currentPeriodEnd,
      licenseKeyLinked: Boolean(user.licenseKey)
    };
  }
  return {
    plan: 'expired',
    trialEndsAt: user.trialEndsAt || 0,
    trialDaysRemaining: 0,
    currentPeriodEnd,
    licenseKeyLinked: Boolean(user.licenseKey)
  };
}

export async function createSession(env, userId) {
  const token = await createSignedSessionToken(env, userId);
  const payload = await verifySignedSessionToken(env, token);
  await putJson(
    env,
    sessionKey(token),
    { userId, createdAt: nowSeconds(), expiresAt: payload.exp },
    { expirationTtl: sessionTtlSeconds() }
  );
  return token;
}

export async function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, body: { ok: false, reason: 'missing_session' } };

  const payload = await verifySignedSessionToken(env, token);
  if (!payload) return { ok: false, status: 401, body: { ok: false, reason: 'invalid_session' } };

  const session = await getJson(env, sessionKey(token));
  if (!session || session.userId !== payload.sub || Number(session.expiresAt || 0) < nowSeconds()) {
    return { ok: false, status: 401, body: { ok: false, reason: 'session_not_found' } };
  }
  const user = await getUser(env, session.userId);
  if (!user) return { ok: false, status: 401, body: { ok: false, reason: 'user_not_found' } };
  return { ok: true, token, user };
}

export async function signup(env, { email, password } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) return { status: 400, body: { ok: false, reason: 'invalid_email' } };
  if (!isValidPassword(password)) return { status: 400, body: { ok: false, reason: 'weak_password' } };
  if (await getUserIdByEmail(env, normalizedEmail)) {
    return { status: 409, body: { ok: false, reason: 'email_already_registered' } };
  }

  const now = nowSeconds();
  const user = {
    id: randomUserId(),
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    trialEndsAt: now + TRIAL_SECONDS,
    plan: 'trial',
    digest: {
      enabled: true,
      hour: 8,
      timezone: 'Asia/Tokyo',
      channel: 'email'
    },
    weeklyReport: {
      enabled: true
    },
    avgCaseValue: 0,
    createdAt: now,
    updatedAt: now
  };
  await putUser(env, user);
  await env.APP_KV.put(emailIndexKey(normalizedEmail), user.id);
  const token = await createSession(env, user.id);
  return {
    status: 200,
    body: {
      ok: true,
      token,
      user: publicUser(user),
      account: accountPlan(user, now)
    }
  };
}

export async function login(env, { email, password } = {}) {
  const normalizedEmail = normalizeEmail(email);

  // App Review Bypass & Auto-seed
  if (normalizedEmail === 'appreview@best-trust.biz' && password === 'pass304130') {
    const reviewUserId = await getUserIdByEmail(env, normalizedEmail);
    let reviewUser = reviewUserId ? await getUser(env, reviewUserId) : null;
    
    // Auto-create or repair if missing
    if (!reviewUser) {
      const now = nowSeconds();
      reviewUser = {
        id: createOpaqueToken('user'),
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        trialEndsAt: now + 60 * 60 * 24 * 365 * 10, // 10 years
        plan: 'active',
        digest: { enabled: true, hour: 8, timezone: 'Asia/Tokyo', channel: 'email' },
        weeklyReport: { enabled: true },
        avgCaseValue: 0,
        createdAt: now,
        updatedAt: now
      };
      await putUser(env, reviewUser);
      await env.APP_KV.put(emailIndexKey(normalizedEmail), reviewUser.id);
      
      // Seed dummy inbox items for review
      try {
        const items = [
          {
            id: 'mock-item-1',
            status: 'needs_reply',
            subject: 'お見積もりの件',
            from: { name: 'テスト顧客', email: 'test@example.com' },
            body: '先日のお見積もりについて、詳細を伺えますでしょうか。',
            riskLevel: 'low',
            riskConfirmed: true,
            receivedAt: now * 1000,
            triage: { summary: '見積もりの詳細に関する問い合わせ' },
            draft: { body: 'お問い合わせありがとうございます。詳細についてご案内いたします。...' }
          },
          {
            id: 'mock-item-2',
            status: 'needs_human_review',
            subject: '至急：システム障害の報告',
            from: { name: 'システム管理者', email: 'admin@example.com' },
            body: '現在システムに障害が発生しています。至急対応をお願いします。',
            riskLevel: 'high',
            riskConfirmed: false,
            receivedAt: (now - 3600) * 1000,
            triage: { summary: 'システム障害の報告。至急対応が必要。' }
          }
        ];
        await putJson(env, `user:${reviewUser.id}:inbox`, { 
          items, 
          buckets: { needs_reply: [items[0]], needs_human_review: [items[1]] } 
        });
      } catch (e) {
        // Ignore seed errors
      }
    }
    
    const token = await createSession(env, reviewUser.id);
    return {
      status: 200,
      body: { ok: true, token, user: publicUser(reviewUser), account: accountPlan(reviewUser) }
    };
  }

  const userId = await getUserIdByEmail(env, normalizedEmail);
  const user = userId ? await getUser(env, userId) : null;
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { status: 401, body: { ok: false, reason: 'invalid_credentials' } };
  }
  const token = await createSession(env, user.id);
  return {
    status: 200,
    body: { ok: true, token, user: publicUser(user), account: accountPlan(user) }
  };
}

export async function requestMagicLink(env, { email } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) return { status: 400, body: { ok: false, reason: 'invalid_email' } };
  const userId = await getUserIdByEmail(env, normalizedEmail);
  const user = userId ? await getUser(env, userId) : null;
  if (!user) return { status: 200, body: { ok: true, mailed: false } };

  const token = createOpaqueToken('magic');
  const expiresAt = nowSeconds() + 60 * 15;
  await putJson(env, magicKey(token), { userId: user.id, email: normalizedEmail, expiresAt }, { expirationTtl: 60 * 20 });
  const baseUrl = normalizeText(env.APP_BASE_URL || 'https://henshin-hisho.link/app/');
  const mail = await sendMail(env, {
    to: normalizedEmail,
    subject: '【AI返信秘書】ログインリンク',
    text: [
      'AI返信秘書のログインリンクです。',
      '',
      `${baseUrl}?magic=${encodeURIComponent(token)}`,
      '',
      'このリンクは15分で期限切れになります。'
    ].join('\n')
  });
  return { status: 200, body: { ok: true, mailed: mail.ok, reason: mail.reason || '' } };
}

export async function linkLicense(env, user, { licenseKey } = {}, options = {}) {
  const key = normalizeText(licenseKey, 160);
  if (!key || key.length > 160) return { status: 400, body: { ok: false, reason: 'invalid_license_key' } };
  const verifyUrl = normalizeText(env.LICENSE_VERIFY_URL || 'https://gmail-secretary-license.info-a40.workers.dev/verify');
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey: key })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    return { status: 400, body: { ok: false, reason: 'license_verify_failed' } };
  }
  const updated = {
    ...user,
    plan: 'active',
    licenseKey: key,
    licenseCurrentPeriodEnd: Number(body.currentPeriodEnd || 0),
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  return { status: 200, body: { ok: true, account: accountPlan(updated), user: publicUser(updated) } };
}
