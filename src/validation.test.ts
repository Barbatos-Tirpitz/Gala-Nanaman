import { expect, it } from 'vitest';
import { activitySchema, expenseSchema, recordId } from './validation';

it('preserves legitimate text and code-looking text as data', () => {
  const title = "O'Brien 東京 <script>alert(1)</script>";
  expect(activitySchema.parse({ id: 'one', title, date: '2028-01-01', startTime: '09:00', endTime: '10:00', category: 'Explore', notes: '' }).title).toBe(title);
});

it('rejects path segments, impossible dates and inconsistent splits', () => {
  expect(recordId.safeParse('../other').success).toBe(false);
  expect(activitySchema.safeParse({ id: 'one', title: 'Walk', date: '2027-02-29', startTime: '09:00', endTime: '10:00', category: 'Explore', notes: '' }).success).toBe(false);
  expect(expenseSchema.safeParse({ id: 'one', title: 'Food', date: '2028-01-01', amountMinor: 5, paidBy: 'A', splits: [{ person: 'A', amountMinor: 4 }] }).success).toBe(false);
});