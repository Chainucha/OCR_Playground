# Sign in

A teammate opens the playground, sees an email and password form with no way to create an account, signs in with an invited account, and reaches the playground. Signing out returns them to the form.

## Sub-features

- `sign-in-form` shows Email, Password, Sign in, and Forgot your password, with no sign-up tab.
- `sign-in-success` signs in an invited user and shows the playground with their email in the header.
- `sign-out` returns to the sign-in form.
- `sign-in-reject` refuses a wrong password with an error message.

## How to get to it (user POV)

- Open the site root. Every page sits behind the sign-in form.
- Choose `Sign out` in the header to leave.

## Driving it with agent-browser

Preconditions:

- Baseline preconditions from the README hold.

- **Form.** Run `agent-browser open http://localhost:3100` and `agent-browser wait 'input[name="username"]'`. `agent-browser snapshot` shows textboxes `Email` and `Password`, buttons `Sign in` and `Forgot your password?`, and no `Create Account` tab.
- **Sign in.** Run `agent-browser fill 'input[name="username"]' 'verify@example.com'`, `agent-browser fill 'input[name="password"]' 'Verify-Pass-123!'`, `agent-browser click 'button[type="submit"]'`, then `agent-browser wait 'main'`. The snapshot shows heading `OCR Playground`, the text `verify@example.com`, and a `Sign out` button. `.verify/logs/cognito.log` gains `POST /` lines.
- **Sign out.** Run `agent-browser click 'header button'` and `agent-browser wait 'input[name="username"]'`. The form is back, and `main` is gone.
- **Proof.** Save screenshots to `.verify/evidence/sign-in/01-sign-in-form.png` and `02-signed-in.png`, plus `agent-browser snapshot > .verify/evidence/sign-in/02-signed-in.aria.txt`.

## Gotchas

- Local Cognito (moto) accepts any password for an existing user. `sign-in-reject` cannot be verified locally. Report it as unverified with the reason "needs a real Cognito pool (`npx ampx sandbox`)". Don't count a local wrong-password sign-in as a product bug.
- `agent-browser wait 'text=Sign out'` does not wait for text. Use `agent-browser wait 'main'` or `agent-browser wait --text 'Sign out'`.
- The session persists in the `ocr-verify` browser session. Sign out, or close the session, before re-proving `sign-in-form`.
