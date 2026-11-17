import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import type { Activity, Expense, Trip } from '../types';
import type { TripRepository } from './TripRepository';

export class FirestoreTripRepository implements TripRepository {
  constructor(private readonly db: Firestore, private readonly auth: Auth) {}

  async listTrips(): Promise<Trip[]> {
    const user = this.requireUser();
    const tripsQuery = query(collection(this.db, 'trips'), where('ownerId', '==', user.uid));
    const snapshot = await getDocs(tripsQuery);

    return Promise.all(snapshot.docs.map(async (tripDocument) => {
      const [activitiesSnapshot, expensesSnapshot] = await Promise.all([
        getDocs(collection(this.db, 'trips', tripDocument.id, 'activities')),
        getDocs(collection(this.db, 'trips', tripDocument.id, 'expenses')),
      ]);
      const { ownerId: _ownerId, ...fields } = tripDocument.data();

      return {
        ...fields,
        id: tripDocument.id,
        activities: activitiesSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as Activity[],
        expenses: expensesSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as Expense[],
      } as Trip;
    }));
  }

  async saveTrip(trip: Trip): Promise<void> {
    const user = this.requireUser();
    const { id, activities: _activities, expenses: _expenses, ...fields } = trip;
    await setDoc(doc(this.db, 'trips', id), {
      ...fields,
      ownerId: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  async saveCurrencyConversion(trip: Trip): Promise<void> {
    const user = this.requireUser();
    if (trip.expenses.length > 499) throw new Error('This trip has too many expenses to convert in one safe operation.');
    const { id, activities: _activities, expenses, ...fields } = trip;
    const batch = writeBatch(this.db);
    batch.set(doc(this.db, 'trips', id), {
      ...fields,
      ownerId: user.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    expenses.forEach((expense) => {
      const { id: expenseId, ...expenseFields } = expense;
      batch.set(doc(this.db, 'trips', id, 'expenses', expenseId), expenseFields);
    });
    await batch.commit();
  }

  async setTripArchived(tripId: string, archived: boolean): Promise<void> {
    const user = this.requireUser();
    await updateDoc(doc(this.db, 'trips', tripId), {
      archived,
      ownerId: user.uid,
      updatedAt: serverTimestamp(),
    });
  }

  async saveActivity(tripId: string, activity: Activity): Promise<void> {
    this.requireUser();
    const { id, ...fields } = activity;
    await setDoc(doc(this.db, 'trips', tripId, 'activities', id), fields);
  }

  async deleteActivity(tripId: string, activityId: string): Promise<void> {
    this.requireUser();
    await deleteDoc(doc(this.db, 'trips', tripId, 'activities', activityId));
  }

  async saveExpense(tripId: string, expense: Expense): Promise<void> {
    this.requireUser();
    const { id, ...fields } = expense;
    await setDoc(doc(this.db, 'trips', tripId, 'expenses', id), fields);
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    this.requireUser();
    await deleteDoc(doc(this.db, 'trips', tripId, 'expenses', expenseId));
  }

  private requireUser() {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Sign in before accessing trip data.');
    return user;
  }
}
