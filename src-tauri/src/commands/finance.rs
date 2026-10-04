use crate::db::Pool;
use crate::models::{
    CategoryBudget, FinanceCategory, FinanceMonthBucket, FinanceStats, FinanceSummary,
    NewFinanceCategory, NewTransaction, Transaction,
};
use rusqlite::{params, Connection, Row};
use tauri::State;

// ---- Categories ----

const SELECT_CATEGORY_COLUMNS: &str = "id, name, color, budget_amount, sort_order, archived";

fn row_to_category(row: &Row) -> rusqlite::Result<FinanceCategory> {
    Ok(FinanceCategory {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        budget_amount: row.get("budget_amount")?,
        sort_order: row.get("sort_order")?,
        archived: row.get::<_, i64>("archived")? != 0,
    })
}

fn list_categories_conn(conn: &Connection) -> Result<Vec<FinanceCategory>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_CATEGORY_COLUMNS} FROM finance_categories \
             WHERE archived = 0 ORDER BY sort_order ASC, id ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_category)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn list_categories(pool: State<Pool>) -> Result<Vec<FinanceCategory>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    list_categories_conn(&conn)
}

#[tauri::command]
pub fn create_category(
    pool: State<Pool>,
    category: NewFinanceCategory,
) -> Result<FinanceCategory, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let next_sort: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM finance_categories",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO finance_categories (name, color, budget_amount, sort_order) \
         VALUES (?1, ?2, ?3, ?4)",
        params![category.name, category.color, category.budget_amount, next_sort],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    get_category(&conn, id)
}

#[tauri::command]
pub fn update_category(
    pool: State<Pool>,
    id: i64,
    category: NewFinanceCategory,
) -> Result<FinanceCategory, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE finance_categories SET name = ?1, color = ?2, budget_amount = ?3, \
         updated_at = datetime('now') WHERE id = ?4",
        params![category.name, category.color, category.budget_amount, id],
    )
    .map_err(|e| e.to_string())?;
    get_category(&conn, id)
}

/// Real delete, not an archive-in-disguise — the user explicitly asked for
/// add/delete/rename/reorder (spec §25). Transactions referencing this
/// category fall back to "no category" (ON DELETE SET NULL in the schema)
/// rather than being deleted, so historical spending data is never lost.
#[tauri::command]
pub fn delete_category(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM finance_categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists a full new ordering in one call. The frontend sends the
/// complete list of category ids in their desired order (after a drag or a
/// move-up/move-down action); sort_order is simply each id's index.
#[tauri::command]
pub fn reorder_categories(
    pool: State<Pool>,
    ordered_ids: Vec<i64>,
) -> Result<Vec<FinanceCategory>, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE finance_categories SET sort_order = ?1 WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    list_categories_conn(&conn)
}

fn get_category(conn: &Connection, id: i64) -> Result<FinanceCategory, String> {
    conn.query_row(
        &format!("SELECT {SELECT_CATEGORY_COLUMNS} FROM finance_categories WHERE id = ?1"),
        params![id],
        row_to_category,
    )
    .map_err(|e| e.to_string())
}

// ---- Transactions ----

const SELECT_TRANSACTION_COLUMNS: &str =
    "id, category_id, amount, type, occurred_on, description, created_at, updated_at";

fn row_to_transaction(row: &Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: row.get("id")?,
        category_id: row.get("category_id")?,
        amount: row.get("amount")?,
        transaction_type: row.get("type")?,
        occurred_on: row.get("occurred_on")?,
        description: row.get("description")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Always scoped to a single calendar month ("YYYY-MM") rather than
/// returning the whole ledger — per the performance principle (spec §55),
/// a multi-year transaction history should never be loaded in full just to
/// render a list. The Finances page's month picker drives this parameter.
#[tauri::command]
pub fn list_transactions(pool: State<Pool>, month: String) -> Result<Vec<Transaction>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_TRANSACTION_COLUMNS} FROM transactions \
             WHERE strftime('%Y-%m', occurred_on) = ?1 \
             ORDER BY occurred_on DESC, id DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![month], row_to_transaction)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn create_transaction(
    pool: State<Pool>,
    transaction: NewTransaction,
) -> Result<Transaction, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO transactions (category_id, amount, type, occurred_on, description) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            transaction.category_id,
            transaction.amount,
            transaction.transaction_type,
            transaction.occurred_on,
            transaction.description,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    get_transaction(&conn, id)
}

#[tauri::command]
pub fn update_transaction(
    pool: State<Pool>,
    id: i64,
    transaction: NewTransaction,
) -> Result<Transaction, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE transactions SET category_id = ?1, amount = ?2, type = ?3, occurred_on = ?4, \
         description = ?5, updated_at = datetime('now') WHERE id = ?6",
        params![
            transaction.category_id,
            transaction.amount,
            transaction.transaction_type,
            transaction.occurred_on,
            transaction.description,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_transaction(&conn, id)
}

