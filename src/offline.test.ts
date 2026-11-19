import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { allowOffline, clearOffline, offlineEnabled, readSnapshot, SNAPSHOT_TTL, writeSnapshot } from './offline';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});

it('requires opt-in and isolates accounts', async () => {
  await writeSnapshot('A', [], 100);
  expect(await readSnapshot('A', 100)).toBeUndefined();
  allowOffline('A');
  await writeSnapshot('A', [], 100);
  expect((await readSnapshot('A', 101))?.syncedAt).toBe(100);
  expect(await readSnapshot('B', 101)).toBeUndefined();
  await clearOffline('A');
  expect(offlineEnabled('A')).toBe(false);
  expect(await readSnapshot('A', 101)).toBeUndefined();
});

it('expires at seven days and rejects backwards clock readings', async () => {
  allowOffline('clock');
  await writeSnapshot('clock', [], 100);
  expect(await readSnapshot('clock', 100 + SNAPSHOT_TTL)).toBeUndefined();
  await writeSnapshot('clock', [], 100);
  expect(await readSnapshot('clock', 99)).toBeUndefined();
});