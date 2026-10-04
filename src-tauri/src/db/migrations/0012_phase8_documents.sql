-- Phase 8: Document system (architecture.md §3 "Documents / RAG", §6 RAG
-- architecture, §31 local document processing, §63 dedup-by-hash).
--
-- This migration ships the FULL documents/RAG schema, including the
-- `embeddings` table, even though Phase 8a (this phase) only wires up
-- upload → extract → chunk. Embeddings stay unpopulated
-- (embedding_status = 'not_started') until Phase 8b adds generation +
-- retrieval — additive-only migrations mean it's cheaper to ship the
-- shape now than to run a second migration later for a table that was
-- always part of the documented schema.
--
-- No CHECK constraints on ALTER/CREATE columns with enum-like meaning
-- (extraction_status, chunking_status, embedding_status, doc_type) —
-- Phase 7's migration note (0010) found decimal DEFAULTs can poison a
-- later ADD COLUMN ... CHECK in the same batch; the established pattern
-- in this codebase is to validate those in Rust instead.

CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,               -- original filename, as uploaded
    file_hash TEXT NOT NULL UNIQUE,       -- sha256 of file bytes — dedup key (§63)
    file_ext TEXT NOT NULL,               -- 'pdf' | 'docx' | 'pptx' | 'txt'
    file_size_bytes INTEGER NOT NULL,
    stored_path TEXT NOT NULL,            -- path under the app-data documents/ folder
    doc_type TEXT NOT NULL DEFAULT 'other', -- textbook | lecture_notes | department_book | past_paper | mcq_book | other
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    academic_year TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    extraction_status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed
    extraction_error TEXT,
    chunking_status TEXT NOT NULL DEFAULT 'pending',   -- pending | completed | failed
    embedding_status TEXT NOT NULL DEFAULT 'not_started', -- not_started | pending | processing | completed | failed
    page_count INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_documents_course ON documents(course_id);
CREATE INDEX idx_documents_subject ON documents(subject_id);
CREATE INDEX idx_documents_doc_type ON documents(doc_type);

CREATE TABLE document_pages (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    raw_text TEXT NOT NULL DEFAULT '',
    char_count INTEGER NOT NULL DEFAULT 0,
    -- False means extraction found no usable text layer on this page (e.g.
    -- a scanned image). OCR isn't implemented yet (Phase 8 risk note,
    -- architecture.md §11), so such pages are marked honestly rather than
    -- silently dropped or faked.
    has_extractable_text INTEGER NOT NULL DEFAULT 1,
    ocr_used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_document_pages_document ON document_pages(document_id);

CREATE TABLE document_chunks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    heading_path TEXT,              -- e.g. "Chapter 3 > 3.2 Brachial Plexus"; NULL if no heading detected
    chunk_text TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,   -- order within the document, 0-based
    char_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);

-- Phase 8b table. `dims`/`model` let a future re-embed (different model)
-- coexist safely rather than silently mixing incompatible vector spaces.
CREATE TABLE embeddings (
    chunk_id INTEGER PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
    vector BLOB NOT NULL,
    dims INTEGER NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
