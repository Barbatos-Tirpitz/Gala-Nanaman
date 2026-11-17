import { describe, expect, it } from 'vitest';
import { consumeDailyUsage, usageStorageKey, type UsageStore } from './usageLimits';

function memoryStore(): UsageStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const limits = { placeSearch: 2, route: 1, photos: 1 };
const morning = new Date(2026, 10, 17, 9);

describe('consumeDailyUsage', () => {
  it('allows requests until the daily limit is reached', () => {
    const store = memoryStore();
    expect(consumeDailyUsage(store, 'user-a', 'placeSearch', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-a', 'placeSearch', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-a', 'placeSearch', morning, limits)).toBe(false);
  });

  it('tracks accounts and request types separately', () => {
    const store = memoryStore();
    expect(consumeDailyUsage(store, 'user-a', 'route', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-b', 'route', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-a', 'photos', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-a', 'route', morning, limits)).toBe(false);
  });

  it('starts a new allowance on the next calendar day', () => {
    const store = memoryStore();
    expect(consumeDailyUsage(store, 'user-a', 'route', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-a', 'route', morning, limits)).toBe(false);
    expect(consumeDailyUsage(store, 'user-a', 'route', new Date(2026, 10, 18, 0, 5), limits)).toBe(true);
  });

  it('ignores unreadable or invalid stored usage', () => {
    const store = memoryStore();
    store.setItem(usageStorageKey('user-a'), '{not json');
    expect(consumeDailyUsage(store, 'user-a', 'route', morning, limits)).toBe(true);

    store.setItem(usageStorageKey('user-b'), JSON.stringify({ day: '2026-11-17', counts: { route: -5 } }));
    expect(consumeDailyUsage(store, 'user-b', 'route', morning, limits)).toBe(true);
    expect(consumeDailyUsage(store, 'user-b', 'route', morning, limits)).toBe(false);
  });
});
