import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { OfflineTripRepository } from './OfflineTripRepository';
import type { TripRepository } from './TripRepository';
import { allowOffline, offlineEnabled, writeSnapshot } from '../offline';

it('blocks writes before verified load and after network loss', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  const source = { listTrips: vi.fn().mockResolvedValue([]), setTripArchived: vi.fn().mockResolvedValue(undefined) } as unknown as TripRepository;
  const repository = new OfflineTripRepository(source);
  await expect(repository.setTripArchived('one', true)).rejects.toThrow();
  await repository.listTrips();
  await repository.setTripArchived('one', true);
  repository.goOffline();
  await expect(repository.setTripArchived('one', false)).rejects.toThrow();
  expect(source.setTripArchived).toHaveBeenCalledTimes(1);
});

it('falls back only for network failures, never for denied access', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('navigator', { onLine: true });
  allowOffline('reader');
  await writeSnapshot('reader', []);
  const source = { listTrips: vi.fn().mockRejectedValue({ code: 'unavailable' }) } as unknown as TripRepository;
  const repository = new OfflineTripRepository(source, 'reader');
  expect(await repository.listTrips()).toEqual([]);
  expect(repository.getStatus().mode).toBe('offline');
  vi.mocked(source.listTrips).mockRejectedValue({ code: 'permission-denied' });
  await expect(repository.listTrips()).rejects.toThrow('Access');
  expect(repository.getStatus().mode).toBe('unavailable');
  expect(offlineEnabled('reader')).toBe(false);
});

it('does not publish an in-flight load after invalidation', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  let resolve!: (value: []) => void;
  const source = { listTrips: () => new Promise<[]>((done) => { resolve = done; }) } as unknown as TripRepository;
  const repository = new OfflineTripRepository(source);
  const pending = repository.listTrips();
  repository.invalidate();
  resolve([]);
  await expect(pending).rejects.toThrow('interrupted');
  expect(repository.getStatus().mode).toBe('checking');
});