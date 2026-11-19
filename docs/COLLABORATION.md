# Phase 3: Owner-Controlled Collaboration

Status: design proposal, not implemented. Existing trips remain owner-only.

## Permissions

| Action | Owner | Contributor | Viewer |
| --- | --- | --- | --- |
| Read trip, itinerary, expenses | Yes | Active members only | Active members only |
| Edit authoritative records | Yes | No | No |
| Submit itinerary/expense suggestions | Yes | Yes | No |
| Revise/cancel own pending proposal | Yes | Yes | No |
| Approve/reject/request revision | Yes | No | No |
| Invite/remove members/change roles | Yes | No | No |

The trip's `ownerId` is authoritative and cannot change through member documents.
Expense participants remain display names; do not silently convert them to UIDs.

## Data Contracts

- `trips/{tripId}/members/{uid}`: contributor/viewer role, active/removed status,
  joined timestamp, inviter UID. Ownership comes from the trip.
- `invitations/{opaqueId}`: trip, proposed role, inviter, expiry, status, intended
  recipient. Tokens must be unpredictable, single-use and accepted by a verified
  recipient. No public invitation listings or client self-assignment of roles.
- `trips/{tripId}/suggestions/{id}`: author UID, typed operation, target ID,
  allowlisted proposed fields, expected target version, revision, timestamps,
  status and owner feedback. Begin with activity/expense create/update/remove in
  the trip currency. Trip-wide changes remain owner-only.
- `trips/{tripId}/activityLog/{decisionId}`: actor, suggestion/revision IDs,
  decision, target versions and server timestamp. Append-only; exclude credentials
  and unnecessary copies of notes/photos.

Use versioned migrations and corresponding Rules changes. Device-local photo
references do not make image files available to other members.

## State and Atomicity

`PENDING -> APPROVED | REJECTED | NEEDS_REVISION | CANCELLED`.
Only owners decide; authors may cancel/revise their own proposals. Resubmission
increments revision, preserving previous decisions. Approved revisions are immutable.

Approval rechecks current permissions, status, revision, target version and full
payload validation. Apply authoritative changes, suggestion decision and a
deterministic log entry atomically in one transaction. Reject stale versions as
conflicts, not silent overwrites. Stable IDs make response-loss retries idempotent.

Preferred implementation: an authenticated trusted callable backend performing
the transaction, with decision/log writes denied to clients. Billing/deployment
approval is required; do not assume Cloud Functions can ship on Spark. A client
transaction alternative needs a separate `getAfter` Rules design proving all
coupled changes, plus adversarial tests. Do not ship partial client-only approval.

## User Experience

Invitations show the proposed role and require acceptance. Pending proposals stay
separate from the official itinerary. Owner review shows before/after values,
submitter, conflicts and effects on linked expenses. Use explicit decisions,
inline revision feedback and persisted-result toasts. Preserve drafts/context on
failure; viewers receive no edit controls.

Online removal must deny reads and invalidate detected local snapshots. Existing
offline copies cannot be remotely revoked; seven-day expiry is not a security
guarantee. Revisit offline policy before collaboration release.

## Tests and Open Decisions

Required emulator tests: outsider/unauthenticated denial; viewer write denial;
contributors cannot self-promote, spoof authors, edit official data, approve or
rewrite history; removed members lose access; cross-trip/malformed proposals fail;
concurrent/repeated approvals apply once; stale targets/revisions fail atomically.

Owner decisions: invite delivery/recipient verification and billing, member-visible
history fields, feedback retention, removal UX, and additional suggestion kinds.