import { firebaseAuth } from '../firebase';
import type { PlaceLocation } from '../types';
import { consumeDailyUsage, type UsageKind } from './usageLimits';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface DrivingRoute {
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
}

export interface PlacePhoto {
  title: string;
  thumbnail: string;
  sourceUrl: string;
}

export interface PhotoSearch {
  query: string | null;
  photos: PlacePhoto[];
}

export class DailyLimitError extends Error {
  constructor() {
    super('Daily limit reached.');
    this.name = 'DailyLimitError';
  }
}

interface PhotonProperties {
  name?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface PhotonResponse {
  features?: Array<{ geometry?: { coordinates?: number[] }; properties?: PhotonProperties }>;
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{ geometry: { coordinates: Array<[number, number]> }; distance: number; duration: number }>;
}

interface CommonsResponse {
  query?: { pages?: Record<string, { title: string; imageinfo?: Array<{ thumburl?: string; descriptionurl?: string }> }> };
}

const MAX_QUERY_LENGTH = 200;
const MAX_CACHED_RESULTS = 100;
const REQUEST_TIMEOUT_MS = 15000;
const cachedResults = new Map<string, unknown>();
const pendingResults = new Map<string, Promise<unknown>>();

function isCoordinate(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
}

function placeLabel(properties: PhotonProperties = {}): string {
  return [properties.name, properties.city ?? properties.state, properties.country]
    .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
    .join(', ')
    .slice(0, MAX_QUERY_LENGTH);
}

function allowRequest(kind: UsageKind): boolean {
  try {
    return consumeDailyUsage(window.localStorage, firebaseAuth?.currentUser?.uid ?? 'local', kind);
  } catch {
    // Limits are advisory, so unavailable browser storage must not block lookups.
    return true;
  }
}

// Requests are shared and not cancelled, so repeated renders and retries count once per lookup.
async function limitedRequest<T>(kind: UsageKind, cacheKey: string, request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let pending = cachedResults.has(cacheKey)
    ? Promise.resolve(cachedResults.get(cacheKey) as T)
    : pendingResults.get(cacheKey) as Promise<T> | undefined;

  if (!pending) {
    if (!allowRequest(kind)) throw new DailyLimitError();
    pending = request()
      .then((result) => {
        const oldestKey = cachedResults.keys().next().value;
        if (cachedResults.size >= MAX_CACHED_RESULTS && oldestKey !== undefined) cachedResults.delete(oldestKey);
        cachedResults.set(cacheKey, result);
        return result;
      })
      .finally(() => pendingResults.delete(cacheKey));
    pendingResults.set(cacheKey, pending);
  }

  const result = await pending;
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
  return result;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
  return response.json() as Promise<T>;
}

export function searchPlaces(query: string, limit: number, signal?: AbortSignal): Promise<PlaceLocation[]> {
  const text = query.trim().slice(0, MAX_QUERY_LENGTH);
  return limitedRequest('placeSearch', `place:${limit}:${text.toLowerCase()}`, async () => {
    const data = await getJson<PhotonResponse>(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=${limit}`);
    return (data.features ?? []).flatMap((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) return [];
      return [{ label: placeLabel(feature.properties), latitude, longitude }];
    });
  }, signal);
}

export function reversePlace(latitude: number, longitude: number, signal?: AbortSignal): Promise<PlaceLocation> {
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) {
    return Promise.reject(new Error('The selected map point is outside valid coordinates.'));
  }

  const lat = Number(latitude.toFixed(5));
  const lon = Number(longitude.toFixed(5));
  return limitedRequest('placeSearch', `reverse:${lat},${lon}`, async () => {
    const data = await getJson<PhotonResponse>(`https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}&limit=1`);
    const feature = data.features?.[0];
    const label = placeLabel(feature?.properties) || `Pinned location (${lat}, ${lon})`;
    return { label, latitude, longitude, searchTerm: label };
  }, signal);
}

export function getDrivingRoute(points: RoutePoint[], signal?: AbortSignal): Promise<DrivingRoute> {
  const path = points.map(({ latitude, longitude }) => `${longitude},${latitude}`).join(';');
  return limitedRequest('route', `route:${path}`, async () => {
    const data = await getJson<OsrmResponse>(
      `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`,
    );
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route) throw new Error('No route found.');

    return {
      coordinates: route.geometry.coordinates.map(([longitude, latitude]): [number, number] => [latitude, longitude]),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  }, signal);
}

export function findPlacePhotos(queries: string[], signal?: AbortSignal): Promise<PhotoSearch> {
  const searches = [...new Set(queries.map((query) => query.trim().slice(0, MAX_QUERY_LENGTH)).filter(Boolean))].slice(0, 2);
  return limitedRequest('photos', `photos:${searches.join('|')}`, async () => {
    let failure: unknown;

    for (const query of searches) {
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrnamespace: '6',
        gsrlimit: '8',
        prop: 'imageinfo',
        iiprop: 'url',
        iiurlwidth: '960',
        format: 'json',
        origin: '*',
      });

      try {
        const data = await getJson<CommonsResponse>(`https://commons.wikimedia.org/w/api.php?${params}`);
        const photos = Object.values(data.query?.pages ?? {}).flatMap((page) => {
          const image = page.imageinfo?.[0];
          if (!image?.thumburl || !image.descriptionurl) return [];
          return [{ title: page.title.replace(/^File:/, '').replaceAll('_', ' '), thumbnail: image.thumburl, sourceUrl: image.descriptionurl }];
        });
        if (photos.length) return { query, photos };
      } catch (error) {
        failure = error;
      }
    }

    if (failure) throw failure;
    return { query: null, photos: [] };
  }, signal);
}
