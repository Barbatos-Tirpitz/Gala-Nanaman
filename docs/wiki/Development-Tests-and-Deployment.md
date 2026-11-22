# Development, Tests, and Deployment

## Prerequisites and configuration

Use the repository's supported Node.js version from CI (Node 22). Firebase
configuration is supplied through Vite environment files; `.env.example`
documents the expected public client keys. Production builds require Firebase
configuration. Without it, local development uses the browser prototype
repository.

Firebase Auth and Firestore emulators are available through the project
configuration. The Rules test command requires Java; CI currently configures
Java 17.

## Validation commands

| Command | Purpose |
| --- | --- |
| `npm run check` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Vitest unit tests |
| `npm run build` | Type check and Vite production build |
| `npm run test:rules` | Firestore Rules tests using the emulator |
| `npm run test:browser` | Playwright browser tests |

The default CI workflow runs the lockfile guard, installs the lockfile-locked
dependencies, runs unit tests and the production build, and validates Firestore
Rules. Browser tests are a separate command. See `docs/RELEASE_GATES.md` for
what current automated evidence does and does not establish.

## Firebase deployment

`firebase.json` configures Hosting to serve `dist`, rewrites application routes
to `index.html`, and points Firestore to `firestore.rules` and
`firestore.indexes.json`. Hosting and Firestore Rules are deployed separately.
The README's Firebase setup section documents the project aliases, required
GitHub Actions secrets, and development/production deployment commands.

The merge Hosting workflow deploys to production after a push to `main`. The PR
workflow builds a preview only for same-repository pull requests. A separate
Android workflow builds a debug APK; that artifact is not a signed store
release.

## Native builds

Capacitor packages the web app. Android and iOS builds require platform
toolchains and platform-specific Firebase configuration. The README's Mobile
Builds section contains the current setup steps and limitations.

## Safe operational practices

- Verify the Firebase project/alias before deploying, especially to production.
- Deploy and test Firestore Rules independently from Hosting.
- Keep service-account JSON in GitHub Actions secrets only; do not log or commit it.
- Treat local prototype data and emulator tests as development evidence, not
  production authorization.
- Consult [Release Gates](../RELEASE_GATES.md) before treating the app as
  production-ready.
