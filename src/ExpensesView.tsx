import { useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Pencil, Plus, Receipt, Trash2, Users, X } from 'lucide-react';
import { calculateNetBalances, splitEvenly, suggestSettlements, type Settlement } from './expenses';
import { createId } from './storage';
import { formatAmount, parseAmountToMinorUnits } from './money';
import ModalShell from './ModalShell';
import type { Expense, ExpenseSplit, Trip } from './types';

const MAX_SPLIT_PEOPLE = 30;

interface ExpenseDraft {
  title: string;
  date: string;
  amountMinor: number;
  paidBy: string;
  splits: ExpenseSplit[];
  activityId?: string;
}

interface ExpensesViewProps {
  trip: Trip;
  initialActivityId?: string;
  readOnly?: boolean;
  onSave: (expense: Expense, id?: string) => Promise<void>;
  onDelete: (expense: Expense) => void;
}

interface SplitRow {
  id: string;
  person: string;
  amount: string;
}

function amountForInput(amountMinor: number, currencyCode: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
  return (amountMinor / (10 ** digits)).toFixed(digits);
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function ExpenseDialog({
  currencyCode,
  activities,
  initialActivityId,
  expense,
  readOnly,
  onClose,
  onSave,
}: {
  currencyCode: string;
  activities: Trip['activities'];
  initialActivityId?: string;
  expense?: Expense;
  readOnly: boolean;
  onClose: () => void;
  onSave: (draft: ExpenseDraft, id?: string) => Promise<void>;
}) {
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(() => {
    if (!expense || expense.splits.length < 2) return 'equal';
    return expense.splits.every((split) => split.amountMinor === expense.splits[0].amountMinor) ? 'equal' : 'custom';
  });
  const [amount, setAmount] = useState(expense ? amountForInput(expense.amountMinor, currencyCode) : '');
  const [rows, setRows] = useState<SplitRow[]>(() => expense
    ? expense.splits.map((split) => ({ id: createId(), person: split.person, amount: amountForInput(split.amountMinor, currencyCode) }))
    : [{ id: createId(), person: '', amount: '' }, { id: createId(), person: '', amount: '' }]);
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? '');
  const [activityId, setActivityId] = useState(expense?.activityId ?? initialActivityId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newId] = useState(createId);
  const amountMinor = parseAmountToMinorUnits(amount, currencyCode);
  const participants = rows.map((row) => row.person.trim()).filter(Boolean);
  const selectedPayer = participants.includes(paidBy) ? paidBy : participants[0] ?? '';
  const equalPreview = amountMinor !== undefined && participants.length > 0
    ? splitEvenly(amountMinor, participants)
    : [];

  function updateRow(id: string, field: 'person' | 'amount', value: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !navigator.onLine || saving) return;
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get('title')).trim();
    const date = String(formData.get('date'));
    const linkedActivityId = String(formData.get('activityId') ?? '').trim();
    const total = parseAmountToMinorUnits(amount, currencyCode);
    const names = rows.map((row) => row.person.trim()).filter(Boolean);

    if (!total || !names.length || !selectedPayer) {
      setError('Enter an amount, a payer, and at least one person to split with.');
      return;
    }
    if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) {
      setError('Each person can appear only once in the split.');
      return;
    }

    let splits: ExpenseSplit[];
    if (splitMode === 'equal') {
      splits = splitEvenly(total, names);
    } else {
      const customSplits = rows.filter((row) => row.person.trim()).map((row) => ({
        person: row.person.trim(),
        amountMinor: parseAmountToMinorUnits(row.amount, currencyCode),
      }));
      if (customSplits.some((split) => split.amountMinor === undefined)) {
        setError('Enter a valid share for each person.');
        return;
      }
      splits = customSplits as ExpenseSplit[];
      if (splits.reduce((sum, split) => sum + split.amountMinor, 0) !== total) {
        setError('Custom shares must add up exactly to the expense total.');
        return;
      }
    }

    setSaving(true);
    try {
      await onSave({ title, date, amountMinor: total, paidBy: selectedPayer, splits, ...(linkedActivityId ? { activityId: linkedActivityId } : {}) }, expense?.id ?? newId);
    } catch { setError('Expense could not be saved. Your draft is still here to retry.'); }
    finally { setSaving(false); }
  }

  return (
    <ModalShell title={expense ? 'Edit expense' : 'Add expense'} onClose={() => { if (!saving) onClose(); }}>
        <form className="dialog-form" onSubmit={handleSubmit}>
          {readOnly && <p role="status">Read-only while disconnected. Your draft is kept here.</p>}
          <fieldset className="form-fields" disabled={readOnly || saving}>
          <label>
            Expense name
            <input name="title" defaultValue={expense?.title} required maxLength={80} autoFocus placeholder="Dinner, train tickets…" />
          </label>
          <div className="field-row">
            <label>
              Amount ({currencyCode})
              <input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="0" />
            </label>
            <label>
              Date
              <input name="date" type="date" defaultValue={expense?.date ?? todayLocal()} required />
            </label>
          </div>
          <label>
            Itinerary activity <span className="optional-label">Optional</span>
            <select name="activityId" value={activityId} onChange={(event) => setActivityId(event.target.value)}>
              <option value="">General trip expense</option>
              {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.title}</option>)}
            </select>
          </label>
          <div className="split-editor-heading">
            <strong>Split this expense</strong>
            <div className="segmented-control" role="group" aria-label="Expense split method">
              <button type="button" className={splitMode === 'equal' ? 'selected' : ''} aria-pressed={splitMode === 'equal'} onClick={() => { setSplitMode('equal'); setError(''); }}>Equal</button>
              <button type="button" className={splitMode === 'custom' ? 'selected' : ''} aria-pressed={splitMode === 'custom'} onClick={() => { setSplitMode('custom'); setError(''); }}>Custom</button>
            </div>
          </div>
          <div className="split-rows">
            {rows.map((row, index) => (
              <div className="split-row" key={row.id}>
                <label>
                  <span className="sr-only">Person {index + 1}</span>
                  <input value={row.person} onChange={(event) => updateRow(row.id, 'person', event.target.value)} maxLength={60} placeholder="Person's name" />
                </label>
                {splitMode === 'custom' ? (
                  <label>
                    <span className="sr-only">Share in {currencyCode}</span>
                    <input type="number" min="0" step="any" value={row.amount} onChange={(event) => updateRow(row.id, 'amount', event.target.value)} placeholder={currencyCode} />
                  </label>
                ) : (
                  <span className="split-preview">{equalPreview[index] ? formatAmount(equalPreview[index].amountMinor, currencyCode) : 'Equal share'}</span>
                )}
                <button className="icon-button danger-hover" type="button" aria-label={`Remove person ${index + 1}`} disabled={rows.length <= 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}><X size={15} /></button>
              </div>
            ))}
          </div>
          <button className="add-split-person" type="button" disabled={rows.length >= MAX_SPLIT_PEOPLE} onClick={() => setRows((current) => [...current, { id: createId(), person: '', amount: '' }])}><Plus size={14} /> Add person</button>
          <label>
            Paid by
            <select name="paidBy" value={selectedPayer} onChange={(event) => setPaidBy(event.target.value)} required disabled={!participants.length}>
              {!participants.length && <option value="">Add split participants first</option>}
              {participants.map((person) => <option key={person} value={person}>{person}</option>)}
            </select>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="button button-quiet" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving}><Check size={16} /> {saving ? 'Saving...' : 'Save expense'}</button>
          </div>
          </fieldset>
        </form>
    </ModalShell>
  );
}

