import { expect, it } from 'vitest';
import { memoryDays, recapSummary } from './memories';
import type { Trip } from '../types';

const trip: Trip = { id: 'one', name: "O'Brien <script>", destination: 'Tokyo', startDate: '2028-01-01', endDate: '2028-01-03', timeZone: 'Asia/Tokyo', currencyCode: 'JPY', budgetMinor: 0, expenses: [], completedDayDates: ['2028-01-01', '2028-01-01', '2028-01-02', 'invalid'], activities: [
  { id: 'late', title: 'Dinner', date: '2028-01-01', startTime: '18:00', endTime: '19:00', category: 'Food', notes: '' },
  { id: 'early', title: 'Walk', date: '2028-01-01', startTime: '09:00', endTime: '10:00', category: 'Explore', notes: '' },
] };

it('retains empty days, sorts activities and separates overlapping archived trips', () => {
  const days = memoryDays([trip, { ...trip, id: 'two', archived: true }]);
  expect(days).toHaveLength(4);
  expect(days[0].activities.map((activity) => activity.id)).toEqual(['early', 'late']);
  expect(days[0].tripName).toBe(trip.name);
  expect(days[2].activities).toEqual([]);
  expect(recapSummary([trip]).activityCount).toBe(2);
  expect(recapSummary([trip]).completedDateCount).toBe(2);
});

it('removes unmarked days without inventing capture or visit data', () => {
  expect(memoryDays([{ ...trip, completedDayDates: [] }])).toEqual([]);
  expect(recapSummary([]).photoReferenceCount).toBe(0);
});