import {
  collection,
  doc,
  getDocsFromServer,
  query,
  serverTimestamp,
  where,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import type { Activity, Expense, Trip } from '../types';
import type { TripRepository } from './TripRepository';
import { activitySchema, expenseSchema, recordId, requireValidTrip } from '../validation';
import { requireNetwork } from '../offline';

export class FirestoreTripRepository implements TripRepository {
  constructor(private readonly db: Firestore, private readonly auth: Auth) {}

  async listTrips(): Promise<Trip[]> {
    const user = this.requireUser();
    const tripsQuery = query(collection(this.db, 'trips'), where('ownerId', '==', user.uid));
    const snapshot = await getDocsFromServer(tripsQuery);

    return Promise.all(snapshot.docs.map(async (tripDocument) => {
      const [activitiesSnapshot, expensesSnapshot] = await Promise.all([
        getDocsFromServer(collection(this.db, 'trips', tripDocument.id, 'activities')),
        getDocsFromServer(collection(this.db, 'trips', tripDocument.id, 'expenses')),
      ]);
      const { ownerId: _ownerId, ...fields } = tripDocument.data();

      return requireValidTrip({
        ...fields,
        id: tripDocument.id,
        activities: activitiesSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as Activity[],
        expenses: expensesSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as Expense[],
      });
    }));
  }

  async saveTrip(trip: Trip): Promise<void> {
    requireNetwork();
    trip = requireValidTrip(trip);
    const user = this.requireUser();
    const { id, activities: _activities, expenses: _expenses, ...fields } = trip;
    await runTransaction(this.db, async (transaction) => { transaction.set(doc(this.db, 'trips', id), {
      ...fields,
      ownerId: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true }); });
  }

  async saveCurrencyConversion(trip: Trip): Promise<void> {
    requireNetwork();
    trip = requireValidTrip(trip);
    const user = this.requireUser();
    if (trip.expenses.length > 499) throw new Error('This trip has too many expenses to convert in one safe operation.');
    const { id, activities: _activities, expenses, ...fields } = trip;
    await runTransaction(this.db, async (batch) => {
    batch.set(doc(this.db, 'trips', id), {
      ...fields,
      ownerId: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    expenses.forEach((expense) => {
      const { id: expenseId, ...expenseFields } = expense;
      batch.set(doc(this.db, 'trips', id, 'expenses', expenseId), expenseFields);
    });
    });
  }

  async setTripArchived(tripId: string, archived: boolean): Promise<void> {
    requireNetwork();
    recordId.parse(tripId);
    const user = this.requireUser();
    await runTransaction(this.db, async (transaction) => { transaction.update(doc(this.db, 'trips', tripId), {
      archived,
      ownerId: user.uid,
      updatedAt: serverTimestamp(),
    }); });
  }

  async saveActivity(tripId: string, activity: Activity): Promise<void> {
    requireNetwork();
    recordId.parse(tripId);
    activity = activitySchema.parse(activity);
    this.requireUser();
    const { id, ...fields } = activity;
    await runTransaction(this.db, async (transaction) => { transaction.set(doc(this.db, 'trips', tripId, 'activities', id), fields); });
  }

  async deleteActivity(tripId: string, activityId: string): Promise<void> {
    requireNetwork();
    recordId.parse(tripId);
    recordId.parse(activityId);
    this.requireUser();
    await runTransaction(this.db, async (transaction) => { transaction.delete(doc(this.db, 'trips', tripId, 'activities', activityId)); });
  }

  async saveExpense(tripId: string, expense: Expense): Promise<void> {
    requireNetwork();
    recordId.parse(tripId);
    expense = expenseSchema.parse(expense);
    this.requireUser();
    const { id, ...fields } = expense;
    await runTransaction(this.db, async (transaction) => { transaction.set(doc(this.db, 'trips', tripId, 'expenses', id), fields); });
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    requireNetwork();
    recordId.parse(tripId);
    recordId.parse(expenseId);
    this.requireUser();
    await runTransaction(this.db, async (transaction) => { transaction.delete(doc(this.db, 'trips', tripId, 'expenses', expenseId)); });
  }

  private requireUser() {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Sign in before accessing trip data.');
    return user;
  }
}