function settlementText(settlement: Settlement, currencyCode: string): string {
  return `${settlement.from} pays ${settlement.to} ${formatAmount(settlement.amountMinor, currencyCode)}`;
}

export default function ExpensesView({ trip, readOnly = false, initialActivityId, onSave, onDelete }: ExpensesViewProps) {
  const [dialogExpense, setDialogExpense] = useState<Expense | null | undefined>(undefined);
  const [newExpenseActivityId, setNewExpenseActivityId] = useState(initialActivityId);
  const expenses = trip.expenses ?? [];
  const totalSpent = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const remaining = trip.budgetMinor > 0 ? trip.budgetMinor - totalSpent : undefined;
  const balances = calculateNetBalances(expenses);
  const settlements = suggestSettlements(expenses);
  const budgetPercent = trip.budgetMinor > 0 ? Math.min(100, (totalSpent / trip.budgetMinor) * 100) : 0;

  function openNewExpense(activityId = newExpenseActivityId) {
    setNewExpenseActivityId(activityId);
    setDialogExpense(null);
  }

  async function saveExpense(draft: ExpenseDraft, id?: string) {
    await onSave({ ...draft, id: id ?? createId() }, id);
    setDialogExpense(undefined);
    setNewExpenseActivityId(undefined);
  }

  return (
    <div className="content-wrap expenses-wrap">
      <section className="expenses-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> TRIP FINANCES</div>
          <h1>Expenses</h1>
          <p>Track shared spending for {trip.name}.</p>
        </div>
        <button className="button button-primary" disabled={readOnly} onClick={() => openNewExpense()}><Plus size={17} /> Add expense</button>
      </section>

      <section className="finance-summary" aria-label="Budget summary">
        <div className="finance-metric budget-metric">
          <span>TRIP BUDGET</span>
          <strong>{trip.budgetMinor > 0 ? formatAmount(trip.budgetMinor, trip.currencyCode) : 'Not set'}</strong>
          {trip.budgetMinor > 0 && <div className="budget-progress" aria-label={`${Math.round(budgetPercent)} percent of budget used`}><span style={{ width: `${budgetPercent}%` }} /></div>}
        </div>
        <div className="finance-metric">
          <span>TOTAL SPENT</span>
          <strong>{formatAmount(totalSpent, trip.currencyCode)}</strong>
          <small>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}</small>
        </div>
        <div className={`finance-metric ${remaining !== undefined && remaining < 0 ? 'over-budget' : ''}`}>
          <span>{remaining !== undefined ? 'BUDGET LEFT' : 'BUDGET STATUS'}</span>
          <strong>{remaining !== undefined ? formatAmount(remaining, trip.currencyCode) : 'Not set'}</strong>
          <small>{remaining !== undefined && remaining < 0 ? 'Over budget' : remaining === undefined ? 'Set a budget in trip details' : 'Based on recorded expenses'}</small>
        </div>
      </section>

      <div className="finance-columns">
        <section className="expense-list-section" aria-label="Trip expenses">
          <div className="finance-section-heading"><div><h2>Recorded expenses</h2><p>Amounts are in {trip.currencyCode}.</p></div><span>{expenses.length}</span></div>
          {expenses.length ? (
            <div className="expense-list">
              {expenses.slice().sort((left, right) => right.date.localeCompare(left.date)).map((expense) => (
                <article className="expense-row" key={expense.id}>
                  <span className="expense-icon"><Receipt size={17} /></span>
                  <div className="expense-copy"><strong>{expense.title}</strong><span>{expense.date} · Paid by {expense.paidBy}</span>{expense.activityId && <small>Itinerary: {trip.activities.find((activity) => activity.id === expense.activityId)?.title ?? 'Activity'}</small>}<small>Split between {expense.splits.map((split) => split.person).join(', ')}</small></div>
                  <strong className="expense-amount">{formatAmount(expense.amountMinor, trip.currencyCode)}</strong>
                  <div className="expense-actions">
                    <button className="icon-button" disabled={readOnly} aria-label={`Edit ${expense.title}`} title="Edit expense" onClick={() => setDialogExpense(expense)}><Pencil size={15} /></button>
                    <button className="icon-button danger-hover" disabled={readOnly} aria-label={`Delete ${expense.title}`} title="Delete expense" onClick={() => onDelete(expense)}><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="expense-empty"><span><Receipt size={20} /></span><strong>No expenses recorded</strong><p>Add a shared cost to see spending and balances here.</p><button className="button button-outline" disabled={readOnly} onClick={() => openNewExpense()}><Plus size={15} /> Add first expense</button></div>
          )}
        </section>

        <aside className="settlement-section" aria-label="Expense balances and settlements">
          <div className="finance-section-heading"><div><h2>Balances</h2><p>Net paid versus each person's share.</p></div><Users size={17} /></div>
          {balances.length ? (
            <div className="balance-list">
              {balances.map((balance) => (
                <div className="balance-row" key={balance.person}>
                  <span className="balance-avatar">{balance.person.slice(0, 1).toUpperCase()}</span>
                  <strong>{balance.person}</strong>
                  <span className={balance.amountMinor > 0 ? 'balance-positive' : 'balance-negative'}>{balance.amountMinor > 0 ? '+' : '−'}{formatAmount(Math.abs(balance.amountMinor), trip.currencyCode)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="balance-empty">Add expenses with split participants to calculate balances.</div>
          )}
          {settlements.length > 0 && (
            <div className="settlement-list">
              <h3>Suggested settlements</h3>
              {settlements.map((settlement, index) => <p key={`${settlement.from}-${settlement.to}-${index}`}><ArrowDownLeft size={14} /> {settlementText(settlement, trip.currencyCode)}</p>)}
            </div>
          )}
          {balances.length > 0 && settlements.length === 0 && <p className="settled-note"><ArrowUpRight size={14} /> All recorded shares are settled.</p>}
        </aside>
      </div>

      {dialogExpense !== undefined && <ExpenseDialog key={dialogExpense?.id ?? 'new-expense'} readOnly={readOnly} currencyCode={trip.currencyCode} activities={trip.activities} initialActivityId={newExpenseActivityId} expense={dialogExpense ?? undefined} onClose={() => { setDialogExpense(undefined); setNewExpenseActivityId(undefined); }} onSave={saveExpense} />}
    </div>
  );
}
