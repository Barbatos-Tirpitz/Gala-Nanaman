# Phase 0 Decisions and Validation

This log records choices that must be resolved before the dependent feature work begins. Recommendations below are proposals, not approved architecture decisions.

## Decision Status

Use `Open`, `Proposed`, `Accepted`, or `Rejected`. Record the decision and pass/fail evidence before treating a gate as complete.

## D-001: Identity and Backend Deployment

**Status:** Proposed (implementation in progress)  
**Owner:** Sole developer (product owner)

**Context:** The MVP needs a verified sign-in identity and authorization enforced at the database boundary. A client-supplied user ID is not proof of identity.

**Options to evaluate:** Firebase Authentication with Firestore Security Rules, or another managed identity/database stack if Firebase fails the release gate.

**Recommendation:** Proceed with Google sign-in through Firebase Authentication and owner-scoped Firestore Rules. The Firebase web config is public; service-account credentials must never be shipped to the browser.

**Validation gate:** Configure a Firebase project, deploy `firestore.rules`, and pass the emulator tests. With two separate accounts, prove unauthenticated access fails and account B cannot read, update, or add subcollection records to account A's trip by supplying its ID.

**Decision due:** Before production trip data is entered.

## D-002: Dates, Times, and Money Semantics

**Status:** Proposed  
**Owner:** Sole developer (product owner)

**Context:** Travel plans cross time zones and daylight-saving transitions. Expense balances require consistent currency and exact split rounding.

**Recommendation:** Store trip dates as calendar dates with an IANA timezone.
Activity HH:MM values are trip-local planning wall times, not verified instants.
Overnight activities require separate dates; DST ambiguity is not resolved to an
instant. Use integer minor units, one currency per trip, deterministic equal-split
remainders and exact custom shares. Existing conversion uses an explicit dated
reference-rate preview and atomic budget/expense replacement; accepting this
policy remains an owner gate.

**Validation gate:** Agree on midnight, DST and different-device-timezone examples.
Verify exact split rounding, rejection of a one-minor-unit discrepancy, and failed
or retried conversions. Explicitly approve the conversion policy before closure.

**Decision due:** Before finalizing the trip/itinerary and expense data contracts.

## D-003: Firestore Writes, Retries, and Recovery

**Status:** Proposed  
**Owner:** Sole developer

**Context:** Firestore provides atomic writes for a document or batch, but clients may retry after a response is lost and multi-document workflows need explicit transaction boundaries.

**Options to evaluate:** Use stable document IDs and idempotent `setDoc` operations for single-record writes; use Firestore transactions or batches for multi-document changes.

**Recommendation:** Keep MVP write paths simple, use stable IDs, and do not claim a sequence of independent writes is atomic. Add transactions only when a workflow requires them.

**Validation gate:** Exercise duplicate retries, concurrent updates, and owner denial using the Firestore emulator. Document Firestore export/restore and run a restore rehearsal before storing real user trip data.

**Decision due:** Before production data; transaction rules before any multi-document workflow.

## D-004: Offline Cache Privacy and Retention

**Status:** Accepted milestone policy; release verification pending  
**Owner:** Sole developer (product and security owner)

**Context:** A PWA cache can retain trip details on a shared or lost device after logout or membership changes. Offline data is a read-only snapshot, not an independent source of truth.

**Decision (owner direction, 2026-11-19):** Opt-in read-only trip snapshots are
scoped to a restored Firebase session, expire seven days after server-verified
sync, and clear on explicit sign-out, account change, consent withdrawal or
detected online access denial. Snapshot schemas allowlist trip/itinerary/expense
fields, excluding credentials, unknown fields and booking references. Switching
off Offline copy clears the snapshot. Local browser storage is not encrypted or
safe against device users; offline revocation cannot be checked and expiry runs
when the app executes, not as guaranteed timed deletion. Local photo blobs remain
separate until removed or browser data is cleared. No photo sync or write queue.

**Validation gate:** Inspect browser storage after logout and after removing access to a trip; confirm protected data is removed or rendered inaccessible. Verify cache expiry and clear-data behavior on supported browsers and devices.

**Decision due:** Before enabling offline trip data.

## D-005: Usage Limits on the Free Plan

**Status:** Accepted (Spark plan)  
**Owner:** Sole developer

**Context:** Map, route, and photo lookups call free public services from the browser. Server-enforced per-account limits need an authenticated proxy such as Cloud Functions, which requires the Blaze plan.

**Decision:** Enforce daily per-account limits in the app (200 place searches, 100 route requests, 100 photo searches), stored per browser and keyed by Firebase UID, and cache repeated lookups in memory. Firestore Rules validate document shapes and sizes.

**Consequences:** The limits are fair-use controls, not a security boundary; a user can bypass them by calling the public services directly. Firestore free-tier quotas remain project-wide, and Rules cannot cap per-account reads. Managed Firestore exports also require billing, so backups need another method on Spark.

**Decision due:** Revisit before upgrading to Blaze or adopting a keyed or paid map provider.

## Phase 0 Completion

Phase 0 is complete only when:

- The sole developer, acting as product owner, reviews and accepts the proposed MVP scope, including the deferred features.
- D-001 has an accepted identity/deployment decision and passes its two-account authorization gate.
- D-002 has agreed date/time rules for the first-release data contract.
- D-003 has an accepted persistence choice, retry/recovery behavior, and a successful failure/recovery rehearsal appropriate to the selected store.
- D-004 remains explicitly deferred or has an accepted policy before any trip data is cached offline.

## Local Validation Update: 2026-11-19

Owner-isolation and photo-limit emulator tests pass locally. This does not accept
D-001/D-003 or prove production configuration, two real accounts or recovery.
See [release gates](docs/RELEASE_GATES.md). Rules enforce ownership, shape, types,
lengths, amounts and activity dates within trip bounds. Client-side real-calendar,
IANA timezone, split-sum and participant checks are additional UX/data-quality
checks, not a guarantee against malicious direct writes.
