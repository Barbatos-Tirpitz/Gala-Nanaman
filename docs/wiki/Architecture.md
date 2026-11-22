# Architecture

## Runtime shape

The application is a React and TypeScript single-page app built with Vite. The
same UI runs in a browser/PWA and in Capacitor native shells.

```text
src/main.tsx
  └─ AuthProvider
      └─ App / AppWorkspace
          ├─ FirebaseTripRepository (configured Firebase) or browser prototype repository
          ├─ OfflineTripRepository (read-only snapshot and write guard)
          ├─ UI components and domain helpers
          └─ External-service modules
```

In production web builds, `main.tsx` registers the generated service worker;
native Capacitor builds do not register that web worker. `AuthProvider` restores
Firebase Authentication state before the workspace loads cloud trips.

## Persistence path

`AppWorkspace` creates an `OfflineTripRepository` around one source repository:

1. When Firebase Auth and Firestore are configured, the source is
   `FirestoreTripRepository`.
2. Without Firebase configuration, the source is the browser prototype
   repository in `repositories/TripRepository.ts`, backed by `localStorage`.
3. `OfflineTripRepository` adds network checks, access status, validation, and
   optional account-scoped offline snapshots around either source.

The UI depends on the `TripRepository` interface rather than Firestore SDK
operations. The Firestore adapter reads trip documents and their activity and
expense subcollections, then maps them into the UI's nested `Trip` model.

The local-storage adapter is a development fallback, not an authenticated or
production-safe data store. Production builds require Firebase configuration.

## Source map

| Area | Main files |
| --- | --- |
| Application composition and screens | `src/main.tsx`, `src/App.tsx`, `src/ExpensesView.tsx`, `src/MapView.tsx`, `src/MemoriesView.tsx` |
| Authentication and Firebase initialization | `src/auth/AuthContext.tsx`, `src/auth/SignInScreen.tsx`, `src/firebase.ts` |
| Repository contracts and adapters | `src/repositories/TripRepository.ts`, `src/repositories/FirestoreTripRepository.ts`, `src/repositories/OfflineTripRepository.ts` |
| Domain shape and validation | `src/types.ts`, `src/validation.ts`, `firestore.rules` |
| Offline and device storage | `src/offline.ts`, `src/localPhotos.ts`, `src/settings.ts`, `src/services/mapCache.ts` |
| Maps and external service access | `src/services/geo.ts`, `src/services/mapProviders.ts`, `src/services/googleMapsUrl.ts`, `src/services/currency.ts` |
| Expense and money logic | `src/expenses.ts`, `src/money.ts`, `src/currencyConversion.ts` |

## Design constraints

- Keep UI components out of direct Firestore document access; add data
  operations through repository contracts.
- Validate data at both client and Firestore boundaries. Client checks improve
  feedback but do not grant access.
- Treat offline snapshots as read-only and device-local. There is no offline
  write queue or merge process.
- Keep cloud credentials out of the web bundle. Firebase web configuration is
  public client configuration; Firestore Rules and Firebase Auth enforce data
  access.
- Collaboration and multi-user trip membership are not implemented.
