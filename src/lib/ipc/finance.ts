import { invoke } from "@tauri-apps/api/core";
import type {
  FinanceCategory,
  FinanceStats,
  FinanceSummary,
  NewFinanceCategory,
  NewTransaction,
  Transaction,
} from "@/types";

export function listCategories(): Promise<FinanceCategory[]> {
  return invoke("list_categories");
}

export function createCategory(category: NewFinanceCategory): Promise<FinanceCategory> {
  return invoke("create_category", { category });
}

export function updateCategory(id: number, category: NewFinanceCategory): Promise<FinanceCategory> {
  return invoke("update_category", { id, category });
}

export function deleteCategory(id: number): Promise<void> {
  return invoke("delete_category", { id });
}

export function reorderCategories(orderedIds: number[]): Promise<FinanceCategory[]> {
  return invoke("reorder_categories", { orderedIds });
}

/** month is "YYYY-MM". */
export function listTransactions(month: string): Promise<Transaction[]> {
  return invoke("list_transactions", { month });
}

export function createTransaction(transaction: NewTransaction): Promise<Transaction> {
  return invoke("create_transaction", { transaction });
}

export function updateTransaction(id: number, transaction: NewTransaction): Promise<Transaction> {
  return invoke("update_transaction", { id, transaction });
}

export function deleteTransaction(id: number): Promise<void> {
  return invoke("delete_transaction", { id });
}

/** month is "YYYY-MM". */
export function getFinanceSummary(month: string): Promise<FinanceSummary> {
  return invoke("get_finance_summary", { month });
}

export function getFinanceStats(months: number): Promise<FinanceStats> {
  return invoke("get_finance_stats", { months });
}
