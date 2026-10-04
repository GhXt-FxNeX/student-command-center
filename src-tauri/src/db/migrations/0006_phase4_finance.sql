-- Phase 4: Finance — categories, transactions, and the monthly income baseline
-- the settings/dashboard read. No companion schema changes: the original
-- event catalog (0003_companion.sql) has no Finance events specified, and
-- the Phase 3 handoff confirms none should be added unless asked.

ALTER TABLE user_settings ADD COLUMN monthly_income_amount REAL NOT NULL DEFAULT 0;

-- Categories are deliberately generic labels (not tied to a transaction
-- type) since the same category, e.g. "Courses", can reasonably tag both
-- an expense and, someday, a refund. Transaction type lives on the
-- transaction row instead (see below). budget_amount is a monthly cap used
-- for "budget vs actual"; NULL means no budget set for that category.
CREATE TABLE finance_categories (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '#4f7cff',
    budget_amount REAL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_finance_categories_sort ON finance_categories(sort_order);

CREATE TABLE transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id  INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
    amount       REAL NOT NULL CHECK (amount >= 0), -- always positive; type carries the sign/meaning
    type         TEXT NOT NULL CHECK (type IN ('income', 'expense', 'saving')),
    occurred_on  TEXT NOT NULL, -- "YYYY-MM-DD" calendar date, never a timestamp — same discipline as tasks.deadline
    description  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_transactions_date ON transactions(occurred_on);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_type ON transactions(type);

-- Default categories from the original spec (§25), seeded once. All
-- user-customizable afterward (add/delete/rename/reorder/budget) — this
-- seed is a starting point, not a fixed list.
INSERT INTO finance_categories (name, color, sort_order) VALUES
    ('Rent',           '#4f7cff', 0),
    ('Bills',          '#f59e0b', 1),
    ('Groceries',      '#10b981', 2),
    ('Transportation', '#6366f1', 3),
    ('Courses',        '#ec4899', 4),
    ('Books',          '#8b5cf6', 5),
    ('Entertainment',  '#f43f5e', 6),
    ('Savings',        '#14b8a6', 7),
    ('Other',          '#6b7280', 8);
