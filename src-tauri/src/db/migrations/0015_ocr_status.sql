-- Phase 8 completion: local OCR for scanned/image-only PDF pages.
--
-- OCR is deliberately a separate, explicitly-triggered step from
-- extraction (see documents/ocr.rs, commands/documents.rs's
-- run_ocr_for_document) rather than something process_document does
-- inline — OCR-ing dozens of scanned pages via subprocess calls to
-- tesseract can take real time (seconds per page), and blocking a
-- document upload on that would make a simple upload feel broken. A
-- document lands in 'pending' (if any page lacks extractable text) or
-- 'not_needed' (every page had usable native text) right after
-- extraction; the user (or a future automated trigger) then runs OCR
-- explicitly, same UX shape as embedding generation.

ALTER TABLE documents ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'not_needed';
-- not_needed | pending | processing | partial | completed | failed
ALTER TABLE documents ADD COLUMN ocr_error TEXT;
-- Which language(s) OCR last ran with for this document (e.g. "eng+ara") —
-- surfaced in the UI so it's never ambiguous what was actually attempted.
ALTER TABLE documents ADD COLUMN ocr_languages TEXT;

-- Per-page OCR outcome. has_extractable_text (added in migration 0012)
-- already flips to true on a successful OCR — ocr_error is what lets a
-- specific page's OCR failure be recorded and retried without losing
-- track of it, and without treating failure as if it were success
-- (has_extractable_text stays false, honestly, until OCR actually works).
ALTER TABLE document_pages ADD COLUMN ocr_error TEXT;

CREATE INDEX idx_documents_ocr_status ON documents(ocr_status);
