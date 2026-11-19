# Milestone Evidence and Release Gates

Recorded 2026-11-19. Local implementation is not production approval.

## Local Evidence

- 40 unit tests pass: calendar, recap, runtime validation, image limit, URL allowlist,
  IndexedDB opt-in/expiry/account isolation and repository read-only behavior.
- Production TypeScript/Vite build generates a versioned static app-shell worker.
- Nine Firestore emulator tests pass owner isolation, schemas, activity date bounds,
  exact 30 MiB image-reference boundaries, stable-ID retries and concurrent SDK
  transactions. Simulated identities do not replace two real accounts or a
  response-loss rehearsal against the actual application.
- Mobile 320px and desktop workflow checks run in installed Edge. Chromium download
  is blocked by the local certificate chain; TLS verification was not disabled.
  Thirteen browser checks pass: workflow cases use the development-only local repository,
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

## Map Cache and Google Maps Milestone

Implemented: shared canonical OSM tile configuration, browser-managed HTTP tiles,
account-separated opt-in lookup storage, bounded memory/IndexedDB caches, HTTP
cache directive handling, TTL and seven-day maximum retention, 200-entry / 5 MiB
budget, explicit clear controls, quota-on-provider-fetch accounting, throttle
backoff and supported cross-tab Web Locks. Sign-out/offline-consent withdrawal
also clear query history. Generation tokens prevent old entries/in-flight results
from being reused after clearing, including delayed cross-tab notifications.

Photon search/reverse results are persistent only with a restored UID, existing
offline-copy consent and separate map-history consent. OSRM route and Wikimedia
metadata results remain session-memory-only pending current provider terms review.
Tile/remote-image HTTP caches are browser-managed and cannot be guaranteed erased
by sign-out. No service-worker tile/API cache or offline-area download was added.

Google Maps search and destination-only directions links are available from
itinerary, map details and Memories without a Maps API key/SDK. Tests verify fixed
HTTPS URLs, encoded inputs, no unsolicited Google Maps request and mobile/desktop
rendering. Four map browser cases use intercepted provider/tile fixtures and a
test-only mocked identity; no automated panning against public OSM was performed.
They prove explicit opt-in, reuse after reload without another fetch/quota count,
clear/revoke behavior, shared requests across supported tabs and clear-during-fetch
invalidation. Screenshots: `test-results/leaflet-cache-390.png` and
`test-results/leaflet-cache-1440.png`.

Still unverified: real-account/device lifecycle, native universal-link/system-
browser launching, native OSM request identification, and human verification of
actual provider HTTP revalidation. Those remain release checks; fixture tests
do not establish provider availability, live traffic accuracy or native support.

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