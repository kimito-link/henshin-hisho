# Apple Rejection Reply Templates

## 2.1(a) Login access

Hello App Review team,

The app now opens directly to the sign-in screen for unauthenticated users. Please use the demo credentials in App Review Information:

- Email: apple-reviewer@henshin-hisho.link
- Password: provided in App Review Sign-In Information
- 2FA: disabled

We verified the credentials with our pre-submit check immediately before this reply.

## 2.3.3 Screenshots

Hello App Review team,

We replaced the screenshots with authenticated in-app dashboard screenshots. The upload script deletes the old screenshot set before re-uploading, so the first screenshot slot now shows the current inbox screen.

## 3.1.3(f) / 2.1(b) Business model

Hello App Review team,

This is a free B2B companion app. It contains no in-app purchase, no purchase link, no paywall, and no call to action for external purchase. Commercial contracts are handled outside the app. The app is a free operational dashboard for authorized business users.

## 4.8 Login Services

Hello App Review team,

The iOS app uses only our company's email/password account system. It does not expose Google login, social login, or Gmail OAuth in the iOS app. The applicable Guideline 4.8 carve-out is: "Your app exclusively uses your company's own account setup and sign-in systems."

## 5.1.1(v) Account deletion

Hello App Review team,

Account deletion is available inside the app at Settings -> Account -> Delete account. The confirmation screen calls POST /account/delete and signs the user out after deletion.
