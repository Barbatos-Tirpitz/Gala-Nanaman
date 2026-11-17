import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_SETTINGS, formatTime } from './settings';

describe('user settings', () => {
  it('defaults new user preferences to PHP and 24-hour time', () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({ timeFormat: '24h', defaultCurrencyCode: 'PHP' });
  });

  it('formats stored 24-hour time in either display style', () => {
    expect(formatTime('17:05', '24h')).toBe('17:05');
    expect(formatTime('17:05', '12h')).toBe('5:05 PM');
    expect(formatTime('00:10', '12h')).toBe('12:10 AM');
    expect(formatTime('12:00', '12h')).toBe('12:00 PM');
  });
});
