# Data Model and Validation

## Client model

The primary types are in `src/types.ts`. A `Trip` contains its activities and
expenses as arrays in the client model:

```text
Trip
  id, name, destination, startDate, endDate, timeZone
  currencyCode, budgetMinor, archived?, completedDayDates?
  activities: Activity[]
  expenses: Expense[]
```

An `Activity` has an ID, calendar date, start/end wall-clock times, category,
notes, optional place coordinates, and optional photo references. An `Expense`
has an ID, date, title, amount in minor currency units, payer display name,
splits, and an optional linked activity ID. Expense participant names are
display labels, not authenticated user identities.

## Firestore layout

The repository stores records as:

```text
trips/{tripId}
  ownerId, updatedAt, trip fields
trips/{tripId}/activities/{activityId}
  activity fields
trips/{tripId}/expenses/{expenseId}
  expense fields
```

Document IDs are mapped to `id` fields when data is read. Activity and expense
arrays are assembled from their subcollections; they are not embedded in the
trip document. `ownerId` and server `updatedAt` are added by the Firestore
repository and stripped from the client-facing `Trip`.

The browser prototype adapter stores a complete trip array in local storage.
This format is intentionally distinct from the Firestore document layout.

## Validation boundaries

`src/validation.ts` uses Zod for runtime validation of IDs, dates, times,
coordinates, text lengths, currencies, photo references, expenses, and trips.
The repository adapters validate before writes and validate loaded trip data.

`firestore.rules` independently checks authentication, ownership, allowed field
sets, data types, and key limits at the database boundary. Rules require
`updatedAt == request.time` on trip writes. Rule validation is essential because
the browser and its validation code are not trusted.

Examples of current constraints include:

- Trip dates are valid calendar dates with the end not before the start.
- Activity start/end times use 24-hour `HH:mm` form, with end later than start.
- Activity coordinates stay within latitude/longitude ranges.
- Trip currencies are `USD`, `CAD`, `EUR`, `GBP`, `JPY`, `AUD`, or `PHP`.
- Expense splits must sum exactly to the expense total in client validation;
  participant names must be distinct and include the payer.
- Photo references have a maximum of five activity photos and individual image
  size is capped at 30 MiB.

Firestore Rules cannot iterate all expense split entries to verify the sum, so
that invariant is enforced by application validation. Never treat a client-only
check as authorization.

## Currency representation

Amounts are stored as integer minor units, with the number of decimal places
derived from `Intl.NumberFormat` for the currency. This avoids storing
floating-point currency values. See
[Photos, Expenses, and Currency](Photos-Expenses-and-Currency.md) for split and
conversion behavior.
