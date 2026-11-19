import { z } from 'zod';
import { isCalendarDate } from './services/calendar';
import { MAX_PHOTO_BYTES } from './photoProcessing';

const text = (maximum: number) => z.string().trim().min(1, 'Required.').max(maximum);
export const recordId = z.string().min(1).max(128).refine((value) => !value.includes('/') && value !== '.' && value !== '..', 'Invalid record ID.');
const date = z.string().refine(isCalendarDate, 'Choose a valid calendar date.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid time.');
const amount = z.number().int().min(0).max(1_000_000_000_000);
export const photoSchema = z.object({ id: recordId, name: text(120), mimeType: z.string().regex(/^image\//), size: z.number().int().min(1).max(MAX_PHOTO_BYTES) });
export const activitySchema = z.object({
  id: recordId, title: text(90), date, startTime: time, endTime: time,
  category: z.enum(['Explore', 'Food', 'Stay', 'Transit']), notes: z.string().max(400),
  location: z.object({ label: text(200), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), searchTerm: text(200).optional() }).optional(),
  outfitOfDay: z.boolean().optional(), outfitNotes: z.string().max(300).optional(),
  outfitPhoto: photoSchema.nullable().optional(), photos: z.array(photoSchema).max(5).optional(),
}).refine((value) => value.endTime > value.startTime, { path: ['endTime'], message: 'End time must be after start time.' });
export const expenseSchema = z.object({
  id: recordId, title: text(80), date, amountMinor: amount.min(1), paidBy: text(60),
  splits: z.array(z.object({ person: text(60), amountMinor: amount })).min(1).max(30), activityId: recordId.optional(),
}).refine((value) => value.splits.reduce((total, split) => total + split.amountMinor, 0) === value.amountMinor, { path: ['splits'], message: 'Shares must equal the expense total.' })
  .refine((value) => new Set(value.splits.map((split) => split.person.toLocaleLowerCase())).size === value.splits.length && value.splits.some((split) => split.person === value.paidBy), { path: ['splits'], message: 'Choose distinct participants and a payer from the split.' });
export const tripSchema = z.object({
  id: recordId, name: text(70), destination: text(80), startDate: date, endDate: date,
  timeZone: text(64).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose an IANA timezone.'),
  currencyCode: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'AUD', 'PHP']), budgetMinor: amount,
  archived: z.boolean().optional(), completedDayDates: z.array(date).max(366).optional(),
  activities: z.array(activitySchema), expenses: z.array(expenseSchema),
}).refine((value) => value.endDate >= value.startDate, { path: ['endDate'], message: 'End date cannot precede start date.' });

export function requireValidTrip(value: unknown) {
  return tripSchema.parse(value);
}