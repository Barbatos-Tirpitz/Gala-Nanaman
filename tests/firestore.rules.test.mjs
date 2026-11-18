import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

let testEnvironment;

const trip = (ownerId, overrides = {}) => ({
  name: 'Kyoto',
  destination: 'Kyoto, Japan',
  startDate: '2027-05-12',
  endDate: '2027-05-17',
  timeZone: 'Asia/Tokyo',
  currencyCode: 'JPY',
  budgetMinor: 120000,
  ownerId,
  updatedAt: serverTimestamp(),
  ...overrides,
});

const activity = (overrides = {}) => ({
  title: 'Shrine visit',
  date: '2027-05-13',
  startTime: '08:00',
  endTime: '10:30',
  category: 'Explore',
  notes: '',
  location: { label: 'Fushimi Inari, Kyoto, Japan', latitude: 34.967, longitude: 135.772, searchTerm: 'Fushimi Inari' },
  ...overrides,
});

const expense = (overrides = {}) => ({
  title: 'Train fare',
  date: '2027-05-13',
  amountMinor: 1000,
  paidBy: 'Ari',
  splits: [{ person: 'Ari', amountMinor: 500 }, { person: 'Bo', amountMinor: 500 }],
  ...overrides,
});

async function seedTrip(ownerId = 'user-a', tripId = 'trip-a') {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'trips', tripId), trip(ownerId));
  });
}

before(async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  testEnvironment = await initializeTestEnvironment({
    projectId: 'demo-gala-nanaman-rules-test',
    firestore: { rules },
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

test('unauthenticated clients cannot read or create trips', async () => {
  const db = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'trips', 'trip-a')));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a'), trip('user-a')));
});

test('an owner can create, list, and update their own trip', async () => {
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  await assertSucceeds(setDoc(doc(db, 'trips', 'trip-a'), trip('user-a')));
  const ownTrips = query(collection(db, 'trips'), where('ownerId', '==', 'user-a'));
  const snapshot = await assertSucceeds(getDocs(ownTrips));
  assert.equal(snapshot.size, 1);
  await assertSucceeds(updateDoc(doc(db, 'trips', 'trip-a'), { name: 'Kyoto 2027', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'trips', 'trip-a'), { archived: true, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'trips', 'trip-a'), { archived: false, updatedAt: serverTimestamp() }));
});

test('trip writes must match the schema and the signed-in owner', async () => {
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  await assertFails(setDoc(doc(db, 'trips', 'trip-b'), trip('user-b')));
  await assertFails(setDoc(doc(db, 'trips', 'trip-c'), trip('user-a', { currencyCode: 'XYZ' })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-d'), trip('user-a', { endDate: '2027-05-01' })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-e'), trip('user-a', { isAdmin: true })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-f'), trip('user-a', { name: 'x'.repeat(71) })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-g'), trip('user-a', { archived: 'yes' })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-h'), trip('user-a', { completedDayDates: '2027-05-13' })));
});

test('an owner cannot transfer a trip to another account', async () => {
  await seedTrip();
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  await assertFails(updateDoc(doc(db, 'trips', 'trip-a'), { ownerId: 'user-b', updatedAt: serverTimestamp() }));
});

test('another account cannot read, change, or add records to an owned trip', async () => {
  await seedTrip();
  const db = testEnvironment.authenticatedContext('user-b').firestore();
  await assertFails(getDoc(doc(db, 'trips', 'trip-a')));
  await assertFails(getDocs(query(collection(db, 'trips'), where('ownerId', '==', 'user-a'))));
  await assertFails(updateDoc(doc(db, 'trips', 'trip-a'), { name: 'Taken over', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'trips', 'trip-a'), { archived: true, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'activity-a'), activity()));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'expenses', 'expense-a'), expense()));
  await assertFails(getDocs(collection(db, 'trips', 'trip-a', 'expenses')));
});

test('owners can manage valid activities and expenses', async () => {
  await seedTrip();
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  const { location: _location, ...activityWithoutPlace } = activity();
  await assertSucceeds(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'activity-a'), activity()));
  await assertSucceeds(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'no-place'), activityWithoutPlace));
  await assertSucceeds(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'outfit'), activity({ outfitOfDay: true, outfitNotes: 'Rain layer', outfitPhoto: { id: 'photo-outfit', name: 'jacket.jpg', mimeType: 'image/jpeg', size: 1024 }, photos: [{ id: 'photo-a', name: 'street.jpg', mimeType: 'image/jpeg', size: 1024 }] })));
  await assertSucceeds(setDoc(doc(db, 'trips', 'trip-a', 'expenses', 'expense-a'), expense({ activityId: 'activity-a' })));
  await assertSucceeds(updateDoc(doc(db, 'trips', 'trip-a'), { completedDayDates: ['2027-05-13'], updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(db, 'trips', 'trip-a', 'activities', 'activity-a')));
});

test('activity and expense writes are validated', async () => {
  await seedTrip();
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'bad-time'), activity({ endTime: '07:00' })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'bad-place'), activity({ location: { label: 'Nowhere', latitude: 120, longitude: 0 } })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'extra-field'), activity({ ownerId: 'user-b' })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'too-many-photos'), activity({ photos: Array.from({ length: 6 }, (_, index) => ({ id: `photo-${index}`, name: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 })) })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'bad-photo-entry'), activity({ photos: [{ id: 'photo-a', name: 'photo.jpg', mimeType: 'text/plain', size: 1024 }] })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'bad-outfit-flag'), activity({ outfitOfDay: 'yes' })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'bad-outfit-photo'), activity({ outfitPhoto: { id: 'photo-outfit', name: 'jacket.jpg', mimeType: 'text/plain', size: 1024 } })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'activities', 'large-outfit-photo'), activity({ outfitPhoto: { id: 'photo-outfit', name: 'jacket.jpg', mimeType: 'image/jpeg', size: 5242881 } })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'expenses', 'zero'), expense({ amountMinor: 0 })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'expenses', 'no-splits'), expense({ splits: [] })));
  await assertFails(setDoc(doc(db, 'trips', 'trip-a', 'expenses', 'missing-activity'), expense({ activityId: 'missing' })));
});

test('records cannot be added to a trip that does not exist', async () => {
  const db = testEnvironment.authenticatedContext('user-a').firestore();
  await assertFails(setDoc(doc(db, 'trips', 'missing', 'activities', 'activity-a'), activity()));
  await assertFails(setDoc(doc(db, 'trips', 'missing', 'expenses', 'expense-a'), expense()));
});
