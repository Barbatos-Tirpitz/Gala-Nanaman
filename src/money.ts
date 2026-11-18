export function currencyFractionDigits(currencyCode: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function parseAmountToMinorUnits(value: string, currencyCode: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;

  const digits = currencyFractionDigits(currencyCode);
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > digits) return undefined;

  const factor = 10 ** digits;
  const minorUnits = Number(whole) * factor + Number(fraction.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minorUnits) ? minorUnits : undefined;
}

export function formatAmount(minorUnits: number, currencyCode: string): string {
  const digits = currencyFractionDigits(currencyCode);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minorUnits / (10 ** digits));
}
