-- Phase 8c: scalable, provider-isolated embedding retrieval.
--
-- All additive (existing rows keep working; nothing is dropped or
-- rewritten destructively) — consistent with this project's
-- additive-only migration rule, and with Phase 8c's explicit requirement
-- to migrate existing Phase 8b embeddings rather than discard them.

-- Content-addressed identity for a chunk's text, independent of its
-- position (chunk_index/page_number/heading_path can shift across a
-- re-extraction even when the underlying text hasn't changed at all —
-- e.g. re-running extraction after a chunking-heuristic tweak). Reprocessing
-- uses this to recognize "this chunk's content is unchanged" and reuse its
-- existing embedding instead of paying to re-embed it.
ALTER TABLE document_chunks ADD COLUMN content_hash TEXT;
CREATE INDEX idx_document_chunks_content_hash ON document_chunks(document_id, content_hash);

-- Backfill content_hash for any chunks that already existed before this
-- migration (Phase 8a/8b documents). Computed in Rust immediately after
-- this migration runs (see db::mod::run_post_migration_backfill or the
-- one-time backfill in documents::mod — SQLite has no builtin SHA-256,
-- so this can't be done in pure SQL); until that backfill runs, NULL
-- content_hash simply means "treat as unrecognized on next reprocess",
-- which is always safe — the worst case is one unnecessary re-embed
-- pass for pre-existing chunks, never a wrong/silent result.

-- Every embedding must now carry which provider produced it (not just
-- which model — a model name string alone isn't guaranteed unique across
-- providers) and a small embedding_version tag so the vector-generation
-- *pipeline* (not just the model) can be revised later without silently
-- mixing incompatible vectors under the same provider/model label.
ALTER TABLE embeddings ADD COLUMN provider TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE embeddings ADD COLUMN embedding_version TEXT NOT NULL DEFAULT '1';

-- Coarse locality-sensitive-hash bucket (see documents/vector.rs) — an
-- approximate pre-filter so a search only has to run exact cosine
-- similarity over a small candidate set instead of every row for the
-- active provider/model. NULL for any embedding created before this
-- migration or before a bucket backfill runs; a NULL bucket is always
-- still searchable (search's fallback path scans by provider/model
-- without the bucket filter when too few candidates are found), so an
-- un-backfilled row is slower to find, never invisible.
ALTER TABLE embeddings ADD COLUMN lsh_bucket INTEGER;

-- Backfill: every embedding that already existed before this migration
-- was produced by Gemini — OpenRouter embedding support didn't exist in
-- this app until Phase 8c, so no pre-existing row can be an OpenRouter
-- vector. This is a real inference from which code paths could possibly
-- have inserted a row before now, not a guess.
UPDATE embeddings SET provider = 'google' WHERE provider = 'unknown';

-- Retry/partial-progress tracking for embedding generation, mirroring
-- the existing extraction_error column's pattern. `embedding_status` can
-- now also be 'partial' (some but not all of a document's chunks are
-- embedded for the active provider/model — e.g. after a reprocess that
-- added new chunks alongside reused ones).
ALTER TABLE documents ADD COLUMN embedding_error TEXT;
ALTER TABLE documents ADD COLUMN embedding_retry_count INTEGER NOT NULL DEFAULT 0;

-- Query patterns this supports: "give me candidate chunks for provider X
-- model Y, optionally narrowed to a few LSH buckets" (search), and "does
-- this provider/model pair already have any embeddings at all" (status
-- surfacing). Composite, not separate single-column indexes — every real
-- query filters by provider+model together, never provider alone.
CREATE INDEX idx_embeddings_provider_model ON embeddings(provider, model);
CREATE INDEX idx_embeddings_provider_model_bucket ON embeddings(provider, model, lsh_bucket);