#[tauri::command]
pub fn delete_transaction(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_transaction(conn: &Connection, id: i64) -> Result<Transaction, String> {
    conn.query_row(
        &format!("SELECT {SELECT_TRANSACTION_COLUMNS} FROM transactions WHERE id = ?1"),
        params![id],
        row_to_transaction,
    )
    .map_err(|e| e.to_string())
}

// ---- Summary (single month) ----

fn month_totals(conn: &Connection, month: &str) -> Result<(f64, f64, f64), String> {
    conn.query_row(
        "SELECT \
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0), \
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0), \
            COALESCE(SUM(CASE WHEN type = 'saving' THEN amount END), 0) \
         FROM transactions WHERE strftime('%Y-%m', occurred_on) = ?1",
        params![month],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|e| e.to_string())
}

/// Budget vs actual for one month. Filtered in Rust (not SQL WHERE, since
/// the "spent" figure is itself a correlated-subquery column and SQLite
/// can't reference a SELECT-list alias from WHERE) down to only categories
/// that either have a budget set or had spending — an empty, budget-less,
/// unused category shouldn't clutter this list.
fn category_breakdown_for_month(conn: &Connection, month: &str) -> Result<Vec<CategoryBudget>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT fc.id, fc.name, fc.color, fc.budget_amount, \
                    COALESCE((SELECT SUM(t.amount) FROM transactions t \
                              WHERE t.category_id = fc.id AND t.type = 'expense' \
                              AND strftime('%Y-%m', t.occurred_on) = ?1), 0) \
             FROM finance_categories fc \
             WHERE fc.archived = 0 \
             ORDER BY fc.sort_order ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<CategoryBudget> = stmt
        .query_map(params![month], |row| {
            Ok(CategoryBudget {
                category_id: row.get(0)?,
                category_name: row.get(1)?,
                color: row.get(2)?,
                budget_amount: row.get(3)?,
                spent: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|c| c.budget_amount.is_some() || c.spent > 0.0)
        .collect();
    Ok(rows)
}

fn build_summary(conn: &Connection, month: &str) -> Result<FinanceSummary, String> {
    let (total_income, total_expense, total_saving) = month_totals(conn, month)?;
    let remaining_balance = total_income - total_expense - total_saving;
    let savings_percent = if total_income > 0.0 {
        Some((total_saving / total_income) * 100.0)
    } else {
        None
    };
    let monthly_income_amount: f64 = conn
        .query_row(
            "SELECT monthly_income_amount FROM user_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let by_category = category_breakdown_for_month(conn, month)?;

    Ok(FinanceSummary {
        month: month.to_string(),
        total_income,
        total_expense,
        total_saving,
        remaining_balance,
        savings_percent,
        monthly_income_amount,
        by_category,
    })
}

#[tauri::command]
pub fn get_finance_summary(pool: State<Pool>, month: String) -> Result<FinanceSummary, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    build_summary(&conn, &month)
}

// ---- Stats (multi-month range) ----

fn monthly_buckets(conn: &Connection, months: i64) -> Result<Vec<FinanceMonthBucket>, String> {
    let offset = format!("-{} months", (months - 1).max(0));
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE month_series(m) AS ( \
                SELECT strftime('%Y-%m-01', 'now', 'localtime', ?1) \
                UNION ALL \
                SELECT date(m, '+1 month') FROM month_series WHERE m < strftime('%Y-%m-01', 'now', 'localtime') \
             ) \
             SELECT strftime('%Y-%m', month_series.m), \
                    COALESCE(SUM(CASE WHEN transactions.type = 'income' THEN transactions.amount END), 0), \
                    COALESCE(SUM(CASE WHEN transactions.type = 'expense' THEN transactions.amount END), 0), \
                    COALESCE(SUM(CASE WHEN transactions.type = 'saving' THEN transactions.amount END), 0) \
             FROM month_series \
             LEFT JOIN transactions \
                 ON transactions.occurred_on >= month_series.m \
                AND transactions.occurred_on < date(month_series.m, '+1 month') \
             GROUP BY month_series.m ORDER BY month_series.m ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![offset], |row| {
            Ok(FinanceMonthBucket {
                month: row.get(0)?,
                income: row.get(1)?,
                expense: row.get(2)?,
                saving: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Spending breakdown across the whole range (used for the range view's
/// category chart). Unlike the single-month version, budget_amount here is
/// informational only — a monthly budget figure isn't directly comparable
/// to a multi-month spend total, so the frontend must not render this as
/// "over/under budget" the way it does for the single-month summary.
fn category_breakdown_for_range(conn: &Connection, months: i64) -> Result<Vec<CategoryBudget>, String> {
    let offset = format!("-{} months", (months - 1).max(0));
    let mut stmt = conn
        .prepare(
            "SELECT fc.id, fc.name, fc.color, fc.budget_amount, \
                    COALESCE((SELECT SUM(t.amount) FROM transactions t \
                              WHERE t.category_id = fc.id AND t.type = 'expense' \
                              AND date(t.occurred_on) >= date('now', 'localtime', 'start of month', ?1)), 0) \
             FROM finance_categories fc \
             WHERE fc.archived = 0 \
             ORDER BY fc.sort_order ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<CategoryBudget> = stmt
        .query_map(params![offset], |row| {
            Ok(CategoryBudget {
                category_id: row.get(0)?,
                category_name: row.get(1)?,
                color: row.get(2)?,
                budget_amount: row.get(3)?,
                spent: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|c| c.spent > 0.0)
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn get_finance_stats(pool: State<Pool>, months: i64) -> Result<FinanceStats, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let months = months.clamp(1, 24);
    let buckets = monthly_buckets(&conn, months)?;
    let by_category = category_breakdown_for_range(&conn, months)?;
    Ok(FinanceStats { buckets, by_category })
}
