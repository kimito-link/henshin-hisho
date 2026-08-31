# AI返信秘書 App Worker

Cloudflare Worker for the AI返信秘書 PWA. This Worker is independent from the Chrome extension and the existing license Worker.

## Setup

Create KV:

```bash
wrangler kv namespace create APP_KV
wrangler kv namespace create APP_KV --preview
```

Copy the generated IDs to `wrangler.toml`.

Set secrets:

```bash
wrangler secret put SESSION_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put MAIL_FROM
wrangler secret put MAIL_REPLY_TO
wrangler secret put OPENROUTER_API_KEY
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

Use `.dev.vars.example` only for dummy local values.

## Endpoints

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/magic-link`
- `GET /account`
- `POST /account/delete`
- `POST /inbox/assess`
- `GET /inbox`
- `POST /inbox/:id/confirm-risk`
- `POST /inbox/:id/draft`
- `POST /inbox/:id/send` (LINE only; explicit human send confirmation required)
- `POST /connectors/line/webhook`
- `POST /connectors/gmail/connect` (disabled while `GMAIL_CONNECT_ENABLED=false`)
- `POST /account/link-license`

Sessions are bearer tokens. Passwords are stored as PBKDF2 hashes, never as plaintext.

`/inbox/assess` stores pasted or connector-originated messages in the common inbox schema. `channel:'paste'` works without Gmail or LINE connection. High-risk items require `/inbox/:id/confirm-risk` before draft generation.

LINE webhook requests must pass `x-line-signature` verification. LINE send is restricted to `channel:'line'` items and requires both risk confirmation (when high risk) and `confirmSend:true` in the request body.

Gmail is intentionally a stub in PR-4d. Keep `GMAIL_CONNECT_ENABLED=false` until CASA approval and the dedicated Gmail implementation PR.

`/account/link-license` accepts an existing `gs_` extension license key and verifies it through the license Worker `/verify` endpoint before marking the PWA account active.

## KV Keys

```text
users:<userId>
email-index:<email>
session:<token>
magic:<token>
inbox:<userId>:<itemId>
line-user:<lineUserId> -> userId
```

## Tests

```bash
npm test
```
