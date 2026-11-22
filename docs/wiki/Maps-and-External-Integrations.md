# Maps and External Integrations

## Map and lookup providers

The application uses Leaflet for map rendering and the canonical OpenStreetMap
tile URL. Place search and reverse geocoding use Photon, route previews use the
OSRM demo service, and photo search metadata comes from Wikimedia Commons.
These public/demo providers do not provide a production availability guarantee.

Requests are made from the client in `src/services/geo.ts`. Inputs are bounded
and provider responses are validated with Zod before they are used. Provider
requests have a 15-second timeout. The usage counters in
`src/services/usageLimits.ts` are browser-local advisory limits: 200 place
searches, 100 route lookups, and 100 photo searches per local day. They can be
cleared or bypassed by a user and are not a security or billing boundary.

## Map lookup cache

`src/services/mapCache.ts` provides request coalescing, in-memory caching,
optional IndexedDB persistence, freshness checks, invalidation, and bounded
retention. Persistence requires all of the following:

1. A signed-in Firebase UID.
2. Existing opt-in to the trip **Offline copy**.
3. Separate consent to keep map lookups on the device.
4. A provider marked persistent in `src/services/mapProviders.ts`.

Photon search results can be persisted for up to 24 hours; reverse-geocoding
results for up to seven days. Provider cache directives may shorten retention
or prohibit caching. The implementation caps history at 200 entries,
approximately 5 MiB, and 512 KiB per entry, with expired/LRU eviction. OSRM
routes and Wikimedia metadata are memory-only; OSM tile caching is managed by
the browser's HTTP cache, not this application cache.

Clearing map lookups invalidates pending/in-memory results and removes the
app-managed query history. It cannot guarantee removal of browser-managed HTTP
tile or remote-image caches.

## Google Maps links

`src/services/googleMapsUrl.ts` builds encoded HTTPS Google Maps URLs for an
explicit user action. This is a URL integration, not the Google Maps SDK or an
API call from the application. It needs no Google Maps API key. The generated
URL uses the selected place/coordinates and does not include trip notes or user
IDs. Directions do not supply an origin.

## Privacy and release considerations

Map queries and coordinates are sent to the relevant provider. Provider policies,
attribution requirements, availability, rate limits, privacy practices, and
production costs should be reviewed before relying on these public services for
a release. Route previews are estimates, not navigation instructions.
