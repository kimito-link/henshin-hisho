# PR-4c Manual Checklist

- Login: existing user can log in and see account status.
- Signup: new user receives a 14-day trial state.
- Paste flow: paste message body, assess it, and see it appear in one of the 9 shelves.
- Draft flow: select an item, enter secretary instruction and tone, generate a draft.
- High risk flow: high-risk item shows confirmation checkbox and blocks draft until confirmation.
- Account deletion: settings screen deletes the account and returns to auth view.
- PWA: `manifest.webmanifest` is present, `sw.js` registers, app has a standalone start URL, and the shell loads offline after first visit.
- Billing isolation: billing UI is contained under `app/billing/` for later iOS exclusion.
