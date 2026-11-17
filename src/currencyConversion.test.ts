import { describe, expect, it } from 'vitest';
import { convertExpense, convertMinorUnits } from './currencyConversion';

describe('currency conversion', () => {
  it('converts between currencies with different minor-unit precision', () => {
    expect(convertMinorUnits(1000, 'JPY', 'USD', 0.0067)).toBe(670);
    expect(convertMinorUnits(1234, 'USD', 'JPY', 150)).toBe(1851);
  });

  it('rounds converted splits so they add up to the converted expense total', () => {
    const converted = convertExpense({
      id: 'expense-1',
      title: 'Lunch',
      date: '2026-11-18',
      amountMinor: 1000,
      paidBy: 'Ari',
      splits: [
        { person: 'Ari', amountMinor: 500 },
        { person: 'Bo', amountMinor: 300 },
        { person: 'Casey', amountMinor: 200 },
      ],
    }, 'USD', 'EUR', 0.92345);

    expect(converted.amountMinor).toBe(923);
    expect(converted.splits.map((split) => split.amountMinor)).toEqual([461, 277, 185]);
    expect(converted.splits.reduce((sum, split) => sum + split.amountMinor, 0)).toBe(converted.amountMinor);
  });
});