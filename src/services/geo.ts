import { firebaseAuth } from '../firebase';
import type { PlaceLocation } from '../types';
import { consumeDailyUsage, type UsageKind } from './usageLimits';
import { safeProviderUrl } from './externalUrl';
import { z } from 'zod';
import { offlineEnabled } from '../offline';
import { httpCachePolicy, mapHistoryEnabled, mapLookupCache, type LookupResult } from './mapCache';
import { MAP_PROVIDERS } from './mapProviders';

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
const REQUEST_TIMEOUT_MS = 15000;
const HOUR = 60 * 60 * 1000;
const placeSchema = z.object({ label: z.string().min(1).max(200), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), searchTerm: z.string().max(200).optional() });
const placesSchema = z.array(placeSchema).max(20);
const routeSchema = z.object({ coordinates: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(2), distanceMeters: z.number().nonnegative(), durationSeconds: z.number().nonnegative() });
const photosSchema = z.object({ query: z.string().nullable(), photos: z.array(z.object({ title: z.string(), thumbnail: z.string().url(), sourceUrl: z.string().url() })).max(8) });

function language(): string { return typeof navigator === 'undefined' ? 'en' : navigator.language?.split('-')[0] || 'en'; }

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

async function limitedRequest<T>(provider: keyof typeof MAP_PROVIDERS, key: unknown, ttlMs: number, schema: z.ZodType<T>, request: () => Promise<LookupResult<T>>, signal?: AbortSignal): Promise<T> {
  const uid = firebaseAuth?.currentUser?.uid ?? 'local';
  return mapLookupCache.lookup({
    uid, key: JSON.stringify([provider, MAP_PROVIDERS[provider].version, key]), ttlMs, schema, load: request, signal,
    isCurrent: () => (firebaseAuth?.currentUser?.uid ?? 'local') === uid,
    canPersist: () => Boolean(firebaseAuth?.currentUser?.uid === uid && MAP_PROVIDERS[provider].persistent && offlineEnabled(uid) && mapHistoryEnabled(uid)),
  });
}

async function getJson<T>(kind: UsageKind, url: string): Promise<{ data: T } & Pick<LookupResult<T>, 'cacheable' | 'maxAgeMs'>> {
  if (!allowRequest(kind)) throw new DailyLimitError();
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: 'default' });
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}.`);
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      Object.assign(error, { retryAfterMs: retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 30_000 });
    }
    throw error;
  }
  return { data: await response.json() as T, ...httpCachePolicy(response.headers) };
}

export function searchPlaces(query: string, limit: number, signal?: AbortSignal): Promise<PlaceLocation[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return Promise.reject(new Error('Invalid search limit.'));
  const text = query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({ q: text, limit: String(limit), lang: language() }).toString();
  return limitedRequest('photon', url.href, 24 * HOUR, placesSchema, async () => {
    const { data, ...policy } = await getJson<PhotonResponse>('placeSearch', url.href);
    const value = (data.features ?? []).flatMap((feature) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) return [];
      return [{ label: placeLabel(feature.properties), latitude, longitude }];
    });
    return { ...policy, value, cacheable: policy.cacheable !== false && value.length > 0 };
  }, signal);
}

export function reversePlace(latitude: number, longitude: number, signal?: AbortSignal): Promise<PlaceLocation> {
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) {
    return Promise.reject(new Error('The selected map point is outside valid coordinates.'));
  }

  const lat = Number(latitude.toFixed(5));
  const lon = Number(longitude.toFixed(5));
  const url = new URL('https://photon.komoot.io/reverse');
  url.search = new URLSearchParams({ lon: String(lon), lat: String(lat), limit: '1', lang: language() }).toString();
  return limitedRequest('photon', url.href, 7 * 24 * HOUR, placeSchema, async () => {
    const { data, ...policy } = await getJson<PhotonResponse>('placeSearch', url.href);
    const feature = data.features?.[0];
    const label = placeLabel(feature?.properties) || `Pinned location (${lat}, ${lon})`;
    return { ...policy, cacheable: policy.cacheable !== false && Boolean(feature), value: { label, latitude: lat, longitude: lon, searchTerm: label } };
  }, signal);
}

export function getDrivingRoute(points: RoutePoint[], signal?: AbortSignal): Promise<DrivingRoute> {
  if (points.length < 2 || points.length > 100 || points.some((point) => !isCoordinate(point.latitude, 90) || !isCoordinate(point.longitude, 180))) {
    return Promise.reject(new Error('Choose between two and 100 valid map points.'));
  }
  const path = points.map(({ latitude, longitude }) => `${longitude},${latitude}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`;
  return limitedRequest('osrm', url, 6 * HOUR, routeSchema, async () => {
    const { data, ...policy } = await getJson<OsrmResponse>('route', url);
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route) throw new Error('No route found.');

    return { ...policy, value: {
      coordinates: route.geometry.coordinates.map(([longitude, latitude]): [number, number] => [latitude, longitude]),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    } };
  }, signal);
}

export function findPlacePhotos(queries: string[], signal?: AbortSignal): Promise<PhotoSearch> {
  const searches = [...new Set(queries.map((query) => query.trim().slice(0, MAX_QUERY_LENGTH)).filter(Boolean))].slice(0, 2);
  return limitedRequest('commons', [searches, 960, language()], 24 * HOUR, photosSchema, async () => {
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
        uselang: language(),
      });

      try {
        const { data, ...policy } = await getJson<CommonsResponse>('photos', `https://commons.wikimedia.org/w/api.php?${params}`);
        const photos = Object.values(data.query?.pages ?? {}).flatMap((page) => {
          const image = page.imageinfo?.[0];
          if (!image?.thumburl || !image.descriptionurl) return [];
          const thumbnail = safeProviderUrl(image.thumburl, ['upload.wikimedia.org']);
          const sourceUrl = safeProviderUrl(image.descriptionurl, ['commons.wikimedia.org']);
          if (!thumbnail || !sourceUrl) return [];
          return [{ title: page.title.replace(/^File:/, '').replaceAll('_', ' '), thumbnail, sourceUrl }];
        });
        if (photos.length) return { ...policy, value: { query, photos } };
      } catch (error) {
        failure = error;
      }
    }

    if (failure) throw failure;
    return { value: { query: null, photos: [] }, cacheable: false };
  }, signal);
}
