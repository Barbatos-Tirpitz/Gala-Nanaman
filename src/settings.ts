export type TimeFormat = '12h' | '24h';

export interface UserSettings {
  timeFormat: TimeFormat;
  defaultCurrencyCode: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  timeFormat: '24h',
  defaultCurrencyCode: 'PHP',
};

const SETTINGS_KEY = 'gala-nanaman:settings:v1';
const SUPPORTED_CURRENCIES = new Set(['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'AUD', 'PHP']);

export function loadUserSettings(): UserSettings {
  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_USER_SETTINGS;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return DEFAULT_USER_SETTINGS;
    const settings = value as Partial<UserSettings>;
    return {
      timeFormat: settings.timeFormat === '12h' ? '12h' : '24h',
      defaultCurrencyCode: settings.defaultCurrencyCode && SUPPORTED_CURRENCIES.has(settings.defaultCurrencyCode)
        ? settings.defaultCurrencyCode
        : DEFAULT_USER_SETTINGS.defaultCurrencyCode,
    };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function saveUserSettings(settings: UserSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function formatTime(value: string, timeFormat: TimeFormat): string {
  if (timeFormat === '24h') return value;
  const [hoursText, minutes] = value.split(':');
  const hours = Number(hoursText);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !minutes) return value;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${minutes} ${suffix}`;
}
