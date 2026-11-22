# Offline and Local Storage

Offline behavior is intentionally read-only. There is no background write queue,
conflict resolution, or offline editing path.

## PWA application shell

The production web build uses `vite-plugin-pwa` to generate a service worker for
static application-shell assets. `src/main.tsx` registers it for production web
builds and offers a reload when an update is ready. It does not cache Firestore
responses, map tiles, or third-party API responses. Capacitor native builds do
not register this web service worker.

## Optional trip snapshots

Signed-in users can explicitly enable **Offline copy**. `src/offline.ts` stores
the validated trip snapshot in IndexedDB, keyed by Firebase UID, with a sync
timestamp. Snapshots expire after seven days. The local-storage consent flag is
separate from the snapshot record.

`OfflineTripRepository` first tries to load from its source repository. If the
request fails because connectivity/server availability is unavailable, it may
use a valid, opted-in snapshot. If Firebase reports permission denial or
unauthenticated access, it clears the offline copy instead of treating old data
as authorized.

Writes require both network connectivity and an online repository state.
Reconnection triggers a server refresh; edits are not queued while offline.
Snapshot expiration is checked while the app runs, not by a guaranteed
background deletion timer.

Clearing offline trip data also revokes map-history persistence. Local activity
photo blobs use a separate database and lifecycle; clearing trip snapshots does
not itself remove those images.

## Device storage inventory

| Data | Storage | Scope and behavior |
| --- | --- | --- |
| Trip and activity data in configured mode | Cloud Firestore | Owner-authorized records |
| Prototype trip data | `localStorage` | Development fallback only |
| Optional trip snapshot | IndexedDB `gala-nanaman-offline` | Per-UID, validated, read-only, seven-day maximum |
| Activity and outfit image blobs | IndexedDB `gala-nanaman-media` | Device/browser installation; not uploaded |
| Map lookup cache | Memory and optional IndexedDB | Per-user where persistence is opted in; see map page |
| User display preferences | `localStorage` | Browser/app local settings |

Browser/device storage can be evicted or cleared. Local images and offline
snapshots are not backups and are not encrypted against other device users.
