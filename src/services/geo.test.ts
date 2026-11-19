import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { getDrivingRoute, searchPlaces } from './geo';
import { allowMapHistory, clearMapLookups, mapLookupCache } from './mapCache';
import { allowOffline } from '../offline';
import { usageStorageKey } from './usageLimits';

vi.mock('../firebase', () => ({ firebaseAuth: { currentUser: { uid: 'geo-user' } } }));

const fetchMock = vi.fn();
beforeEach(async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('navigator', { language: 'en-US' });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  allowOffline('geo-user');
  allowMapHistory('geo-user');
  await clearMapLookups('geo-user');
});

const placeResponse = () => new Response(JSON.stringify({ features: [{ geometry: { coordinates: [139.7, 35.6] }, properties: { name: 'Tokyo', country: 'Japan' } }] }), { headers: { 'cache-control': 'max-age=3600' } });

it('reuses persisted search results without another provider request or quota increment', async () => {
  fetchMock.mockImplementation(placeResponse);
  const [first, second] = await Promise.all([searchPlaces(' Tokyo ', 5), searchPlaces('Tokyo', 5)]);
  expect(first).toEqual(second);
  mapLookupCache.invalidate();
  expect(await searchPlaces('Tokyo', 5)).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(usageStorageKey('geo-user'))!).counts.placeSearch).toBe(1);
});

it('encodes query inputs and keeps result-affecting parameters distinct', async () => {
  fetchMock.mockImplementation(placeResponse);
  await searchPlaces("Tokyo & O'Brien?limit=999", 5);
  const url = new URL(fetchMock.mock.calls[0][0]);
  expect(url.searchParams.get('q')).toBe("Tokyo & O'Brien?limit=999");
  expect(url.searchParams.get('limit')).toBe('5');
  expect(url.searchParams.get('lang')).toBe('en');
  await searchPlaces("Tokyo & O'Brien?limit=999", 1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not cache provider no-store results', async () => {
  fetchMock.mockImplementation(() => new Response(JSON.stringify({ features: [{ geometry: { coordinates: [139.7, 35.6] }, properties: { name: 'Tokyo' } }] }), { headers: { 'cache-control': 'no-store' } }));
  await searchPlaces('Tokyo', 5);
  await searchPlaces('Tokyo', 5);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps route order in keys and leaves OSRM results memory-only', async () => {
  fetchMock.mockImplementation(() => new Response(JSON.stringify({ code: 'Ok', routes: [{ geometry: { coordinates: [[139, 35], [140, 36]] }, distance: 100, duration: 60 }] })));
  const points = [{ latitude: 35, longitude: 139 }, { latitude: 36, longitude: 140 }];
  await getDrivingRoute(points);
  await getDrivingRoute(points);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await getDrivingRoute([...points].reverse());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  mapLookupCache.invalidate();
  await getDrivingRoute(points);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});