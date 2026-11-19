import type { Activity, Expense, Trip } from '../types';
import type { TripRepository } from './TripRepository';
import { clearOffline, readSnapshot, requireNetwork, writeSnapshot } from '../offline';
import { activitySchema, expenseSchema, recordId, requireValidTrip } from '../validation';

export interface AccessStatus {
  mode: 'checking' | 'online' | 'offline' | 'unavailable';
  syncedAt?: number;
  message: string;
}

export class OfflineTripRepository implements TripRepository {
  private status: AccessStatus = { mode: 'checking', message: '' };
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly source: TripRepository, private readonly uid?: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getStatus = () => this.status;
  private publish(status: AccessStatus) { this.status = status; this.listeners.forEach((listener) => listener()); }
  invalidate() { this.generation++; this.publish({ mode: 'checking', message: '' }); }
  goOffline() { this.generation++; this.publish({ ...this.status, mode: 'offline', message: 'Offline. Read-only.' }); }

  async listTrips(): Promise<Trip[]> {
    const generation = ++this.generation;
    try {
      requireNetwork();
      const trips = (await this.source.listTrips()).map(requireValidTrip);
      if (generation !== this.generation) throw new Error('Trip loading was interrupted.');
      const syncedAt = Date.now();
      let message = '';
      if (this.uid) {
        try { await writeSnapshot(this.uid, trips, syncedAt); }
        catch { message = 'Trips loaded, but the offline copy could not be saved.'; }
      }
      if (generation !== this.generation) throw new Error('Trip loading was interrupted.');
      this.publish({ mode: 'online', syncedAt, message });
      return trips;
    } catch (error) {
      if (generation !== this.generation) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const denied = code.includes('permission-denied') || code.includes('unauthenticated');
      let message = denied ? 'Access could not be verified. Sign in again.' : 'Server unreachable. No offline copy is available.';
      if (this.uid && denied) {
        try { await clearOffline(this.uid); } catch { message += ' Local copy removal failed; clear browser data on shared devices.'; }
      } else if (this.uid && (!navigator.onLine || code.includes('unavailable') || code.includes('deadline-exceeded'))) {
        try {
          const snapshot = await readSnapshot(this.uid);
          if (snapshot && generation === this.generation) {
            this.publish({ mode: 'offline', syncedAt: snapshot.syncedAt, message: 'Offline copy. Read-only.' });
            return snapshot.trips;
          }
        } catch { message = 'The offline copy could not be read. Clear it and sync again when online.'; }
      }
      this.publish({ mode: 'unavailable', message });
      throw new Error(message);
    }
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    requireNetwork();
    if (this.status.mode !== 'online') throw new Error('Reconnect and refresh before making changes.');
    try { await action(); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code.includes('permission-denied') || code.includes('unauthenticated')) {
        this.publish({ mode: 'unavailable', message: 'Access denied. Refresh and sign in again.' });
        if (this.uid) await clearOffline(this.uid);
      }
      throw new Error('The change could not be saved. Check your connection and retry.');
    }
  }
  saveTrip(trip: Trip) { return this.mutate(() => this.source.saveTrip(requireValidTrip(trip))); }
  saveCurrencyConversion(trip: Trip) { return this.mutate(() => this.source.saveCurrencyConversion(requireValidTrip(trip))); }
  setTripArchived(tripId: string, archived: boolean) { return this.mutate(() => this.source.setTripArchived(recordId.parse(tripId), archived)); }
  saveActivity(tripId: string, activity: Activity) { return this.mutate(() => this.source.saveActivity(recordId.parse(tripId), activitySchema.parse(activity))); }
  deleteActivity(tripId: string, activityId: string) { return this.mutate(() => this.source.deleteActivity(recordId.parse(tripId), recordId.parse(activityId))); }
  saveExpense(tripId: string, expense: Expense) { return this.mutate(() => this.source.saveExpense(recordId.parse(tripId), expenseSchema.parse(expense))); }
  deleteExpense(tripId: string, expenseId: string) { return this.mutate(() => this.source.deleteExpense(recordId.parse(tripId), recordId.parse(expenseId))); }
}