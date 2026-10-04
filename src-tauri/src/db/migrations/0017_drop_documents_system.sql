-- Phase 8 (Documents/RAG — extraction, OCR, chunking, embeddings, FTS5,
-- hybrid search) has been fully removed from the application, per
-- explicit instruction, in favor of Phase 14 (future enhancements &
-- polish, per future_enhancement.md).
--
-- This is a genuinely destructive migration — explicitly confirmed
-- before writing it (the alternative, leaving the tables in place while
-- removing the Rust/UI code that reads them, was offered and declined).
-- Existing document/chunk/embedding data is not recoverable after this
-- runs. Migrations 0012, 0014, 0015, and 0016 (which created what's being
-- dropped here) are intentionally NOT deleted from the migrations
-- directory — they remain as an accurate historical record of what this
-- database's schema actually went through, consistent with the
-- immutable-migration-history convention already established in this
-- project (nothing here rewrites or deletes a past migration file).
--
-- Drop order: FTS5 triggers/virtual table and embeddings first (deepest
-- dependents), then chunks, pages, and documents. SQLite's DROP TABLE
-- doesn't require dependency-ordering to succeed (unlike some other
-- databases), but this order is kept for readability. Dropping
-- document_chunks also implicitly drops the document_chunks_fts_ai/ad/au
-- triggers that were defined on it (SQLite drops a table's triggers when
-- the table is dropped); they're dropped explicitly first anyway, for
-- clarity and to guard against relying on that implicit behavior.

DROP TRIGGER IF EXISTS document_chunks_fts_ai;
DROP TRIGGER IF EXISTS document_chunks_fts_ad;
DROP TRIGGER IF EXISTS document_chunks_fts_au;
DROP TABLE IF EXISTS document_chunks_fts;

DROP TABLE IF EXISTS embeddings;
DROP TABLE IF EXISTS document_chunks;
DROP TABLE IF EXISTS document_pages;
DROP TABLE IF EXISTS documents;
