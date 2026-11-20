# MVP Scope and Current Milestone

**Status:** Proposal for review. This scope is not approved until the open questions below are resolved.

The Secure Offline Travel Memories milestone adds completed-day memories,
on-device image handling, accessible input feedback/toasts and opt-in read-only
snapshots. The owner selected the seven-day/clear-on-sign-out privacy policy;
overall release approval and infrastructure/recovery gates remain open.
See [release evidence](docs/RELEASE_GATES.md).

## Outcome

A trip owner can manage a trip, its itinerary, place-based route previews, and shared trip expenses from a mobile-friendly web application. The first release validates the core planning workflow and chosen identity, API, and storage approach before adding collaboration.

## Included

- An authenticated user can create, view, update, and archive their own trip.
- A trip includes a name, primary destination as plain text, start and end dates, and an IANA timezone.
- The owner can add, view, update, and remove itinerary activities.
- An activity includes a title, start and end time, and optional notes; activities are displayed chronologically in the trip timezone.
- The owner can search for and attach a place to an itinerary activity.
- A map view shows located activities in itinerary order and a driving-route estimate between stops.
- Selecting a stop shows related place imagery in a carousel with a source link; destination-level fallback imagery is clearly labeled.
- The owner can set a trip budget and currency, record expenses, identify the payer, and include participants in each split.
- Equal splits allocate any minor-unit remainder deterministically; custom shares must sum exactly to the expense total.
- The finances view shows total spending, remaining budget, each participant's net balance, and suggested settlements.
- Server-side authorization prevents one user from reading or changing another user's trips.
- Validation provides clear errors for invalid dates, missing required values, and an activity end time that does not follow its start time.
- The app works at phone and desktop widths. Writes require connectivity; opted-in
	users can read unexpired snapshots with their restored session offline.
- Completed days across active and archived trips appear in a memory calendar.
- Photos remain on-device: 30 MiB per input image, best-effort local JPEG
	compression, five activity images and one outfit image.
- Currency conversion uses an explicit reference-rate preview and atomic update.

## Deferred

- Inviting participants, contributor/viewer roles, and suggestion approval workflows.
- Production-grade map/routing/photo providers, multiple travel modes, turn-by-turn navigation, and live traffic.
- Multiple currencies within one trip and settlements across currencies.
- Reservations and storage of booking confirmation details.
- Offline writes, background write queues and cloud photo sync.
- Push notifications, email invitations, and activity history beyond operational diagnostics.

Production maps/routing, offline writes, and group
suggestion approvals are explicitly out of scope for the first release. The current
map and photo implementation is a prototype using public services, not a
production availability or privacy guarantee. Deferred features remain
part of the product direction, but are not acceptance criteria for this
release.

## Acceptance Criteria

1. An unauthenticated request cannot read or modify trip data.
2. A second authenticated user cannot read, update, or archive the first user's trip, including by guessing or supplying its ID.
3. An owner can create a trip, add at least one activity, and see activities ordered by their start time after reloading the application.
4. Editing or removing an activity updates the authoritative record; retries do not create duplicate activities.
5. Trip dates are treated as calendar dates in the trip's declared timezone. Activity times display consistently in that timezone, including across daylight-saving transitions.
6. API failures and validation errors do not leave a success state in the UI when the server did not persist the change.
7. The core workflow is usable on a phone viewport and a desktop viewport.
8. The map can display located activities in itinerary order and request a driving-route estimate when at least two stops have coordinates.
9. The selected stop shows a photo carousel with links to image sources; when no place-specific images are found, destination imagery is labeled as such.
10. Expense amounts are stored as integer minor units in one selected trip currency; custom splits cannot be saved unless their shares sum exactly to the expense total.
11. Equal splits sum exactly to the total, including currencies whose total does not divide evenly among participants.

## Proposed End-to-End Check

Using two test accounts, sign in as the first user, create a trip and two activities, and verify chronological display after reload. Sign in as the second user and confirm the trip is not visible or accessible through direct API requests. Then retry an activity creation after simulating a lost response and confirm that only one activity exists.

## Open Questions

- Is an owner-only first release acceptable, with group collaboration explicitly following later?
- Is Firebase Authentication with Firestore Security Rules acceptable for the owner-only first release, with cross-user collaboration deferred?
- Which production maps, routing, and photo providers meet privacy, attribution, availability, and budget requirements?
- Accept the existing USD/CAD/EUR/GBP/JPY/AUD/PHP set and explicit reference-rate conversion, or revise before release?
- Accept the implemented Firestore repository after identity/retry/recovery gates pass?
- Should trip archive be included in the first release, or should trips only be editable until deletion policy is decided?

## Exit Gate

Do not treat this proposal as implementation-ready until the product owner approves the included/deferred boundary and the identity and persistence decisions have passed their validation gates in [`DECISIONS.md`](DECISIONS.md).
