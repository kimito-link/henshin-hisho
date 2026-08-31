#!/usr/bin/env node
import { loadAppConfig } from './lib/app-config.mjs';

const config = loadAppConfig();
const apiBase = process.env.IOS_REVIEW_API_BASE || config.backend?.apiBase || 'https://henshin-hisho-app.info-a40.workers.dev';
const email = process.env.IOS_REVIEW_DEMO_USERNAME || config.review?.demoAccountEmail || '';
const password = process.env.IOS_REVIEW_DEMO_PASSWORD || '';
const shouldProvision = process.argv.includes('--provision') || process.env.IOS_REVIEW_PROVISION === '1';

function fail(message) {
  console.error(`FAIL reviewer-account: ${message}`);
  process.exit(1);
}

async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('IOS_REVIEW_DEMO_USERNAME must be a complete email address.');
}
if (!password || password.length < 8) {
  fail('IOS_REVIEW_DEMO_PASSWORD must be set and at least 8 characters.');
}

if (shouldProvision) {
  const { response, json } = await post('/auth/signup', { email, password });
  if (response.ok && json.ok === true) {
    console.log(`OK reviewer-account provisioned: ${email}`);
  } else if (response.status === 409 || json.reason === 'email_already_registered') {
    console.log(`OK reviewer-account already exists: ${email}`);
  } else {
    fail(`provision failed: status=${response.status} reason=${json.reason || 'unknown'}`);
  }
}

const { response, json } = await post('/auth/login', { email, password });
if (!response.ok || json.ok !== true || !json.token) {
  fail(`verify_password failed: status=${response.status} reason=${json.reason || 'unknown'}`);
}

console.log(`OK reviewer-account verify_password: ${email}`);
