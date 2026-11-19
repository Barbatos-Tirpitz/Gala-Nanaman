# Milestone Evidence and Release Gates

Recorded 2026-11-19. Local implementation is not production approval.

## Local Evidence

- 21 unit tests pass: calendar, recap, runtime validation, image limit, URL allowlist,
  IndexedDB opt-in/expiry/account isolation and repository read-only behavior.
- Production TypeScript/Vite build generates a versioned static app-shell worker.
- Nine Firestore emulator tests pass owner isolation, schemas, activity date bounds,
  exact 30 MiB image-reference boundaries, stable-ID retries and concurrent SDK
  transactions. Simulated identities do not replace two real accounts or a
  response-loss rehearsal against the actual application.
- Mobile 320px and desktop workflow checks run in installed Edge. Chromium download
  is blocked by the local certificate chain; TLS verification was not disabled.
  Nine browser checks pass: workflow cases use the development-only local repository,
  not real Firebase. They cover inert text rendering, date/time preservation,
  field feedback, failed saves, disconnected drafts, carousel navigation, actual
  JPEG compression/metadata and quota failure. The separate production-shell test
  confirms a service-worker offline reload and same-origin static precaching;
  it does not prove authenticated offline cold-start behavior.
  Real PNG/JPEG activity and outfit uploads were also tested at 390px and 1440px:
  previews, save/reload persistence, compressed-image decoding, carousel navigation,
  offline viewing, no upload requests, oversized-file rejection and photo-count
  rejection. Image screenshots are in `test-results/images-390.png` and
  `test-results/images-1440.png` after running the browser suite.

Reproduce: `npm test`, `npm run build`, `npm run test:rules`,
`npm run test:browser` (build first for the production-shell case). Java is needed
for Rules tests. For Edge in PowerShell,
set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` before browser tests; otherwise install
Chromium with `npx playwright install chromium`.

## Phase 0 and 1 Open Gates

| Gate | Evidence still needed |
| --- | --- |
| Scope | Owner acceptance of revised release scope and deferrals |
| Identity | Firebase values/domains and actual Google sign-in verification |
| Deployment | Deploy reviewed Rules; repeat real cross-account direct access attempts |
| Date/money policy | Accept trip-local wall times, DST limitations, exact minor-unit splits and explicit reference-rate conversion |
| Retry/concurrency | Emulator checks plus real app response-loss rehearsal |
| Recovery | Spark-compatible backup method and successful parent/subcollection restore |
| Providers | Privacy, attribution, availability and budget approval |
| Dependencies | Review npm audit findings and engine requirements; no silent mass-upgrades |

`npm audit --omit=dev` currently reports five high-severity production package
entries: `@capacitor-firebase/authentication`, `firebase`, `@firebase/firestore`,
`@firebase/firestore-compat` and `@grpc/grpc-js` (including transitive chains, not
necessarily five distinct advisories). No production critical finding was reported.
The full install audit also reports development-tool findings. Resolve and retest
compatible dependency upgrades before production release; these were not silently
mass-upgraded as part of the feature work.

Production account access and approvals are owner gates. Never request credentials
in chat, ship service-account keys to the browser or commit them.

## Recovery Rehearsal

Managed Firestore export/import requires billing. On Spark, select a reviewed
trusted Admin SDK backup/restore tool, run outside the browser with application-
default credentials on a trusted machine, and rehearse against a disposable
project/emulator first. Export trips plus nested activities/expenses, record counts
and checksums, restore to an empty target, compare every field/relationship and
owner ID, then rerun isolation tests. Firestore exports do not include IndexedDB
photos. Do not mark recovery passed until this actually runs.

## Phase 4 Integration Gates

Implemented: opt-in seven-day cache, restored-UID scoping, server-source reads,
offline write guards, online transactions, stale/sync status, clear-on-sign-out
and app-shell caching. No background write queue exists.

Before release, verify authenticated offline cold starts on supported browsers
and native devices, logout/deletion failures, cross-tab account changes, worker
upgrades, quota/eviction and reconnection against the configured project. Obtain
privacy/product approval. Test with representative users; internal tests do not
replace screen-reader, 200% zoom or participant evaluation.