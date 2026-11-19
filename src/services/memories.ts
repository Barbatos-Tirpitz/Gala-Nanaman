import type { Activity, Trip } from '../types';
import { isCalendarDate } from './calendar';

export interface MemoryDay {
  tripId: string;
  tripName: string;
  date: string;
  timeZone: string;
  activities: Activity[];
}

export function memoryDays(trips: Trip[]): MemoryDay[] {
  return trips.flatMap((trip) => [...new Set(trip.completedDayDates ?? [])]
    .filter(isCalendarDate)
    .map((date) => ({
      tripId: trip.id, tripName: trip.name, date, timeZone: trip.timeZone,
      activities: trip.activities.filter((activity) => activity.date === date)
        .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id)),
    })))
    .sort((left, right) => left.date.localeCompare(right.date) || left.tripId.localeCompare(right.tripId));
}

export function recapSummary(trips: Trip[]) {
  const days = memoryDays(trips);
  const activities = days.flatMap((day) => day.activities);
  return {
    tripCount: new Set(days.map((day) => day.tripId)).size,
    completedDateCount: new Set(days.map((day) => day.date)).size,
    activityCount: activities.length,
    categoryCounts: Object.fromEntries(['Explore', 'Food', 'Stay', 'Transit'].map((category) => [category, activities.filter((activity) => activity.category === category).length])),
    recordedLocations: activities.flatMap((activity) => activity.location ? [activity.location] : []),
    photoReferenceCount: new Set(activities.flatMap((activity) => [...(activity.photos ?? []), ...(activity.outfitPhoto ? [activity.outfitPhoto] : [])]).map((photo) => photo.id)).size,
  };
}