import { useEffect, useState } from "react";
import type { SVGProps } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState } from "@/components/Card";
import { ErrorBanner } from "@/components/ui/Callout";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency, currentMonthKey, shiftMonthKey, formatMonthKey } from "@/lib/currency";
import { formatDateOnly, toDateKey } from "@/lib/date";
import { ChevronIcon, WalletIcon } from "@/components/ui/icons";
import { focusField } from "@/lib/focusField";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";
import { IconButton } from "@/components/ui/IconButton";
import { FormField } from "@/components/ui/FormField";
import { ShowMore, useIncrementalList } from "@/components/ui/ShowMore";
import { ColorSwatchInput } from "@/components/ui/ColorSwatchInput";
import {
  createCategory,
  createTransaction,
  deleteCategory,
  deleteTransaction,
  getFinanceStats,
  getFinanceSummary,
  listCategories,
  listTransactions,
  reorderCategories,
  updateCategory,
  updateTransaction,
} from "@/lib/ipc/finance";
import type {
  FinanceCategory,
  FinanceStats,
  FinanceSummary,
  NewFinanceCategory,
  NewTransaction,
  Transaction,
  TransactionType,
  UserSettings,
} from "@/types";

// ---- Icons (local, stroke-based — matches the icon style already
// established in Pomodoro.tsx's PlayIcon/PauseIcon/ResetIcon) ----

function TrendUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 13.5 8.5 9l3 3 4.5-5.5" />
      <path d="M12.5 6.2h3.3v3.3" />
    </svg>
  );
}

function TrendDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 6.5 8.5 11l3-3 4.5 5.5" />
      <path d="M12.5 13.8h3.3v-3.3" />
    </svg>
  );
}

function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="10" cy="10" r="6.3" />
      <circle cx="10" cy="10" r="3" />
      <circle cx="10" cy="10" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ---- Small local presentational helpers (same pattern as StudyAnalytics'
// GoalBar/BreakdownCard, Dashboard's StatCell — kept local, not shared,
// since each is a couple of lines specific to this page) ----

const TYPE_LABEL: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  saving: "Saving",
};

// Pill badge coloring for the transaction list — same soft-background/
// accent-text pattern Tasks.tsx's PRIORITY_BADGE established.
const TYPE_BADGE: Record<TransactionType, string> = {
  income: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expense: "bg-red-500/10 text-red-700 dark:text-red-300",
  saving: "bg-accent-soft text-accent-text",
};

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "saving", label: "Saving" },
];

// SelectMenu is string-keyed — categoryId is a number (or null for "no
// category") — same NO_COURSE-style sentinel pattern Pomodoro.tsx uses for
// its course/subject pickers.
const NO_CATEGORY = "none";

const EMPTY_TX_FORM: NewTransaction = {
  categoryId: null,
  amount: 0,
  type: "expense",
  occurredOn: toDateKey(new Date()),
  description: "",
};

const EMPTY_CATEGORY_FORM: NewFinanceCategory = { name: "", color: "#4f7cff", budgetAmount: null };

const STATS_RANGES: { value: string; label: string }[] = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "Year" },
];

function monthBucketLabel(monthKey: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = monthKey.split("-");
  return `${names[Number(m) - 1] ?? monthKey} '${y.slice(2)}`;
}

