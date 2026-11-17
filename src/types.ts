export type ActivityCategory = 'Explore' | 'Food' | 'Stay' | 'Transit';

export interface PlaceLocation {
  label: string;
  latitude: number;
  longitude: number;
  searchTerm?: string;
}

export interface Activity {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: ActivityCategory;
  notes: string;
  location?: PlaceLocation;
  outfitOfDay?: boolean;
  outfitNotes?: string;
  outfitPhoto?: { id: string; name: string; mimeType: string; size: number } | null;
  photos?: Array<{ id: string; name: string; mimeType: string; size: number }>;
}

export interface ExpenseSplit {
  person: string;
  amountMinor: number;
}

export interface Expense {
  id: string;
  title: string;
  date: string;
  amountMinor: number;
  paidBy: string;
  splits: ExpenseSplit[];
  activityId?: string;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  currencyCode: string;
  budgetMinor: number;
  activities: Activity[];
  expenses: Expense[];
  completedDayDates?: string[];
}
