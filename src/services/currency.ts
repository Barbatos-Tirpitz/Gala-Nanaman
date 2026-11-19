export interface ExchangeRate {
  base: string;
  quote: string;
  rate: number;
  date: string;
}

export async function fetchExchangeRate(base: string, quote: string): Promise<ExchangeRate> {
  const url = new URL('https://api.frankfurter.dev/v1/latest');
  url.searchParams.set('base', base);
  url.searchParams.set('symbols', quote);
  const response = await fetch(url);
  if (!response.ok) throw new Error('The live exchange rate is unavailable. Try again before changing the trip currency.');

  const result: unknown = await response.json();
  if (typeof result !== 'object' || result === null || !('rates' in result) || !('date' in result)) {
    throw new Error('The exchange-rate response was invalid. The trip currency was not changed.');
  }

  const rates = result.rates;
  const date = result.date;
  const rate = typeof rates === 'object' && rates !== null && quote in rates
    ? Number((rates as Record<string, unknown>)[quote])
    : Number.NaN;
  if (!Number.isFinite(rate) || rate <= 0 || typeof date !== 'string') {
    throw new Error('The live exchange rate is unavailable. Try again before changing the trip currency.');
  }

  return { base, quote, rate, date };
}