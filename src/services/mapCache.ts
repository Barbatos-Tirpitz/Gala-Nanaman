import { z } from 'zod';

export const MAP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export const MAP_CACHE_LIMIT = 200;
export const MAP_CACHE_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const CONSENT = 'gala-nanaman:map-history:v1:';
const EPOCH = 'gala-nanaman:map-cache-epoch:';
const entrySchema = z.object({
  version: z.literal(1), uid: z.string(), key: z.string(), epoch: z.string(), value: z.unknown(),
  fetchedAt: z.number().finite(), freshUntil: z.number().finite(), lastAccessedAt: z.number().finite(),
  bytes: z.number().int().min(0).max(MAX_ENTRY_BYTES),
});
type Entry = z.infer<typeof entrySchema>;
interface Schema<Value> { safeParse(value: unknown): { success: true; data: Value } | { success: false } }
export interface LookupResult<Value> { value: Value; maxAgeMs?: number; cacheable?: boolean }
interface Lookup<Value> {
  uid: string;
  key: string;
  ttlMs: number;
  canPersist: () => boolean;
  isCurrent?: () => boolean;
  schema: Schema<Value>;
  load: () => Promise<LookupResult<Value>>;
  signal?: AbortSignal;
}

function epoch(uid: string): string | undefined {
  try { return localStorage.getItem(EPOCH + uid) ?? '0'; } catch { return undefined; }
}

export function mapHistoryEnabled(uid: string): boolean {
  try { return localStorage.getItem(CONSENT + uid) === 'yes'; } catch { return false; }
}

export function allowMapHistory(uid: string): void {
  localStorage.setItem(CONSENT + uid, 'yes');
}

let warned = false;
function storageWarning() {
  if (warned) return;
  warned = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('map-cache-warning'));
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gala-nanaman-map-lookups', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('lookups', { keyPath: ['uid', 'key'] }).createIndex('uid', 'uid');
    };
    request.onerror = () => reject(new Error('Map cache storage is unavailable.'));
    request.onblocked = () => reject(new Error('Map cache storage is busy.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

async function transact<Result>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('lookups', mode);
      const request = action(tx.objectStore('lookups'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Map cache storage failed.'));
    });
  } finally { db.close(); }
}

async function removeEntries(uid: string): Promise<void> {
  await transact('readwrite', (store) => {
    const request = store.index('uid').openCursor(IDBKeyRange.only(uid));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    return request;
  });
}

async function saveEntry(entry: Entry, valid: () => boolean): Promise<void> {
  await transact('readwrite', (store) => {
    const request = store.index('uid').getAll(entry.uid);
    request.onsuccess = () => {
      if (!valid()) return;
      const retained: Entry[] = [];
      for (const raw of request.result) {
        const parsed = entrySchema.safeParse(raw);
        if (!parsed.success || parsed.data.freshUntil <= entry.lastAccessedAt || parsed.data.fetchedAt > entry.lastAccessedAt || parsed.data.key === entry.key) {
          if (raw && typeof raw.key === 'string') store.delete([entry.uid, raw.key]);
        } else retained.push(parsed.data);
      }
      retained.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
      let total = retained.reduce((sum, item) => sum + item.bytes, 0) + entry.bytes;
      while (retained.length >= MAP_CACHE_LIMIT || total > MAP_CACHE_BYTES) {
        const oldest = retained.shift();
        if (!oldest) break;
        store.delete([entry.uid, oldest.key]);
        total -= oldest.bytes;
      }
      store.put(entry);
    };
    return request;
  });
  if (!valid()) await transact('readwrite', (store) => store.delete([entry.uid, entry.key]));
}

function usable(entry: Entry, uid: string, key: string, now: number): boolean {
  return entry.uid === uid && entry.key === key && entry.fetchedAt <= now && entry.freshUntil > now
    && entry.epoch === (epoch(uid) ?? 'unavailable')
    && entry.freshUntil <= entry.fetchedAt + MAP_CACHE_TTL;
}

export class MapLookupCache {
  private memory = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();
  private failures = new Map<string, { until: number; error: unknown }>();
  private generation = 0;
  constructor(private readonly now = () => Date.now()) {}

  invalidate() { this.generation++; this.memory.clear(); this.pending.clear(); this.failures.clear(); }