export function FinancesPage({ settings }: { settings: UserSettings }) {
  const currency = settings.currency;

  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [month, setMonth] = useState(currentMonthKey());
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Only the first page of the month's transactions is rendered (see ShowMore.tsx).
  const txPage = useIncrementalList(transactions, month);
  const [statsRange, setStatsRange] = useState(3);
  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [txForm, setTxForm] = useState<NewTransaction>(EMPTY_TX_FORM);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);

  const [categoryForm, setCategoryForm] = useState<NewFinanceCategory>(EMPTY_CATEGORY_FORM);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  async function refreshCategories() {
    try {
      setCategories(await listCategories());
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshMonth() {
    try {
      const [s, t] = await Promise.all([getFinanceSummary(month), listTransactions(month)]);
      setSummary(s);
      setTransactions(t);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshStats() {
    try {
      setStats(await getFinanceStats(statsRange));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refreshCategories();
  }, []);

  useEffect(() => {
    refreshMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    // Reset to null (not just re-fetch in place) so the chart card shows
    // its loading skeleton on every range switch — mirrors StudyAnalytics'
    // own range-switch behavior, so the two "pick a time range" controls
    // in the app feel the same.
    setStats(null);
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsRange]);

  // ---- Transactions ----

  async function submitTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!txForm.amount || txForm.amount <= 0) return;
    try {
      if (editingTxId !== null) {
        await updateTransaction(editingTxId, txForm);
      } else {
        await createTransaction(txForm);
      }
      setTxForm({ ...EMPTY_TX_FORM, occurredOn: txForm.occurredOn });
      setEditingTxId(null);
      await refreshMonth();
      await refreshStats();
    } catch (err) {
      setError(String(err));
    }
  }

  function startEditTransaction(tx: Transaction) {
    setEditingTxId(tx.id);
    setTxForm({
      categoryId: tx.categoryId,
      amount: tx.amount,
      type: tx.type,
      occurredOn: tx.occurredOn,
      description: tx.description ?? "",
    });
  }

  async function removeTransaction(id: number) {
    try {
      await deleteTransaction(id);
      await refreshMonth();
      await refreshStats();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Categories ----

  async function submitCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;
    try {
      if (editingCategoryId !== null) {
        await updateCategory(editingCategoryId, categoryForm);
      } else {
        await createCategory(categoryForm);
      }
      setCategoryForm(EMPTY_CATEGORY_FORM);
      setEditingCategoryId(null);
      await refreshCategories();
    } catch (err) {
      setError(String(err));
    }
  }

  function startEditCategory(c: FinanceCategory) {
    setEditingCategoryId(c.id);
    setCategoryForm({ name: c.name, color: c.color, budgetAmount: c.budgetAmount });
  }

  async function removeCategory(id: number) {
    try {
      await deleteCategory(id);
      await refreshCategories();
      await refreshMonth();
    } catch (err) {
      setError(String(err));
    }
  }

  async function moveCategory(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      setCategories(await reorderCategories(reordered.map((c) => c.id)));
    } catch (err) {
      setError(String(err));
    }
  }

  const chartData =
    stats?.buckets.map((b) => ({
      label: monthBucketLabel(b.month),
      Income: b.income,
      Expense: b.expense,
      Saving: b.saving,
    })) ?? [];

  const chartSummary = `Bar chart of income, spending and savings by period. Totals: income ${formatCurrency(
    chartData.reduce((n, d) => n + d.Income, 0),
    currency
  )}, spending ${formatCurrency(
    chartData.reduce((n, d) => n + d.Expense, 0),
    currency
  )}, saving ${formatCurrency(
    chartData.reduce((n, d) => n + d.Saving, 0),
    currency
  )}.`;

  const categoryOptions = [
    { value: NO_CATEGORY, label: "No category" },
    ...categories.map((c) => ({ value: String(c.id), label: c.name })),
  ];

  return (
    <PageContainer size="default">
      <PageHeader
        title="Finances"
        actions={
        <div className="flex items-center gap-1.5">
          <IconButton label="Previous month" onClick={() => setMonth(shiftMonthKey(month, -1))}>
              <ChevronIcon className="w-3.5 h-3.5 rotate-90" />
            </IconButton>
          <span className="text-sm font-medium min-w-[9rem] text-center">{formatMonthKey(month)}</span>
          <IconButton label="Next month" onClick={() => setMonth(shiftMonthKey(month, 1))}>
              <ChevronIcon className="w-3.5 h-3.5 -rotate-90" />
            </IconButton>
        </div>
        }
      />

      {error && (
        <ErrorBanner
          message={error}
          onReload={() => {
            setError(null);
            refreshCategories();
            refreshMonth();
            refreshStats();
          }}
          onDismiss={() => setError(null)}
        />
      )}

      {!summary ? error ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <SkeletonBar className="h-3 w-16" />
                <SkeletonBar className="h-7 w-20 mt-2" />
              </Card>
            ))}
          </div>
          <Card>
            <SkeletonBar className="h-4 w-32 mb-3" />
            <SkeletonBar className="h-20 w-full" />
          </Card>
          <Card>
            <SkeletonBar className="h-32 w-full" />
          </Card>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Income"
              value={formatCurrency(summary.totalIncome, currency)}
              valueClassName="text-emerald-700 dark:text-emerald-400"
              icon={<TrendUpIcon className="w-4 h-4" />}
              iconClassName="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              sub={
                summary.monthlyIncomeAmount > 0 ? (
                  <p className="text-text-secondary text-xs mt-1">
                    expected {formatCurrency(summary.monthlyIncomeAmount, currency)}
                  </p>
                ) : undefined
              }
            />
            <StatCard
              label="Expenses"
              value={formatCurrency(summary.totalExpense, currency)}
              valueClassName="text-red-700 dark:text-red-400"
              icon={<TrendDownIcon className="w-4 h-4" />}
              iconClassName="bg-red-500/10 text-red-700 dark:text-red-300"
            />
            <StatCard
              label="Savings"
              value={formatCurrency(summary.totalSaving, currency)}
              valueClassName="text-accent-text"
              icon={<TargetIcon className="w-4 h-4" />}
              iconClassName="bg-accent-soft text-accent-text"
              sub={
                summary.savingsPercent !== null ? (
                  <div className="mt-2 space-y-1">
                    <ProgressBar pct={Math.min(100, Math.max(0, summary.savingsPercent))} />
                    <p className="text-text-secondary text-xs">{summary.savingsPercent.toFixed(0)}% of income</p>
                  </div>
                ) : undefined
              }
            />
            <StatCard
              label="Remaining"
              value={formatCurrency(summary.remainingBalance, currency)}
              valueClassName={summary.remainingBalance < 0 ? "text-red-700 dark:text-red-400" : ""}
              icon={<WalletIcon className="w-4 h-4" />}
              iconClassName={
                summary.remainingBalance < 0
                  ? "bg-red-500/10 text-red-700 dark:text-red-300"
                  : "bg-bg text-text-secondary border border-border"
              }
              sub={<p className="text-text-secondary text-xs mt-1">income − expenses − savings</p>}
            />
          </div>

          <Card>
            <h2 className="font-medium mb-3">{editingTxId !== null ? "Edit transaction" : "Add a transaction"}</h2>
            <form onSubmit={submitTransaction} className="space-y-3">
              <SegmentedControl ariaLabel="Transaction type" options={TYPE_OPTIONS} value={txForm.type} onChange={(v) => setTxForm({ ...txForm, type: v })} />
              {/* Every field carries the same small visible label, so all four
                  controls share one label-height + control-height and line up
                  on both edges. Previously only Date had a label, which made
                  its grid cell taller than the rest and left the unlabelled
                  Inputs stretching to fill it while the SelectMenu did not. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <FormField label="Amount">
                  <Input
                    id="transaction-amount-input"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={txForm.amount || ""}
                    onChange={(e) => setTxForm({ ...txForm, amount: Number(e.target.value) })}
                    required
                  />
                </FormField>
                <FormField label="Category">
                  <SelectMenu
                    className="w-full"
                    options={categoryOptions}
                    value={txForm.categoryId === null ? NO_CATEGORY : String(txForm.categoryId)}
                    onChange={(v) => setTxForm({ ...txForm, categoryId: v === NO_CATEGORY ? null : Number(v) })}
                  />
                </FormField>
                <FormField label="Date">
                  <Input
                    type="date"
                    value={txForm.occurredOn}
                    onChange={(e) => setTxForm({ ...txForm, occurredOn: e.target.value })}
                    required
                  />
                </FormField>
                <FormField label="Description (optional)">
                  <Input
                    placeholder="e.g. Weekly groceries"
                    value={txForm.description ?? ""}
                    onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
                  />
                </FormField>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="md">
                  {editingTxId !== null ? "Save changes" : "Add transaction"}
                </Button>
                {editingTxId !== null && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setEditingTxId(null);
                      setTxForm(EMPTY_TX_FORM);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </Card>

          <Card>
            <h2 className="font-medium mb-3">Transactions — {formatMonthKey(month)}</h2>
            {transactions.length === 0 ? (
              <EmptyState
                icon={<WalletIcon className="w-5 h-5" />}
                title="No transactions this month"
                description="Log your income, expenses and savings to see where your money goes and how much is left."
                action={
                  <Button variant="primary" size="md" onClick={() => focusField("transaction-amount-input")}>
                    Log a transaction
                  </Button>
                }
              />
            ) : (
              <div className="space-y-0.5">
                {txPage.shown.map((tx) => {
                  const category = categories.find((c) => c.id === tx.categoryId);
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between gap-3 text-sm py-1.5 px-2 -mx-2 rounded-md transition-colors hover:bg-bg"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full w-16 text-center shrink-0 ${TYPE_BADGE[tx.type]}`}
                        >
                          {TYPE_LABEL[tx.type]}
                        </span>
                        <span className="text-text-secondary text-xs shrink-0">{formatDateOnly(tx.occurredOn)}</span>
                        {category && (
                          <span className="text-text-secondary text-xs shrink-0 inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: category.color }} />
                            {category.name}
                          </span>
                        )}
                        {tx.description && <span className="truncate">{tx.description}</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-medium">{formatCurrency(tx.amount, currency)}</span>
                        <button
                          className="text-accent-text hover:underline text-xs transition-colors"
                          onClick={() => startEditTransaction(tx)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-red-700 dark:text-red-400 hover:underline text-xs transition-colors"
                          onClick={() => removeTransaction(tx.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                <ShowMore shown={txPage.shown.length} total={txPage.total} remaining={txPage.remaining} pageSize={txPage.pageSize} onShowMore={txPage.showMore} noun="transactions" />
              </div>
            )}
          </Card>
        </>
      )}

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-medium">Spending vs savings</h2>
          <SegmentedControl ariaLabel="Trend range"
            options={STATS_RANGES}
            value={String(statsRange)}
            onChange={(v) => setStatsRange(Number(v))}
          />
        </div>
        {stats === null ? (
          error ? (
            <p className="text-sm text-text-secondary text-center py-10">
              Couldn't load this chart. Use Reload above to try again.
            </p>
          ) : (
            <SkeletonBar className="h-[240px] w-full" />
          )
        ) : chartData.every((d) => d.Income === 0 && d.Expense === 0 && d.Saving === 0) ? (
          <EmptyState
            compact
            icon={<TrendUpIcon className="w-5 h-5" />}
            title="No transactions in this range"
            description="Log some income or expenses and your spending-vs-saving trend appears here."
          />
        ) : (
          <div role="img" aria-label={chartSummary} style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => formatCurrency(v, currency)}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => formatCurrency(value, currency)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Saving" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {stats && stats.byCategory.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <p className="text-text-secondary text-xs mb-2">Spending by category, this range</p>
            {stats.byCategory.map((c) => (
              <div key={c.categoryId} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                  {c.categoryName}
                </span>
                <span className="text-text-secondary">{formatCurrency(c.spent, currency)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowCategoryManager((v) => !v)}
        >
          <div>
            <h2 className="font-medium">Manage categories</h2>
            <p className="text-text-secondary text-xs mt-0.5">
              Add, reorder, or set monthly budgets for your spending categories.
            </p>
          </div>
          <ChevronIcon
            className={`w-4 h-4 text-text-secondary shrink-0 transition-transform duration-150 ${
              showCategoryManager ? "rotate-180" : ""
            }`}
          />
        </button>

        {showCategoryManager && (
          <div className="mt-4 space-y-4 animate-fade-slide-in">
            <form onSubmit={submitCategory} className="space-y-3">
              {/* One row: [colour swatch] [name — takes the spare width] [budget]
                  [submit]. The colour is a 36px swatch instead of a full grid
                  cell, and sits first because it reads as the category's dot
                  (the same dot the list below shows). Wraps on narrow windows. */}
              <div className="flex flex-wrap items-end gap-3">
                <FormField label="Color">
                  <ColorSwatchInput
                    ariaLabel="Category color"
                    value={categoryForm.color}
                    onChange={(hex) => setCategoryForm({ ...categoryForm, color: hex })}
                  />
                </FormField>
                <FormField label="Category name" className="flex-1 min-w-[10rem]">
                  <Input
                    placeholder="e.g. Groceries"
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                    required
                  />
                </FormField>
                <FormField label="Monthly budget (optional)" className="w-full sm:w-52">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={categoryForm.budgetAmount ?? ""}
                    onChange={(e) =>
                      setCategoryForm({
                        ...categoryForm,
                        budgetAmount: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </FormField>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" size="md">
                    {editingCategoryId !== null ? "Save changes" : "Add category"}
                  </Button>
                  {editingCategoryId !== null && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        setEditingCategoryId(null);
                        setCategoryForm(EMPTY_CATEGORY_FORM);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </form>

            {categories.length === 0 ? (
              <EmptyState
                compact
                title="No categories yet"
                description="Categories let you organize spending and set monthly budgets."
              />
            ) : (
              <div className="space-y-0.5">
                {categories.map((c, index) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 text-sm py-1 px-2 -mx-2 rounded-md transition-colors hover:bg-bg"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                      <span className="truncate">{c.name}</span>
                      {c.budgetAmount !== null && (
                        <span className="text-text-secondary text-xs shrink-0">
                          budget {formatCurrency(c.budgetAmount, currency)}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1 text-xs shrink-0">
                      <button
                        aria-label="Move up"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary transition-all duration-150 hover:bg-surface hover:text-text disabled:opacity-30 disabled:pointer-events-none"
                        disabled={index === 0}
                        onClick={() => moveCategory(index, -1)}
                      >
                        <ChevronIcon className="w-3 h-3 rotate-180" />
                      </button>
                      <button
                        aria-label="Move down"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary transition-all duration-150 hover:bg-surface hover:text-text disabled:opacity-30 disabled:pointer-events-none"
                        disabled={index === categories.length - 1}
                        onClick={() => moveCategory(index, 1)}
                      >
                        <ChevronIcon className="w-3 h-3" />
                      </button>
                      <button
                        className="text-accent-text hover:underline transition-colors ml-1"
                        onClick={() => startEditCategory(c)}
                      >
                        Edit
                      </button>
                      <button className="text-red-700 dark:text-red-400 hover:underline transition-colors" onClick={() => removeCategory(c.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
