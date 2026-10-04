-- Phase 8 completion: SQLite FTS5 for lexical/exact-term retrieval,
-- alongside (not replacing) the existing vector search — see
-- documents/rag.rs for the fusion layer that combines both.
--
-- External-content table (content='document_chunks', content_rowid='id')
-- rather than a table that stores its own copy of chunk_text: FTS5's own
-- storage stays limited to the index structures, and document_chunks
-- remains the single source of truth for chunk text — no duplicated
-- "which copy is current" question. The tradeoff (stated plainly, not
-- hidden): external-content tables don't sync themselves — they rely
-- entirely on the triggers below firing on every insert/update/delete.
-- If those triggers were ever dropped or bypassed (e.g. a raw SQL import
-- that skips them), the FTS index would silently drift stale. Given this
-- codebase's own established convention of every chunk mutation going
-- through documents::process_document / documents::reprocess_document
-- (never raw ad-hoc SQL elsewhere), that risk is low today — flagged
-- here so it stays a known assumption, not an invisible one.
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
    chunk_text,
    content = 'document_chunks',
    content_rowid = 'id'
);

-- Backfill: index every chunk that already existed before this migration.
-- (Chunks created after this migration are indexed by the triggers below,
-- not by this one-time statement.)
INSERT INTO document_chunks_fts(rowid, chunk_text)
SELECT id, chunk_text FROM document_chunks;

-- Keep the FTS index in lockstep with document_chunks. AFTER DELETE fires
-- even when the delete is itself the result of an ON DELETE CASCADE from
-- documents (SQLite fires triggers on cascade-affected tables), so
-- deleting a document — or documents::reprocess_document's diff-merge
-- deleting a stale chunk — cleans up the FTS index automatically, no
-- extra application code required.
CREATE TRIGGER document_chunks_fts_ai AFTER INSERT ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
END;

CREATE TRIGGER document_chunks_fts_ad AFTER DELETE ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, chunk_text)
    VALUES ('delete', old.id, old.chunk_text);
END;

CREATE TRIGGER document_chunks_fts_au AFTER UPDATE ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, chunk_text)
    VALUES ('delete', old.id, old.chunk_text);
    INSERT INTO document_chunks_fts(rowid, chunk_text) VALUES (new.id, new.chunk_text);
END;
