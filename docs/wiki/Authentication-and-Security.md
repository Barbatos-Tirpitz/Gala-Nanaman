# Authentication and Security

## Identity and sign-in

`src/firebase.ts` initializes Firebase only when all required public web
configuration values are present. Browser sign-in uses Firebase's Google popup
flow. Capacitor native sign-in obtains a Google ID token with the native
authentication plugin and exchanges it for a Firebase credential.

`AuthProvider` observes Firebase Auth state and exposes the current user to the
app. In a configured build, cloud trip loading waits for a signed-in user. The
local prototype mode is used only when Firebase is not configured.

## Authorization boundary

Firestore Rules in `firestore.rules` require an authenticated request and
compare the signed-in UID with the owning trip's `ownerId`. Activity and expense
operations authorize against their parent trip. Every cloud operation must
remain protected by Rules; UI visibility and Zod checks are not access control.

The current model is owner-only. The collaboration design in
[`COLLABORATION.md`](../COLLABORATION.md) is a proposal, not an implemented
membership/role system.

## Configuration and credentials

- `VITE_FIREBASE_*` values configure a public Firebase web client and are
  included in the client build. They are not service-account credentials.
- Service-account JSON is a private deployment credential and belongs only in
  the protected GitHub Actions secret used by the Hosting workflow.
- Never put service-account keys in source, environment variables prefixed for
  Vite, or browser code.
- Separate development and production Firebase projects and deploy restrictive
  Firestore Rules. See the README's Firebase setup section for the current
  project aliases and deployment procedure.

## Trust and privacy boundaries

- Browser-side daily lookup limits are advisory, not server-enforced quotas.
- Local storage and IndexedDB are not encrypted against other users of the
  device/browser profile.
- External map, routing, photo, and currency providers receive the query data
  necessary for the requested operation. See
  [Maps and External Integrations](Maps-and-External-Integrations.md).
- Activity and outfit image blobs are stored locally; Firestore holds their
  references, not uploaded image files.
- The PWA service worker caches the static application shell, not authenticated
  Firestore responses.

## Security test surface

Firestore ownership, schema, and authorization behavior is exercised with the
Rules unit-testing library and Firebase Emulator. These tests complement but do
not replace review and deployment of the Rules to the intended Firebase project.
