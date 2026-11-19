import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { allowMapHistory, clearMapLookups, httpCachePolicy, MAP_CACHE_TTL, mapCacheSummary, mapHistoryEnabled, MapLookupCache } from './mapCache';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('navigator', {});
});

const options = (uid: string) => ({ uid, key: 'photon:v1:place:Tokyo:en:5', ttlMs: 1000, canPersist: () => true, schema: z.array(z.string()), load: vi.fn(async () => ({ value: ['Tokyo'] })) });

it('coalesces requests and persists validated values across cache instances', async () => {
  const query = options('persist');
  const cache = new MapLookupCache(() => 100);
  expect(await Promise.all([cache.lookup(query), cache.lookup(query)])).toEqual([['Tokyo'], ['Tokyo']]);
  expect(await new MapLookupCache(() => 101).lookup(query)).toEqual(['Tokyo']);
  expect(query.load).toHaveBeenCalledTimes(1);
});

it('does not persist without consent and separates users and keys', async () => {
  const query = { ...options('private'), canPersist: () => false };
  await new MapLookupCache().lookup(query);
  await new MapLookupCache().lookup(query);
  expect(query.load).toHaveBeenCalledTimes(2);
  const cache = new MapLookupCache();
  const other = { ...query, uid: 'other' };
  await cache.lookup(other);
  await cache.lookup({ ...other, key: 'another-order' });
  expect(query.load).toHaveBeenCalledTimes(4);
});

it('expires fresh entries, rejects future timestamps and honors no-store', async () => {
  const query = options('expiry');
  await new MapLookupCache(() => 100).lookup(query);
  await new MapLookupCache(() => 1100).lookup(query);
  await new MapLookupCache(() => 99).lookup(query);
  expect(query.load).toHaveBeenCalledTimes(3);
  const noStore = { ...options('no-store'), load: vi.fn(async () => ({ value: ['Tokyo'], cacheable: false })) };
  const cache = new MapLookupCache();
  await cache.lookup(noStore);
  await cache.lookup(noStore);
  expect(noStore.load).toHaveBeenCalledTimes(2);
});

it('clear prevents an in-flight response from repopulating disk', async () => {
  allowMapHistory('race');
  const query = options('race');
  let resolve!: (value: { value: string[] }) => void;
  const pending = new MapLookupCache().lookup({ ...query, load: () => new Promise<{ value: string[] }>((done) => { resolve = done; }) });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  await clearMapLookups('race', true);
  expect(mapHistoryEnabled('race')).toBe(false);
  resolve({ value: ['Old'] });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(await new MapLookupCache().lookup(query)).toEqual(['Tokyo']);
  expect(query.load).toHaveBeenCalledTimes(1);
});

it('one aborted caller does not cancel another caller or cache an actual abort', async () => {
  const query = { ...options('abort'), canPersist: () => false };
  const controller = new AbortController();
  const cache = new MapLookupCache();
  const first = cache.lookup({ ...query, signal: controller.signal });
  const second = cache.lookup(query);
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect(await second).toEqual(['Tokyo']);
  expect(query.load).toHaveBeenCalledTimes(1);
});

it('honors provider HTTP cache directives and remaining freshness', () => {
  expect(httpCachePolicy(new Headers({ 'cache-control': 'public, max-age=60', age: '20' }), 0).maxAgeMs).toBe(40_000);
  expect(httpCachePolicy(new Headers({ 'cache-control': 'no-store' })).cacheable).toBe(false);
  expect(httpCachePolicy(new Headers({ 'cache-control': 'no-cache, must-revalidate' })).cacheable).toBe(false);
  expect(httpCachePolicy(new Headers({ vary: '*' })).cacheable).toBe(false);
});

it('caps retention at seven days without extending it on hits', async () => {
  const query = { ...options('absolute'), ttlMs: MAP_CACHE_TTL * 2 };
  let now = 100;
  const cache = new MapLookupCache(() => now);
  await cache.lookup(query);
  now += MAP_CACHE_TTL - 1;
  await cache.lookup(query);
  expect(query.load).toHaveBeenCalledTimes(1);
  now++;
  await cache.lookup(query);
  expect(query.load).toHaveBeenCalledTimes(2);
});

it('bounds persistent entries and does not discard newer records on a cache hit', async () => {
  const query = options('budget');
  const cache = new MapLookupCache();
  for (let index = 0; index < 201; index++) await cache.lookup({ ...query, key: `key-${index}` });
  expect((await mapCacheSummary('budget')).count).toBe(200);
  await cache.lookup({ ...query, key: 'key-199' });
  await new MapLookupCache().lookup({ ...query, key: 'key-200' });
  expect(query.load).toHaveBeenCalledTimes(201);
});

it('falls back to memory when IndexedDB fails or Web Locks is denied', async () => {
  vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new DOMException('Denied', 'SecurityError')) } });
  vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Full', 'QuotaExceededError'); } });
  const query = options('fallback');
  const cache = new MapLookupCache();
  expect(await cache.lookup(query)).toEqual(['Tokyo']);
  expect(await cache.lookup(query)).toEqual(['Tokyo']);
  expect(query.load).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

it('rejects cached data incompatible with the current result schema', async () => {
  const query = options('schema');
  await new MapLookupCache().lookup(query);
  const replacement = { ...query, schema: z.array(z.number()), load: vi.fn(async () => ({ value: [1] })) };
  expect(await new MapLookupCache().lookup(replacement)).toEqual([1]);
  expect(replacement.load).toHaveBeenCalledTimes(1);
});

it('backs off failed requests without persisting an error result', async () => {
  let now = 100;
  const load = vi.fn(async (): Promise<{ value: string[] }> => { throw Object.assign(new Error('Throttled'), { retryAfterMs: 30_000 }); });
  const query = { ...options('backoff'), canPersist: () => false, load };
  const cache = new MapLookupCache(() => now);
  await expect(cache.lookup(query)).rejects.toThrow('Throttled');
  await expect(cache.lookup(query)).rejects.toThrow('Throttled');
  expect(load).toHaveBeenCalledTimes(1);
  now += 30_000;
  await expect(cache.lookup(query)).rejects.toThrow('Throttled');
  expect(load).toHaveBeenCalledTimes(2);
});

it('does not reuse entries from before a clear even before a storage event arrives', async () => {
  let count = 0;
  const query = { ...options('epoch'), load: vi.fn(async () => ({ value: [String(++count)] })) };
  const original = new MapLookupCache();
  expect(await original.lookup(query)).toEqual(['1']);
  localStorage.setItem('gala-nanaman:map-cache-epoch:epoch', 'cleared-elsewhere');
  expect(await new MapLookupCache().lookup(query)).toEqual(['2']);
  expect(await original.lookup(query)).toEqual(['3']);
});