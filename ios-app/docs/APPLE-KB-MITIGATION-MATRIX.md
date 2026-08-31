# Apple rejection KB mitigation matrix

| KB case | Risk | PR-8 mitigation |
|---|---|---|
| v1.0.4 | Reviewer sees no login page | `www/app.js` NativeAuthGate routes unauthenticated native users to `#/sign-in`; legal and deletion routes are allowlisted. |
| v1.0.5 | Demo account does not exist or password is wrong | `scripts/verify-reviewer-account.mjs --provision` can create/check the account, and default verify performs a real `/auth/login`. |
| v1.0.6 | ASC stale demo credentials or stale notes override env/current text | `appstore-submit.mjs` keeps demo account env-first and always pushes `review-notes/CURRENT-en.txt`. |
| v1.0.7 | Screenshots show only login | `store-assets/screenshot-plan.json` uses authenticated `authTabs`; capture script fails closed without reviewer credentials. |
| v1.0.8 | Old login screenshot remains in slot 1 | Copied `scripts/lib/asc-screenshot-upload.mjs` deletes existing screenshots before re-upload; slot 1 is the inbox screen. |
| §4 Design | Login opens external Safari due missing allowNavigation | `capacitor.config.json` includes production domain, Worker domain, `appleid.apple.com`, and `*.apple.com`. |
| §4.8 | Third-party login triggers Sign in with Apple requirement | iOS `www/` exposes only email/password; no Google/social login UI or Gmail OAuth. |
| §5.1.1(v) | No account deletion inside app | Settings links to `#/account/delete`, which calls `POST /account/delete` in app. |
| §3.1.3(f) | Purchase traces or external purchase CTA in app | iOS ships local `www/`; lint fails on billing/IAP/upgrade/purchase/paywall/trial traces in the shipped webDir. |
