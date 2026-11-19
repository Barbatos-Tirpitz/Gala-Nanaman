import { describe, expect, it } from 'vitest';
import { addCalendarDay, isCalendarDate } from './calendar';

describe('calendar dates', () => {
  it('advances across months, years and leap days', () => {
    expect(addCalendarDay('2028-02-28')).toBe('2028-02-29');
    expect(addCalendarDay('2028-02-29')).toBe('2028-03-01');
    expect(addCalendarDay('2027-12-31')).toBe('2028-01-01');
  });
  it('rejects invalid and executable-looking values', () => {
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('<script>')).toBe(false);
    expect(() => addCalendarDay('2027-13-01')).toThrow();
  });
});