  async lookup<Value>(options: Lookup<Value>): Promise<Value> {
    const { uid, key, schema, signal } = options;
    if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    const scopedKey = JSON.stringify([uid, key]);
    const generation = this.generation;
    const startedEpoch = epoch(uid);
    const valid = () => generation === this.generation && startedEpoch === epoch(uid) && (options.isCurrent?.() ?? true);
    const persist = () => valid() && startedEpoch !== undefined && options.canPersist();
    const read = async (): Promise<Value | undefined> => {
      let entry = this.memory.get(scopedKey);
      if (!entry && persist()) {
        try {
          const raw: unknown = await transact('readonly', (store) => store.get([uid, key]));
          const parsed = entrySchema.safeParse(raw);
          if (parsed.success) entry = parsed.data;
          if (raw !== undefined && (!entry || !usable(entry, uid, key, this.now()))) {
            await transact('readwrite', (store) => store.delete([uid, key]));
            entry = undefined;
          }
        } catch { storageWarning(); }
      }
      if (!valid()) throw new DOMException('Cache scope changed.', 'AbortError');
      if (!entry || !usable(entry, uid, key, this.now())) { this.memory.delete(scopedKey); return undefined; }
      const result = schema.safeParse(entry.value);
      if (!result.success) {
        this.memory.delete(scopedKey);
        if (persist()) await transact('readwrite', (store) => store.delete([uid, key])).catch(storageWarning);
        return undefined;
      }
      entry.lastAccessedAt = this.now();
      this.remember(scopedKey, entry);
      if (persist()) {
        try { await saveEntry(entry, persist); } catch { storageWarning(); }
      }
      return result.data;
    };
    const execute = async (): Promise<Value> => {
      const hit = await read();
      if (hit !== undefined) return hit;
      const failure = this.failures.get(scopedKey);
      if (failure && failure.until > this.now()) throw failure.error;
      if (!valid()) throw new DOMException('Cache scope changed.', 'AbortError');
      try {
        const response = await options.load();
        const result = schema.safeParse(response.value);
        if (!result.success) throw new Error('Invalid map provider response.');
        if (!valid()) throw new DOMException('Cache scope changed.', 'AbortError');
        const fetchedAt = this.now();
        const ttl = Math.max(0, Math.min(options.ttlMs, response.maxAgeMs ?? options.ttlMs, MAP_CACHE_TTL));
        const entry: Entry = { version: 1, uid, key, epoch: startedEpoch ?? 'unavailable', value: result.data, fetchedAt, freshUntil: fetchedAt + ttl, lastAccessedAt: fetchedAt, bytes: 0 };
        entry.bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        if (response.cacheable !== false && ttl > 0 && entry.bytes <= MAX_ENTRY_BYTES) {
          this.remember(scopedKey, entry);
          if (persist()) { try { await saveEntry(entry, persist); } catch { storageWarning(); } }
        }
        return result.data;
      } catch (error) {
        if (valid() && error instanceof Error && !['AbortError', 'DailyLimitError'].includes(error.name)) {
          if (this.failures.size >= 100) this.failures.delete(this.failures.keys().next().value!);
          const retry = 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 3000;
          this.failures.set(scopedKey, { until: this.now() + Math.min(Math.max(1000, retry), 60_000), error });
        }
        throw error;
      }
    };
    let pending = this.pending.get(scopedKey) as Promise<Value> | undefined;
    if (!pending) {
      pending = (async () => {
        const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        if (persist() && lockManager) {
          let entered = false;
          try { return await lockManager.request(`gala-map:${scopedKey}`, () => { entered = true; return execute(); }); }
          catch (error) { if (entered) throw error; }
        }
        return execute();
      })();
      this.pending.set(scopedKey, pending);
      const current = pending;
      void current.finally(() => { if (this.pending.get(scopedKey) === current) this.pending.delete(scopedKey); }).catch(() => undefined);
    }
    const result = await pending;
    if (signal?.aborted || !valid()) throw new DOMException('Request cancelled.', 'AbortError');
    return result;
  }

  private remember(key: string, entry: Entry) {
    this.memory.delete(key);
    this.memory.set(key, entry);
    let bytes = [...this.memory.values()].reduce((sum, item) => sum + item.bytes, 0);
    while (this.memory.size > 100 || bytes > MAP_CACHE_BYTES) {
      const oldest = this.memory.keys().next().value!;
      bytes -= this.memory.get(oldest)!.bytes;
      this.memory.delete(oldest);
    }
  }
}

export const mapLookupCache = new MapLookupCache();

export function httpCachePolicy(headers: Headers, now = Date.now()): Pick<LookupResult<unknown>, 'cacheable' | 'maxAgeMs'> {
  const control = headers.get('cache-control') ?? '';
  if (/\b(no-store|no-cache)\b/i.test(control) || headers.get('vary')?.trim() === '*' || /no-cache/i.test(headers.get('pragma') ?? '')) return { cacheable: false };
  const maximum = control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i);
  const expires = Date.parse(headers.get('expires') ?? '');
  const date = Date.parse(headers.get('date') ?? '');
  const age = Math.max(Number(headers.get('age')) || 0, Number.isFinite(date) ? Math.max(0, (now - date) / 1000) : 0);
  if (maximum) return { maxAgeMs: Math.max(0, (Number(maximum[1]) - age) * 1000) };
  if (Number.isFinite(expires)) return { maxAgeMs: Math.max(0, expires - now) };
  return {};
}

export async function clearMapLookups(uid: string, revoke = false): Promise<void> {
  mapLookupCache.invalidate();
  let failed = false;
  try {
    if (revoke) localStorage.removeItem(CONSENT + uid);
    localStorage.setItem(EPOCH + uid, globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  } catch { failed = true; }
  warned = false;
  try { await removeEntries(uid); } catch { failed = true; }
  if (failed) throw new Error('Cached map lookups could not be fully cleared.');
}

export async function mapCacheSummary(uid: string): Promise<{ count: number; bytes: number }> {
  const raw = await transact('readonly', (store) => store.index('uid').getAll(uid));
  const valid: Entry[] = [];
  for (const item of raw) {
    const parsed = entrySchema.safeParse(item);
    if (parsed.success && usable(parsed.data, uid, parsed.data.key, Date.now())) valid.push(parsed.data);
    else if (item && typeof item.key === 'string') await transact('readwrite', (store) => store.delete([uid, item.key]));
  }
  return { count: valid.length, bytes: valid.reduce((sum, item) => sum + item.bytes, 0) };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key.startsWith(EPOCH) || event.key.startsWith(CONSENT) || event.key.startsWith('gala-nanaman:offline-consent:')) mapLookupCache.invalidate();
  });
}