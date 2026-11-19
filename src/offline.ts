import { z } from 'zod';
import type { Trip } from './types';
import { tripSchema } from './validation';
import { clearMapLookups } from './services/mapCache';

export const SNAPSHOT_TTL = 7 * 24 * 60 * 60 * 1000;
const DATABASE = 'gala-nanaman-offline';
const STORE = 'snapshots';
const CONSENT = 'gala-nanaman:offline-consent:v1:';
const snapshotSchema = z.object({ version: z.literal(1), uid: z.string().min(1), syncedAt: z.number().finite(), trips: z.array(tripSchema) });
export type OfflineSnapshot = z.infer<typeof snapshotSchema>;

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'uid' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Offline storage is unavailable.'));
  });
}

async function transaction<Result>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Offline storage could not be updated.'));
    });
  } finally { db.close(); }
}

export function offlineEnabled(uid: string): boolean {
  try { return localStorage.getItem(CONSENT + uid) === 'yes'; } catch { return false; }
}

export function allowOffline(uid: string): void {
  localStorage.setItem(CONSENT + uid, 'yes');
}

export async function clearOffline(uid: string): Promise<void> {
  let failed = false;
  try { localStorage.removeItem(CONSENT + uid); } catch { failed = true; }
  const results = await Promise.allSettled([
    transaction('readwrite', (store) => store.delete(uid)),
    clearMapLookups(uid, true),
  ]);
  if (failed || results.some((result) => result.status === 'rejected')) throw new Error('Local trip or map data could not be fully cleared.');
}

export async function writeSnapshot(uid: string, trips: Trip[], now = Date.now()): Promise<void> {
  if (!offlineEnabled(uid)) return;
  const snapshot = snapshotSchema.parse({ version: 1, uid, syncedAt: now, trips });
  await transaction('readwrite', (store) => store.put(snapshot));
  if (!offlineEnabled(uid)) await transaction('readwrite', (store) => store.delete(uid));
}

export async function readSnapshot(uid: string, now = Date.now()): Promise<OfflineSnapshot | undefined> {
  if (!offlineEnabled(uid)) return undefined;
  const raw: unknown = await transaction('readonly', (store) => store.get(uid));
  if (raw === undefined) return undefined;
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success || parsed.data.uid !== uid || parsed.data.syncedAt > now || now - parsed.data.syncedAt >= SNAPSHOT_TTL) {
    await transaction('readwrite', (store) => store.delete(uid));
    return undefined;
  }
  return parsed.data;
}

export function requireNetwork(): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('You are offline. Changes are unavailable.');
}