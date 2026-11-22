# Photos, Expenses, and Currency

## Activity and outfit photos

Image blobs are stored in the browser's IndexedDB database
`gala-nanaman-media`, object store `activity-photos`. Firestore trip/activity
records contain only a photo reference (`id`, name, MIME type, and size); the
binary image is not uploaded or synchronized to another device.

`src/photoProcessing.ts` allows JPEG, PNG, WebP, GIF, AVIF, HEIC, and HEIF files
up to 30 MiB each. JPEGs may be resized to a maximum 2560-pixel edge and
converted to WebP when the converted result is smaller. Other image types are
kept unchanged to preserve animation/transparency or unsupported browser
decoding. Per activity, Rules allow up to five activity photo references and
one outfit photo reference. The browser may evict local image data; cloud trip
records and offline snapshots are not image backups.

## Expenses and integer amounts

`src/money.ts` parses user-entered amounts into integer minor units and formats
them for display. Trip currency is restricted to the supported ISO codes in
validation and Rules. `src/expenses.ts` computes net balances from payer and
split entries and suggests settlements by matching debtors and creditors.

Splits use participant display names, not Firebase identities. Client validation
requires unique participant names, includes the payer, and ensures split
amounts sum to the expense total. Firestore Rules validate field shape and
bounds, but cannot iterate a list to enforce the split sum.

## Currency conversion

Changing the currency of an existing budgeted trip fetches the latest reference
rate from Frankfurter. The UI presents a dated preview before applying the
conversion. `src/currencyConversion.ts` rounds converted amounts into the
target currency's minor units and redistributes split rounding remainder so
converted splits still sum to the converted total.

When saved to Firestore, the trip fields and converted expense documents are
written in one transaction; conversion is capped at 499 expenses so the trip
document write remains within Firestore's 500-write transaction limit. Exchange
rates are reference rates and may differ from payment providers' rates. Only
currency codes are sent to Frankfurter; trip and expense details are not.
