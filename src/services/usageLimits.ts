export type UsageKind = 'placeSearch' | 'route' | 'photos';

export type UsageLimits = Record<UsageKind, number>;

export const DAILY_USAGE_LIMITS: UsageLimits = {
  placeSearch: 200,
  route: 100,
  photos: 100,
};

export interface UsageStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface UsageRecord {
  day: string;
  counts: Partial<Record<UsageKind, number>>;
}

export function usageStorageKey(userKey: string): string {
  return `gala-nanaman:usage:v1:${userKey}`;
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readRecord(value: string | null): UsageRecord | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { day, counts } = parsed as Partial<UsageRecord>;
    return typeof day === 'string' && typeof counts === 'object' && counts !== null ? { day, counts } : undefined;
  } catch {
    return undefined;
  }
}

export function consumeDailyUsage(
  store: UsageStore,
  userKey: string,
  kind: UsageKind,
  now = new Date(),
  limits: UsageLimits = DAILY_USAGE_LIMITS,
): boolean {
  const key = usageStorageKey(userKey);
  const day = localDay(now);
  const record = readRecord(store.getItem(key));
  const counts = record?.day === day ? record.counts : {};
  const stored = counts[kind];
  const used = typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  if (used >= limits[kind]) return false;

  store.setItem(key, JSON.stringify({ day, counts: { ...counts, [kind]: used + 1 } }));
  return true;
}
