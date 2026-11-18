import type { Expense, ExpenseSplit } from './types';

export interface Settlement {
  from: string;
  to: string;
  amountMinor: number;
}

export function splitEvenly(amountMinor: number, people: string[]): ExpenseSplit[] {
  const baseShare = Math.floor(amountMinor / people.length);
  const remainder = amountMinor % people.length;

  return people.map((person, index) => ({
    person,
    amountMinor: baseShare + (index < remainder ? 1 : 0),
  }));
}

export function calculateNetBalances(expenses: Expense[]): Array<{ person: string; amountMinor: number }> {
  const balances = new Map<string, number>();

  for (const expense of expenses) {
    balances.set(expense.paidBy, (balances.get(expense.paidBy) ?? 0) + expense.amountMinor);
    for (const split of expense.splits) {
      balances.set(split.person, (balances.get(split.person) ?? 0) - split.amountMinor);
    }
  }

  return [...balances.entries()]
    .filter(([, amountMinor]) => amountMinor !== 0)
    .map(([person, amountMinor]) => ({ person, amountMinor }))
    .sort((left, right) => left.person.localeCompare(right.person));
}

export function suggestSettlements(expenses: Expense[]): Settlement[] {
  const balances = calculateNetBalances(expenses);
  const debtors = balances.filter((balance) => balance.amountMinor < 0)
    .map(({ person, amountMinor }) => ({ person, amountMinor: -amountMinor }))
    .sort((left, right) => right.amountMinor - left.amountMinor);
  const creditors = balances.filter((balance) => balance.amountMinor > 0)
    .map(({ person, amountMinor }) => ({ person, amountMinor }))
    .sort((left, right) => right.amountMinor - left.amountMinor);
  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = Math.min(debtor.amountMinor, creditor.amountMinor);

    settlements.push({ from: debtor.person, to: creditor.person, amountMinor });
    debtor.amountMinor -= amountMinor;
    creditor.amountMinor -= amountMinor;
    if (debtor.amountMinor === 0) debtorIndex += 1;
    if (creditor.amountMinor === 0) creditorIndex += 1;
  }

  return settlements;
}
