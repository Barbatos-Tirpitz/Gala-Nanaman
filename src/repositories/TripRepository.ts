import { loadTrips, saveTrips } from '../storage';
import type { Activity, Expense, Trip } from '../types';

export interface TripRepository {
  listTrips(): Promise<Trip[]>;
  saveTrip(trip: Trip): Promise<void>;
  setTripArchived(tripId: string, archived: boolean): Promise<void>;
  saveCurrencyConversion(trip: Trip): Promise<void>;
  saveActivity(tripId: string, activity: Activity): Promise<void>;
  deleteActivity(tripId: string, activityId: string): Promise<void>;
  saveExpense(tripId: string, expense: Expense): Promise<void>;
  deleteExpense(tripId: string, expenseId: string): Promise<void>;
}

class BrowserTripRepository implements TripRepository {
  async listTrips(): Promise<Trip[]> {
    return loadTrips();
  }

  async saveTrip(trip: Trip): Promise<void> {
    const trips = loadTrips();
    const existingIndex = trips.findIndex((item) => item.id === trip.id);
    if (existingIndex < 0) {
      saveTrips([...trips, trip]);
      return;
    }

    saveTrips(trips.map((item) => item.id === trip.id ? trip : item));
  }

  async saveCurrencyConversion(trip: Trip): Promise<void> {
    await this.saveTrip(trip);
  }

  async setTripArchived(tripId: string, archived: boolean): Promise<void> {
    this.updateTrip(tripId, (trip) => ({ ...trip, archived }));
  }

  async saveActivity(tripId: string, activity: Activity): Promise<void> {
    this.updateTrip(tripId, (trip) => ({
      ...trip,
      activities: trip.activities.some((item) => item.id === activity.id)
        ? trip.activities.map((item) => item.id === activity.id ? activity : item)
        : [...trip.activities, activity],
    }));
  }

  async deleteActivity(tripId: string, activityId: string): Promise<void> {
    this.updateTrip(tripId, (trip) => ({
      ...trip,
      activities: trip.activities.filter((item) => item.id !== activityId),
    }));
  }

  async saveExpense(tripId: string, expense: Expense): Promise<void> {
    this.updateTrip(tripId, (trip) => ({
      ...trip,
      expenses: trip.expenses.some((item) => item.id === expense.id)
        ? trip.expenses.map((item) => item.id === expense.id ? expense : item)
        : [...trip.expenses, expense],
    }));
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    this.updateTrip(tripId, (trip) => ({
      ...trip,
      expenses: trip.expenses.filter((item) => item.id !== expenseId),
    }));
  }

  private updateTrip(tripId: string, update: (trip: Trip) => Trip): void {
    const trips = loadTrips();
    let found = false;
    const nextTrips = trips.map((trip) => {
      if (trip.id !== tripId) return trip;
      found = true;
      return update(trip);
    });

    if (!found) throw new Error('Trip not found.');
    saveTrips(nextTrips);
  }
}

export const tripRepository: TripRepository = new BrowserTripRepository();
