import type { Trip } from './types';

const STORAGE_KEY = 'gala-nanaman:prototype-trips:v1';
const supportedCurrencies = new Set(['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'AUD', 'PHP']);

const starterTrips: Trip[] = [
  {
    id: 'trip-kyoto-2027',
    name: 'Kyoto, at an easy pace',
    destination: 'Kyoto, Japan',
    startDate: '2027-05-12',
    endDate: '2027-05-17',
    timeZone: 'Asia/Tokyo',
    currencyCode: 'JPY',
    budgetMinor: 120000,
    activities: [
      {
        id: 'activity-arrival',
        title: 'Arrive at Kyoto Station',
        date: '2027-05-12',
        startTime: '14:20',
        endTime: '15:00',
        category: 'Transit',
        notes: 'Allow time to pick up the rail pass.',
      },
      {
        id: 'activity-check-in',
        title: 'Check in and settle in',
        date: '2027-05-12',
        startTime: '16:00',
        endTime: '17:00',
        category: 'Stay',
        notes: 'Keep the evening open after travel.',
      },
      {
        id: 'activity-fushimi',
        title: 'Fushimi Inari walk',
        date: '2027-05-13',
        startTime: '08:00',
        endTime: '10:30',
        category: 'Explore',
        notes: 'Start early and take the quieter upper trail.',
      },
      {
        id: 'activity-lunch',
        title: 'Lunch near the river',
        date: '2027-05-13',
        startTime: '12:15',
        endTime: '13:15',
        category: 'Food',
        notes: '',
      },
      {
        id: 'activity-nara',
        title: 'Nara day trip',
        date: '2027-05-14',
        startTime: '09:10',
        endTime: '16:30',
        category: 'Explore',
        notes: 'Train from Kyoto Station; keep the return flexible.',
      },
    ],
    expenses: [],
  },
];

export function loadTrips(): Trip[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return starterTrips;

    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.map((trip) => ({
        ...trip,
        currencyCode: supportedCurrencies.has(trip.currencyCode) ? trip.currencyCode : 'USD',
        budgetMinor: Number.isSafeInteger(trip.budgetMinor) ? trip.budgetMinor : 0,
        activities: Array.isArray(trip.activities) ? trip.activities : [],
        expenses: Array.isArray(trip.expenses) ? trip.expenses : [],
      })) as Trip[];
    }
  } catch {
    return starterTrips;
  }

  return starterTrips;
}

export function saveTrips(trips: Trip[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

export function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `trip-${Date.now()}-${suffix}`;
  }
  throw new Error('Secure random generator is unavailable in this environment.');
}
