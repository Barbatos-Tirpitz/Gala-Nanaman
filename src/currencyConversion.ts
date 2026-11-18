import { currencyFractionDigits } from './money';
import type { Expense } from './types';

export function convertMinorUnits(amountMinor: number, base: string, quote: string, rate: number): number {
  const baseMajor = amountMinor / (10 ** currencyFractionDigits(base));
  const converted = Math.round(baseMajor * rate * (10 ** currencyFractionDigits(quote)));
  if (!Number.isSafeInteger(converted)) throw new Error('A converted amount is too large to save safely.');
  return converted;
}

function convertSplits(expense: Expense, convertedTotal: number): Expense['splits'] {
  if (!expense.splits.length) return [];
  const weights = expense.splits.map((split) => Math.max(0, split.amountMinor));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights = weightTotal > 0
    ? weights.map((weight) => weight / weightTotal)
    : weights.map(() => 1 / weights.length);
  const exactShares = normalizedWeights.map((weight) => convertedTotal * weight);
  const shares = exactShares.map(Math.floor);
  let remainder = convertedTotal - shares.reduce((sum, share) => sum + share, 0);
  const order = exactShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    shares[order[index % order.length].index] += 1;
  }

  return expense.splits.map((split, index) => ({ ...split, amountMinor: shares[index] }));
}

export function convertExpense(expense: Expense, base: string, quote: string, rate: number): Expense {
  const amountMinor = Math.max(1, convertMinorUnits(expense.amountMinor, base, quote, rate));
  return { ...expense, amountMinor, splits: convertSplits(expense, amountMinor) };
}