# Student Command Center — Phase 0 Architecture

Status: **Design document — no application code yet.** This defines the system before Phase 1 implementation begins.

> Deferred, approved-but-not-yet-built work (not part of any shipped phase) is tracked separately in `FUTURE_ENHANCEMENTS.md` at the repo root — that file is backlog, this document is what's actually implemented.

---

## 1. Stack Decision

| Layer | Choice | Why |
|---|---|---|
| Shell/runtime | **Tauri 2.x** | Native desktop app, small binary, uses OS webview (no bundled Chromium like Electron), Rust backend has real filesystem/OS access, good for a daily-use tool holding sensitive data |
| Frontend | **React + TypeScript + Vite** | Fast dev loop, mature charting/animation ecosystem, strong typing for the many data shapes (tasks, MCQs, flashcards, transactions) |
| Styling | **Tailwind CSS + CSS variables for theming** | Utility speed + CSS-variable accent system described in spec (§12–13) is trivial with Tailwind's `theme()` + custom properties |
| Backend logic | **Rust (Tauri commands)** | File I/O, PDF/DOCX parsing, OCR orchestration, embedding storage, SQLite access, deterministic algorithms (FSRS, stats), background jobs |
| Database | **SQLite (via `rusqlite` + `sqlx` or `sea-orm`)** | Local-first, zero-config, transactional, scales to the "thousands of rows" requirement with proper indexing; single file is trivial to back up/export |
| Vector storage | **`sqlite-vec` extension (or `sqlite-vss`)** inside the same SQLite file | Avoids running a second database (e.g., Qdrant) just for embeddings; keeps the "local-first, one file" philosophy; swappable later if scale demands it |
| AI providers | **Gemini API, OpenRouter API, Ollama (local)** behind one internal interface | Required by spec §5–9 |
| Secrets | **OS keychain via Tauri's `keyring`/`stronghold` plugin**, never in frontend bundle or SQLite plaintext | Spec §52 |
| Charts | **Recharts** (already available in this environment; works fine in Tauri's webview) | Declarative, good enough for line/bar/area; can revisit if perf issues appear at scale |
| PDF/DOCX parsing | Rust crates (`pdf-extract`/`lopdf`, `docx-rs`) for text; OCR via `tesseract` binary invoked from Rust when a page has no extractable text layer | Keeps heavy processing off the JS thread |

**Why not Electron:** heavier binary, higher memory, and the spec explicitly wants Rust doing filesystem/native work — Tauri is the natural fit.

**Why not a server + web app:** the spec's core philosophy is local-first with sensitive medical/financial data (§4, §61). A local SQLite-backed desktop app avoids operating a backend, avoids sync conflicts, and avoids "your data lives in someone else's database" concerns. Cloud sync is listed explicitly as a *future* extension point (§66), not a v1 requirement.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         React Frontend                        │
│  Dashboard · Planner · Tasks · Calendar · Pomodoro · Study    │
│  Analytics · Courses · Exams · Finances · Medical AI ·        │
│  Documents · MCQs · Flashcards · Reviews · Settings           │
│  (pure presentation + local UI state; no business logic)      │
└───────────────────────────┬─────────────────────────────────-┘
                             │ Tauri IPC (typed commands/events)
┌───────────────────────────▼──────────────────────────────────┐
│                        Rust Core (Tauri)                      │
│  ┌───────────────┐ ┌────────────────┐ ┌────────────────────┐ │
│  │ Domain services│ │ Document engine │ │ Scheduler/FSRS      │ │
│  │ tasks, finance,│ │ extract→OCR→    │ │ deterministic, no   │ │
│  │ exams, courses │ │ chunk→embed     │ │ AI in the loop      │ │
│  └───────┬───────┘ └────────┬────────┘ └──────────┬─────────┘ │
│          │                  │                       │          │
│  ┌───────▼──────────────────▼───────────────────────▼───────┐ │
│  │                    SQLite (single file)                   │ │
│  │        relational tables + sqlite-vec embedding table      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                             │                                  │
│  ┌──────────────────────────▼─────────────────────────────┐  │
│  │                     AI Service Layer                     │  │
│  │   aiRouter → { GeminiProvider | OpenRouterProvider |      │  │
│  │                LocalProvider(Ollama) }                    │  │
│  │   + usage ledger + spending-limit guard + schema validator│  │
│  └──────────────────────────┬─────────────────────────────┘  │
└─────────────────────────────┼─────────────────────────────────┘
                               │ HTTPS (only when AI is invoked)
                 ┌─────────────┼──────────────┐
                 ▼             ▼              ▼
             Gemini API   OpenRouter API   Ollama (localhost)
```

Key rule: **the frontend never talks to an AI provider directly.** It calls a Tauri command like `ai_generate_flashcards(topicId)`; Rust decides provider/model, enforces the spending limit, calls the provider, validates the structured response, logs usage, and returns typed data. This keeps API keys out of the webview entirely and makes cost protection unbypassable from the UI.

---

## 3. Database Schema (core tables, relationships)

Grouped by domain. All tables get `id INTEGER PRIMARY KEY`, `created_at`, `updated_at`. Foreign keys use `ON DELETE CASCADE` where a child record is meaningless without its parent (e.g., `flashcard_reviews` without `flashcards`), and `ON DELETE SET NULL` where the child should survive (e.g., a `task` whose `course` was deleted).

**Academic structure**
- `courses (id, name, color, term, archived)`
- `subjects (id, course_id→courses, name, color)`
- `topics (id, subject_id→subjects, name, parent_topic_id→topics NULL)` — self-referencing for subtopics

**Productivity**
- `tasks (id, title, description, course_id, subject_id, topic_id, priority, difficulty, estimated_minutes, deadline, status, tags_json, notes)`
- `schedule_blocks (id, task_id→tasks NULL, title, start_ts, end_ts, source ENUM[ai,manual], locked_bool)` — locked blocks are the "AI must not overwrite manual changes" mechanism (§20)
- `calendar_events (id, title, type ENUM[class,exam,deadline,study,other], start_ts, end_ts, ref_id, ref_type)` — generic pointer so calendar can render tasks/exams/sessions without duplicating data

**Study**
- `study_sessions (id, task_id NULL, course_id, subject_id, topic_id, start_ts, end_ts, duration_seconds, type ENUM[pomodoro,manual,free], completed_bool)`
- `pomodoro_sessions (id, study_session_id→study_sessions NULL, work_minutes, break_minutes, cycles_completed)`
- `study_goals (id, scope ENUM[daily,weekly], target_minutes, active_from)`

**Finance**
- `finance_categories (id, name, type ENUM[income,expense,saving], budget_amount NULL, sort_order, color)`
- `transactions (id, category_id→finance_categories, amount, date, type ENUM[income,expense,saving], description)`

**Exams**
- `exams (id, name, course_id, subject_id, date, score, max_score, notes)` — `percentage` is *computed*, never stored redundantly

**Documents / RAG**
- `documents (id, filename, file_hash UNIQUE, type, course_id, subject_id, academic_year, tags_json, upload_date, extraction_status, chunking_status, embedding_status)`
- `document_pages (id, document_id→documents, page_number, raw_text, ocr_used_bool)`
- `document_chunks (id, document_id→documents, page_number, heading_path, chunk_text, chunk_index)`
- `embeddings (chunk_id→document_chunks PK/FK, vector BLOB)` — stored via `sqlite-vec` virtual table for ANN search

**Medical AI**
- `question_style_profiles (id, course_id, subject_id, derived_from_document_ids_json, difficulty_summary_json, option_count_mode, recall_pct, reasoning_pct, clinical_pct, common_phrases_json)`
- `curriculum_comparisons (id, old_document_id, new_document_id, topic, status ENUM[definitely_present,probably_present,not_found,possibly_removed,definitely_removed], confidence, notes)`

**MCQs**
- `mcqs (id, question, options_json, correct_answer_index, explanation, topic_id, subtopic, difficulty, learning_objective, source_refs_json, generated_by ENUM[ai,manual], style_profile_id NULL)`
- `mcq_attempts (id, attempt_session_id, mcq_id→mcqs, selected_index, correct_bool, time_spent_seconds)`
- `mcq_practice_sessions (id, started_at, ended_at, topic_scope_json, score, total)`

**Flashcards / spaced repetition**
- `flashcards (id, front, back, type, topic_id, source_refs_json, tags_json, difficulty, generated_by)`
- `flashcard_reviews (id, flashcard_id→flashcards, reviewed_at, rating ENUM[again,hard,good,easy], stability, difficulty_fsrs, elapsed_days, scheduled_days, next_review_date)` — FSRS state lives here, computed entirely in Rust

**Weakness / knowledge graph**
- `weak_topics (id, topic_id→topics UNIQUE, weakness_score, last_computed_at, contributing_mcq_count, contributing_flashcard_count)` — recomputed by a deterministic job, not by AI

**AI infrastructure**
- `ai_requests (id, provider, model, feature, input_tokens, output_tokens, estimated_cost, status, created_at)`
- `ai_usage_monthly (id, year_month, provider, total_requests, total_tokens, total_cost)` — rollup table for the usage dashboard, refreshed from `ai_requests`

**Settings**
- `user_settings (id single-row, name, timezone, week_start, theme, accent_color, custom_theme_json, dashboard_layout_json, ai_provider, ai_model, ai_routing_mode, ai_spending_limit_cents, currency, notification_prefs_json, ...)`

Indexes: every foreign key column, plus `tasks(deadline, status)`, `flashcard_reviews(next_review_date)`, `transactions(date, category_id)`, `document_chunks(document_id)`, `mcqs(topic_id, difficulty)` — these back the hot queries (today's tasks, due reviews, monthly finance, topic-filtered MCQs).

---

## 4. Folder Structure

```
student-command-center/
├── src/                          # React frontend
│   ├── app/                      # routing, layout, providers
│   ├── pages/                    # one folder per nav item (Dashboard, Planner, Tasks, ...)
│   ├── components/               # shared UI (Card, Button, Chart wrappers, EmptyState...)
│   ├── features/                 # feature-scoped logic+components (finance/, flashcards/, mcq/...)
│   ├── hooks/
│   ├── lib/
│   │   ├── ipc/                  # typed wrappers around invoke("command_name", ...)
│   │   └── theme/                # accent-color derivation, contrast checks
│   ├── types/                    # shared TS types mirroring Rust structs (generated or hand-kept in sync)
│   └── styles/
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # #[tauri::command] entry points, one module per domain
│   │   │   ├── tasks.rs, finance.rs, exams.rs, documents.rs, mcq.rs, flashcards.rs, ai.rs, settings.rs
│   │   ├── db/
│   │   │   ├── migrations/       # versioned SQL migrations
│   │   │   ├── models/           # Rust structs + queries per table group
│   │   ├── documents/            # extraction, OCR, chunking pipeline
│   │   ├── fsrs/                 # deterministic spaced-repetition algorithm
│   │   ├── ai/
│   │   │   ├── providers/{gemini, openrouter, local}/
│   │   │   ├── router.rs         # automatic routing rules
│   │   │   ├── usage.rs          # ledger + spending-limit guard
│   │   │   ├── schemas/          # JSON schema + validators for MCQ/flashcard/schedule outputs
│   │   │   └── prompts/          # prompt templates per feature (planner, mcq, flashcards, curriculum, highYield, performance)
│   │   ├── rag/                  # retrieval logic (chunk search, context assembly)
│   │   └── keychain.rs           # secret storage
│   └── tauri.conf.json
└── package.json
```

This mirrors the spec's requested `/ai` structure (§54) but rooted in `src-tauri/src/ai` since prompt construction, provider calls, and validation are backend concerns — keeping keys and raw provider responses out of the webview entirely.

---

## 5. AI Provider Architecture

Single internal trait in Rust:

```
trait AiProvider {
    fn generate(&self, prompt: Prompt, opts: GenOpts) -> Result<AiResponse>;
    fn generate_structured<T: Schema>(&self, prompt: Prompt, opts: GenOpts) -> Result<T>;
    fn is_available(&self) -> ProviderStatus; // Connected / Unavailable / NotConfigured
}
```

Implementations: `GeminiProvider` (Flash default, Pro for flagged complex tasks), `OpenRouterProvider` (model id passed through, free-tier models filterable), `LocalProvider` (Ollama over `localhost:11434`, health-checked before use).

**Feature-level functions** (`generate_study_plan`, `generate_mcqs`, `generate_flashcards`, `analyze_curriculum`, `extract_high_yield`, `analyze_performance`) each declare a *complexity hint* (simple/complex) and a *privacy hint* (ok-to-send-external / prefer-local). The router combines these hints with user settings to pick provider+model:

```
if user.routing_mode == Manual → use user.selected_provider/model
else:
    if spending_limit_reached → force free-tier/local, else block with message
    else if privacy_hint == prefer_local and local.is_available() → Local
    else if complexity == complex and gemini_pro.available → Gemini Pro
    else → Gemini Flash (default cheap/fast path)
```

Model IDs are stored in `user_settings`/a small config table, not hard-coded, so they can be updated without a rebuild.

**Structured output**: every AI-consumed feature has a JSON schema in `ai/schemas`. Provider responses are parsed and validated; on failure, one repair attempt (re-prompt with the validation error), then a clear UI error — never silently accepted malformed data (§53).

**Cost protection**: every provider call first passes `usage::check_budget(estimated_cost)`. At `$0` limit, only free-tier OpenRouter models and Local are ever selected — paid providers are not called, period. `ai_requests` logs every call (real token counts from provider responses where available); `ai_usage_monthly` is a rollup for the dashboard. Where a provider doesn't expose quota, the UI shows "Quota information unavailable" rather than a guess.

---

## 6. RAG / Document Architecture — REMOVED

**Status: built, then fully removed.** Everything in this section was implemented (Phase 8a through the OCR/FTS5/hybrid-search/RAG-foundation completion round) and confirmed working — including local OCR on a real 321-page scanned document. It was then deliberately reverted in favor of Phase 14 (future enhancements & polish, per `future_enhancement.md`) instead of continuing toward Medical AI/MCQs/Flashcards. Migration `0017_drop_documents_system` drops every table this section describes; migrations `0012`/`0014`/`0015`/`0016` (which created them) are left in place as historical record, per this project's never-rewrite-a-past-migration convention.

The design is kept below as a reference, not as a description of current behavior, in case a document/RAG system is ever revisited:

```
Upload → hash file → if hash exists, reuse prior processing
      → extract text (Rust: pdf-extract for PDF, hand-rolled zip+XML scan for DOCX/PPTX)
      → per PDF page: if extractable text is empty/garbled → OCR, on explicit request, via the `tesseract`/`pdftoppm` CLI binaries (English + Arabic; local only, never a cloud vision fallback)
      → detect headings via a text-pattern heuristic
      → chunk (heading-aware, ~600 words, ~10% overlap)
      → store chunks with page + heading path + a content hash
      → embed chunks via Gemini (`gemini-embedding-001`) or OpenRouter (`openai/text-embedding-3-small`) — cloud-only
      → store vectors as BLOBs, isolated by provider+model+embedding_version
      → also index chunk text in a SQLite FTS5 virtual table, kept in sync via triggers
```

OCR was a separate, explicitly-triggered, resumable step (not automatic on upload). Vector indexing used brute-force cosine similarity narrowed by a hand-rolled random-hyperplane LSH bucket index — `sqlite-vec` was evaluated and rejected (native-extension/macOS-signing risk unverifiable without a real device). Hybrid search fused vector and FTS5 results via Reciprocal Rank Fusion. A RAG evidence-context assembler deduplicated, budgeted, and never fabricated a missing page number. None of this is reachable from the app anymore.

---

## 7. NotebookLM Strategy — not implemented, not currently planned

Was designed as an export-only integration (no public API exists). Never built. With Phase 8 removed, nothing in the current roadmap depends on it. Revisit only if a document system is rebuilt and Google ships an official API.

---

## 8. Security & Privacy

- API keys entered in Settings are written to the OS keychain (via the `keyring` crate), never to SQLite in plaintext, never bundled or logged.
- Frontend never sees a raw API key — all provider calls happen in Rust.
- The only network calls anywhere in the app are Gemini/OpenRouter chat completion calls (Phase 6/7's AI Planner) — visible in an "AI activity" indicator so it's never silent (§61). There is no document pipeline anymore, so there's nothing to say about OCR/FTS5/embedding network behavior; see §6's removal note if that ever changes.
- Local backup = copy the single SQLite file; export options (JSON/CSV/Markdown) for portability (§51).

---

## 9. Deterministic vs. AI Boundary (recap of §40, §62)

Never AI: exam percentages, study-time aggregation, savings/budget math, FSRS interval calculation, weakness-score arithmetic, chart data prep.
AI only: planning/reasoning, MCQ/flashcard generation, curriculum comparison judgment, high-yield extraction, natural-language recommendations, document interpretation.

---

## 10. Development Roadmap (phases, as specified)

0. Architecture (this document)
1. Core shell — Tauri/React/Rust/SQLite wiring, sidebar, dashboard shell, settings, theme/accent system, tasks, manual scheduling — all persisted
2. Calendar + Pomodoro + study session tracking + notifications
3. Study analytics (day/week/month/year, streaks, planned vs actual)
4. Finance (categories, transactions, budgets, analytics)
5. Exams (tracker + performance analytics)
6. AI infrastructure (provider layer, routing, usage tracking, spending limit) — no user-facing AI feature yet, just plumbing + a test call
7. AI daily planner (schedule generation, manual edit, re-optimize)
8. ~~Document system (upload, extraction, OCR, chunking, embeddings, retrieval)~~ — **built, then fully removed** (§6). Roadmap now moves directly from Phase 7 to Phase 14.
9. ~~Medical AI~~ — depended on Phase 8; not started, not currently planned.
10. ~~MCQ generation + practice + weakness detection~~ — depended on Phase 8/9; not started, not currently planned.
11. ~~Flashcards~~ — not started, not currently planned.
12. ~~Spaced repetition~~ — not started, not currently planned.
13. ~~Knowledge graph wiring~~ — depended on 8-12; not started, not currently planned.
14. **Future enhancements & polish** (per `future_enhancement.md`) — current phase. ~~Reset Saved/Demo Data~~ (done — see README's Phase 14 entry, migration 0018), collapsible navigation (next), Companion global-shell integration, Companion naming/customization/collection, Spotify integration, Book Maker, Private Video Journal — plus the general polish items (full test pass, performance, accessibility, responsive layouts, security review) originally scoped for this slot.

Each phase ends with the app in a fully working state — nothing half-wired carries forward silently. Phases 9-13 are struck through rather than deleted from this list, consistent with the project's convention of keeping an honest historical record rather than rewriting what was actually decided and when.

---

## 11. Risks & Technical Limitations (honest, up front)

- **OCR quality**: Tesseract via Rust is workable but not state-of-the-art; scanned low-quality lecture PDFs may need a fallback (send page image to a vision-capable AI model, at user's opt-in, since that leaves the device).
- **Local embeddings via Ollama**: quality/speed depend entirely on the model the user installs; not guaranteed to match a hosted embedding API. Will surface this trade-off in Settings rather than hide it.
- **`sqlite-vec` at large scale** (many large textbooks): ANN performance in SQLite is good but not Pinecone/Qdrant-grade; acceptable for a personal knowledge base (thousands, not millions, of chunks) — flagged as a future swap point if it becomes a bottleneck.
- **NotebookLM**: no reliable API, as noted — export-only for now.
- **"Match department difficulty" calibration** is inherently approximate — the Question Style Profile is a heuristic summary of uploaded questions, not a certified psychometric model; the UI will label it as an estimate.
- **Curriculum "removed" detection** depends on embedding/keyword matching quality; false "not found" results are possible, which is exactly why the spec's 5-level confidence scale (not a binary) is used.
- **Tauri + SQLite migrations**: need a disciplined versioned-migration approach from day one so schema changes across phases don't corrupt existing user data — will use numbered migration files applied on startup, with a pre-migration backup copy of the DB file.

---

---

# AMENDMENT — Companion / Creature Progression System

Added before Phase 1. Only the sections below change; everything above is unchanged.

## A1. Where it sits in the architecture

The companion is a **first-class Rust subsystem**, not a UI feature bolted onto the dashboard. It lives alongside the other domain services (tasks, finance, exams, ...) and is driven entirely by an internal event bus — it has no direct dependency on any specific feature module, and no feature module depends on it either. This keeps coupling one-directional: domain modules *emit* events and know nothing about the companion; the companion *listens* and knows nothing about how a task or exam is implemented internally.

```
┌───────────────┐   emit    ┌───────────────────────┐
│ Tasks service  │─────────▶│                        │
├───────────────┤           │                        │
│ Exams service  │─────────▶│   Companion Event Bus   │
├───────────────┤           │   (in-process, Rust)    │
│ Study/Pomodoro │─────────▶│                        │
├───────────────┤           │                        │
│ Flashcards/FSRS│─────────▶│                        │
└───────────────┘           └───────────┬────────────┘
                                         │ dispatch
                                         ▼
                              ┌────────────────────┐
                              │  Companion Engine    │
                              │  xp.rs · mood.rs ·   │
                              │  evolution.rs ·      │
                              │  persistence.rs      │
                              └──────────┬──────────┘
                                         │ writes
                                         ▼
                              SQLite (companion_* tables)
                                         │
                                         │ tauri.emit("companion:updated", state)
                                         ▼
                              React: useCompanion() hook
                              → sprite/animation player + dialogue
```

No AI call anywhere in this loop — XP, mood, and evolution are 100% deterministic rule evaluation (requirement §4/§5 of this amendment), consistent with the existing "deterministic vs AI boundary" principle already in the base architecture (FSRS, stats, cost calculations).

## A2. Event catalog

Domain services emit these after their own DB transaction commits (so the companion never reacts to something that didn't actually happen):

| Event | Emitted by | Notes |
|---|---|---|
| `TaskCompleted` | Tasks service | includes priority/difficulty so the engine can tell routine vs major |
| `MajorTaskCompleted` | Tasks service | fired instead of/alongside `TaskCompleted` when priority = high or difficulty = hard |
| `ExamCompleted` | Exams service | includes percentage |
| `HighExamScore` | Exams service | percentage ≥ 95% |
| `PerfectExamScore` | Exams service | percentage = 100% |
| `WeeklyGoalCompleted` | Study Analytics | weekly study-minutes target met |
| `StudySessionCompleted` | Study/Pomodoro service | any completed session |
| `PomodoroCompleted` | Pomodoro service | one work cycle finished |
| `StudyStreakReached` | Study Analytics | fires at streak milestones (e.g. 3/7/14/30 days), not every day |
| `FlashcardMilestoneReached` | Flashcards/FSRS | e.g. N cards reviewed in a day, or review queue cleared |
| `LevelUp` | **Companion Engine itself** | internally generated after XP crosses a threshold, then re-broadcast to the frontend |
| `EvolutionUnlocked` | **Companion Engine itself** | internally generated when stage requirements are met |
| `GoalMissed` / `StreakBroken` | Study Analytics | soft-negative signal — see A6 |

All events carry a small typed payload (ids, magnitude, timestamp) and are logged verbatim to `companion_event_log` for auditability and for the mood state machine's "recent activity" window.

## A3. XP, leveling, and evolution — data-driven rules

XP amounts and happiness deltas per event type are **not hardcoded in the engine** — they live in an `xp_rules` table (seeded with sane defaults, editable later in an advanced settings screen). The engine's job is just: look up the rule for the incoming event type, apply it, re-evaluate level/stage.

- **Level**: simple cumulative-XP thresholds (`level_thresholds` table: level → xp_required). Level-up recompute happens on every XP-changing event.
- **Evolution stage**: `companion_evolution_stages` maps a species to its 7 stages (Egg → Baby → In-Training → Rookie → Champion → Ultimate → Mega), each with a `condition_type` (`xp_threshold` in v1) and a `condition_json` payload. Using a typed condition column instead of a hardcoded level number means **future branching evolutions** (e.g. "high-consistency path" vs "last-minute-cramming path" based on behavioral stats) can be added later as a new `condition_type` (`stat_based`) without a schema migration — v1 just never populates that type.
- **Branching data model**: stages reference a `branch_id` (default `"main"` for everyone today). Multiple rows can share the same `min_level` with different `branch_id`s once branching logic ships; the engine simply picks the branch whose condition currently evaluates true. This is pure schema future-proofing — v1 ships with one branch only, per your instruction not to build branching logic now.

## A4. Mood — deterministic state machine

Moods: `happy, excited, proud, celebrating, neutral, sleepy, sad, worried`.

Computed (not stored as a free choice) from a small deterministic function each time the companion state is read or an event arrives:

```
priority order (first match wins):
1. celebrating   → a LevelUp or EvolutionUnlocked happened in the last N minutes
2. excited       → a HighExamScore/PerfectExamScore or MajorTaskCompleted happened recently
3. proud         → a WeeklyGoalCompleted or StudyStreakReached happened recently
4. happy         → happiness score ≥ 70 and no negative signal pending
5. sleepy        → no app activity for > configurable idle threshold (e.g. 6h+)
6. worried       → a GoalMissed/StreakBroken happened recently and happiness is trending down
7. sad           → happiness score ≤ 30
8. neutral       → default
```

`happiness` (0–100) moves in small increments per event (positive events add, `GoalMissed`/inactivity subtract modestly) and **passively drifts back toward a neutral midpoint over time** — this is what implements requirement A6 below (recovery, not permanent punishment).

## A5. Animation system — data-driven, not hardcoded

Every stage of every species can define up to 8 animation clips: `idle, happy, sad, excited, celebration, sleep, level-up, evolution`. Definitions live in an **external manifest**, not in React components:

```json
// assets/companions/manifest.json (excerpt)
{
  "species": [
    {
      "id": "sparkling",
      "name": "Sparkling",
      "stages": {
        "baby": {
          "clips": {
            "idle":       { "sheet": "sparkling/baby/idle/sheet.png",       "frames": 6,  "fps": 6 },
            "happy":      { "sheet": "sparkling/baby/happy/sheet.png",      "frames": 8,  "fps": 10 },
            "sad":        { "sheet": "sparkling/baby/sad/sheet.png",        "frames": 4,  "fps": 4 },
            "excited":    { "sheet": "sparkling/baby/excited/sheet.png",    "frames": 8,  "fps": 12 },
            "celebration":{ "sheet": "sparkling/baby/celebration/sheet.png","frames": 10, "fps": 12 },
            "sleep":      { "sheet": "sparkling/baby/sleep/sheet.png",      "frames": 4,  "fps": 2 },
            "level-up":   { "sheet": "sparkling/baby/level-up/sheet.png",   "frames": 12, "fps": 14 },
            "evolution":  { "sheet": "sparkling/baby/evolution/sheet.png",  "frames": 20, "fps": 14 }
          }
        }
      }
    }
  ]
}
```

Both sides read this manifest:
- **Rust** validates it at startup — checks every referenced sprite sheet file exists and dimensions are consistent — and exposes `#[tauri::command] get_companion_manifest()`.
- **React** has one generic `<SpriteAnimator clip={...} />` component that plays any clip from the manifest. Adding a new creature or stage is: drop sprite sheets in the right folder, add an entry to `manifest.json` — **zero component code changes**.

**Missing assets**: if a clip referenced by the current stage/mood is absent from the manifest (or the file fails to load), the player does **not** render blank. In dev builds it shows a visible "🖼 missing: sparkling/baby/celebration" placeholder tile and logs a warning; in production it falls back to that stage's `idle` clip (or a generic placeholder sprite if even `idle` is missing) so the companion is never invisible.

Original art only — no Digimon or other copyrighted sprite assets. Placeholder/programmer-art sprite sheets are acceptable during development as long as they're clearly first-party and labeled as placeholders.

## A6. "Recovery, not punishment" — concrete rule

- Missing a goal (`GoalMissed`/`StreakBroken`) only ever adjusts **happiness**, never XP and never level/evolution stage — progress already earned is permanent.
- Happiness has a floor above zero-engagement doom (e.g. never auto-decays below ~15) and passively recovers a small amount per day of app use even without a specific "big" event, plus jumps back up quickly on the next positive event.
- Sad/worried/sleepy are always *reachable and reversible same-session* states, not multi-day debuffs — the point is emotional feedback, not a punitive game mechanic.

## A7. Persistence (SQLite additions)

```
companion (singleton row, id = 1)
  species_id → companion_species
  current_stage            -- egg | baby | in_training | rookie | champion | ultimate | mega
  branch_id                -- "main" in v1, future-proofed for branching
  xp
  level
  happiness                -- 0-100
  mood                     -- last computed mood (cached; recomputed on read/event, not authoritative)
  state                    -- idle | animating | sleeping (drives which clip is "current")
  name                     -- user-given nickname
  last_interaction_at
  created_at

companion_species
  id, slug, display_name, description

companion_evolution_stages
  id, species_id → companion_species, branch_id, stage, min_level,
  condition_type            -- 'xp_threshold' (v1) | 'stat_based' (future)
  condition_json

companion_evolution_history
  id, companion_id, from_stage, to_stage, evolved_at, trigger_event_id → companion_event_log

companion_achievements
  id, key UNIQUE, title, description, unlocked_at

companion_event_log
  id, event_type, payload_json, xp_delta, happiness_delta, occurred_at
  -- full audit trail: source of truth for mood's "recent activity" window and for debugging/undo

xp_rules
  id, event_type UNIQUE, xp_amount, happiness_delta, cooldown_seconds NULL
  -- data-driven tuning without a rebuild

level_thresholds
  level (PK), xp_required
```

All companion tables get the same migration/versioning treatment as the rest of the schema (§ "Tauri + SQLite migrations" risk note already in this document).

## A8. Folder structure additions

```
student-command-center/
├── assets/
│   └── companions/
│       ├── manifest.json                 # data-driven registry (see A5)
│       └── <species_slug>/
│           └── <stage_slug>/             # egg, baby, in-training, rookie, champion, ultimate, mega
│               ├── idle/sheet.png
│               ├── happy/sheet.png
│               ├── sad/sheet.png
│               ├── excited/sheet.png
│               ├── celebration/sheet.png
│               ├── sleep/sheet.png
│               ├── level-up/sheet.png
│               └── evolution/sheet.png
├── src/
│   └── features/
│       └── companion/
│           ├── CompanionWidget.tsx       # dashboard widget (added to §14's widget list)
│           ├── SpriteAnimator.tsx        # generic manifest-driven player
│           ├── useCompanion.ts           # subscribes to `companion:updated` Tauri event
│           └── dialogue.ts               # deterministic, templated dialogue strings keyed by (event, mood) — no AI call
├── src-tauri/
│   └── src/
│       └── companion/
│           ├── events.rs                 # event type defs + in-process bus
│           ├── engine.rs                 # orchestrates xp/mood/evolution on event receipt
│           ├── xp.rs                     # xp_rules + level_thresholds lookups
│           ├── mood.rs                   # deterministic mood state machine (A4)
│           ├── evolution.rs              # stage condition evaluation, branch resolution
│           ├── assets.rs                 # manifest loader + startup validation (A5)
│           └── persistence.rs            # companion_* table access
```

## A9. Integration points (unchanged modules, one new call each)

Existing services gain exactly one responsibility: emit an event after their own write succeeds. No existing table, query, or feature behavior changes.

- Tasks service → `TaskCompleted` / `MajorTaskCompleted` on status change to Completed
- Exams service → `ExamCompleted`, plus `HighExamScore`/`PerfectExamScore` when percentage qualifies
- Study Analytics → `WeeklyGoalCompleted`, `StudyStreakReached`, `GoalMissed`/`StreakBroken` (computed during its existing nightly/on-read aggregation pass)
- Pomodoro/Study session service → `PomodoroCompleted`, `StudySessionCompleted`
- Flashcards/FSRS → `FlashcardMilestoneReached`
- Companion Engine → `LevelUp`, `EvolutionUnlocked` (self-generated, then broadcast to frontend the same way)

## A10. Dashboard integration

`CompanionWidget` is added to the existing customizable widget list (base doc §14) — resizable/removable like any other widget, plus it's the one place that always shows current mood + stage. No new top-level nav item is required for v1; a full "Companion" detail page (evolution history, achievements) can be added later as a settings/detail screen without architecture changes.

**Amended, Phase 14 Item 3:** the companion is no longer Dashboard-only. `App.tsx` now owns the single `useCompanion()` subscription and passes it down to both `Shell.tsx` (a global `FloatingCompanion` bubble, rendered outside `<Routes>` so it persists across navigation) and `Dashboard.tsx` (the `CompanionWidget` card above, now a prop-driven presentational component). This doesn't change anything below the frontend — same Rust engine, same `companion:updated` event, same deterministic rules; it's purely a frontend lifting of where that state is subscribed and drawn.

## A11. Roadmap changes

Inserted as its own early phase so later phases just need to emit events into an already-working engine:

- **Phase 1B — Companion Foundation** (immediately after Phase 1, before Phase 2): `companion_*` schema + migrations, event bus skeleton, Companion Engine (xp/mood/evolution logic) with `TaskCompleted`/`MajorTaskCompleted` wired (since Tasks already exists from Phase 1), asset manifest loader + missing-asset handling, `SpriteAnimator`, dashboard `CompanionWidget` with one placeholder species through all 7 stages (even if sprites are dev placeholders). Fully testable in isolation before any other event source exists.
- **Phase 2** additionally wires `PomodoroCompleted` / `StudySessionCompleted`.
- **Phase 3** additionally wires `StudyStreakReached`, `WeeklyGoalCompleted`, `GoalMissed`/`StreakBroken`.
- **Phase 5** additionally wires `ExamCompleted` / `HighExamScore` / `PerfectExamScore`.
- **Phase 12** additionally wires `FlashcardMilestoneReached`.
- **Phase 14 (Polish)** gains: companion achievement-history screen, asset QA pass (confirm no missing clips shipped), and a "companion behaves correctly with zero events ever fired" empty-state check.

No other phase's scope or order changes.

---

## A12. Custom companion packs (Phase 14 Item 4)

Adds a second source of `SpeciesManifest` entries alongside the bundled `assets/companions/manifest.json`: user-uploaded packs installed to `{app_data_dir}/companion_packs/<slug>/`, each with its own `manifest.internal.json` in the exact same `RawSpecies` shape the bundled loader already used (a deliberate reuse — `assets.rs`'s `process_raw_species` validates file-existence for both sources identically; only the base path and whether `ClipDef.sheet` ends up relative or absolute differ). `get_companion_manifest` merges both sources into one `AssetManifest`.

The one addition this needed to the shape itself: `SpeciesManifest.source: "bundled" | "custom"`, since the two live in genuinely different places from the frontend's perspective — bundled art is under the Vite/static asset root (`/companions/...`), custom art is in the OS app-data directory and can only be reached through Tauri's asset protocol (`convertFileSrc()`), which required enabling `security.assetProtocol` in `tauri.conf.json`, scoped to `$APPDATA/companion_packs/**`. `SpriteAnimator` branches on `source` to pick the right URL scheme; nothing else in the frontend needed to change.

Validation (`custom_pack.rs`) enforces the same 7 canonical stage names the schema's `CHECK` constraints already require (a custom pack supplies art, not new stages), requires at least an `idle` clip per stage, and checks each sprite sheet's pixel dimensions against the manifest's declared `frameWidth`/`frameHeight`/`frames` — via a minimal hand-rolled PNG IHDR reader rather than an image-decoding dependency, since a fixed 26-byte header read is all that's needed. A pack's `companion_evolution_stages` thresholds are always copied verbatim from the built-in "sparkling" species (`copy_evolution_thresholds`) rather than pack-authored, so switching art never changes when a level-up happens.

Exactly one custom slot (`slug = "custom"`) exists for now, deliberately — item 5 (Companion collection/unlocking, per `future_enhancement.md`'s Recommended Implementation Order) is what generalizes this to several named, simultaneously-installed packs; `load_all_custom_species` already scans `companion_packs/*` generically, so that generalization is additive, not a rewrite.

---

## A13. Companion collection (Phase 14 Item 5)

The original `companion` table (A7) was designed as a true singleton — `CHECK (id = 1)`, and every read/write in `persistence.rs`/`engine.rs` hardcoded that assumption. future_enhancement.md §4 needs several *independently progressing* companions (most locked), which that shape structurally can't express, so migration `0021` replaces it with `companion_collection`: the same columns, plus `is_unlocked`, `is_active`, and `unlock_order`. "Exactly one active companion" is enforced by a partial unique index (`CREATE UNIQUE INDEX ... ON companion_collection(is_active) WHERE is_active = 1`) rather than left to application code to get right every time — a second `UPDATE ... SET is_active = 1` without first clearing the old one fails at the database layer, not silently.

Every function that used to assume "the one companion" now takes an explicit id: `get_active_companion`/`get_companion_by_id` replace the old single `get_companion`, and `update_companion`/`set_companion_name`/`set_companion_species`/`record_evolution` all take one. `engine::process_event` resolves the active companion once at the top and threads its id through the rest of the function — nothing about the XP/mood/evolution logic itself changed, only which row it's reading and writing.

Unlocking is a direct consequence of evolution, not a separate system: `process_event` already computes `new_stage` every time it runs (A3), so the unlock check is just `if new_stage == "mega" { persistence::unlock_next_locked(conn)?; }` — no new event type, no new deterministic-rules file, reusing the exact machinery A1/A4 already require ("no AI in the progression engine") rather than adding a second decision point that could drift from it. `unlock_next_locked` picks the lowest `unlock_order` among locked rows — a data-driven sequence, not a hardcoded "unlock emberpup after sparkling" — so future_enhancement.md §4's "architecture must support adding more companions later" is just inserting another `companion_collection` row with the next `unlock_order`, no code change.

Switching active companion doesn't need any explicit "preserve old progress / reset new companion" logic, because there was never anything to preserve or reset in the first place: an inactive companion's row is simply never touched by `process_event` (it only ever reads/writes the active one), so §4's "previous companion keeps its progress" and "new companion has independent XP" are true by construction, not by extra code written to make them true.

`companion_evolution_history.companion_id` pointed at `companion(id)`, so repointing it at `companion_collection(id)` needed the same documented SQLite rebuild procedure (create `_new`, copy, drop, rename) migration `0008` used for a `CHECK` constraint change — SQLite has no `ALTER TABLE` for changing what a foreign key references either.

No other phase's scope or order changes.

---

## A14. Spotify integration (Phase 14 Item 6)

New top-level `spotify/` module, kept intentionally isolated from everything else — per future_enhancement.md §5's "keep the integration modular," nothing outside `commands/spotify.rs` imports from `spotify::` directly, and `spotify::` imports nothing from `ai::` or `companion::`. If Spotify changes an endpoint shape or deprecates a scope, the blast radius is this one module.

**Why PKCE, and why the user brings their own Client ID.** A distributed desktop binary can't keep a `client_secret` confidential — anyone can extract it from the compiled app. Spotify's Authorization Code + PKCE flow exists specifically for this case: the `code_verifier`/`code_challenge` pair (RFC 7636) proves possession of the original request without needing a secret at all. What's left over is the Client ID, which isn't sensitive (it's visible in the browser's address bar during login), and per-app rather than per-install — so each user registers their own Spotify app and provides their own Client ID, the same "bring your own API key" shape already established for Gemini/OpenRouter (ai/keychain.rs), rather than the app shipping one shared Client ID that would tie every installation's API usage to a single Spotify developer account.

**Why a loopback listener instead of a custom URL scheme.** Spotify (like most OAuth providers) supports registering a fixed redirect URI; a `127.0.0.1:<port>` loopback is simpler to implement correctly than a custom URI scheme handler (which needs OS-level registration/deep-link plugin wiring) and is Spotify's own documented recommendation for non-web apps. `tiny_http` runs a blocking accept loop on its own thread for exactly one request — not a real server, just enough to catch one redirect and hand control back.

**Token storage mirrors the existing pattern exactly, on purpose.** `spotify::token_store` calls into the OS keychain the identical way `ai/keychain.rs` already does for API keys (architecture.md §8's "secrets never touch SQLite" — reaffirmed here, not re-derived): a `keyring::Entry` under the same `student-command-center` service name, just a different key (`spotify_tokens`) holding a JSON blob (access token, refresh token, expiry) instead of a plain string. Refreshing happens transparently inside `oauth::get_valid_access_token`, called at the top of every `commands/spotify.rs` command via the same `spotify_command!` macro — callers above that point never see or reason about token expiry.

**No AI boundary crossing.** `spotify::client`'s request functions return plain structs (`SpotifyTrack`, `SpotifyPlaylist`, etc.); nothing in `commands/spotify.rs` or the pages that call it ever hands one of those to `ai::router` or constructs an `AiProvider` call with Spotify data in it. This isn't enforced by a runtime check — it's enforced by the module boundary simply never being crossed, matching future_enhancement.md §5's "do not send Spotify data to AI providers unless a future feature explicitly opts in."

**Addendum — what real-device testing found that this sandbox couldn't.** Four rounds of fixes followed initial delivery (full list in README.md's changelog); the two worth generalizing beyond "Spotify specifically":

- A `#[serde(rename_all = "camelCase")]` on a struct applies to *both* serializing (to the frontend) and deserializing (from the external API) — every `spotify::client` struct needed the asymmetric `rename_all(serialize = "camelCase", deserialize = "snake_case")` form instead, since Spotify's actual JSON is snake_case. This is a general trap for any future integration with a third-party API that isn't itself camelCase, not something specific to Spotify.
- Treating every documented response field as required was wrong — Spotify's real responses omit fields the docs don't clearly mark optional. After the second individually-reported "missing field" error, every non-essential field across all four structs was hardened at once (`#[serde(default)]`/`Option<T>`) rather than continuing to patch one field per bug report. Worth applying this same posture up front for any future third-party API integration, rather than waiting for it to be rediscovered the same way.

No other phase's scope or order changes.

---

## A15. Secret Private Video Journal (Phase 14 Item 8)

New `journal/` module, isolated the same way `spotify/` is (A14) — nothing outside `commands/journal.rs` reaches into it, and it imports nothing from `ai::`.

**Why the encryption key is never stored, anywhere.** The obvious alternative — store the derived AES key in the OS keychain, the way `spotify/token_store.rs` and `ai/keychain.rs` already store other secrets — would be wrong for this specific feature, on purpose. A keychain entry means "anyone/anything with this app's OS-level access can get the secret." That's the correct model for a Spotify refresh token or an API key, where the app itself is the trusted party. It's the wrong model for a *private* journal, where the point is that the password itself — something only the person knows, not something the app's storage access alone can produce — is the boundary. So `journal::crypto::derive_key` recomputes the key from the password + a stored (non-secret) salt every single unlock, and `journal::session::JournalSession` holds the result only in a `Mutex` inside Tauri's managed state — real memory, gone the instant the process ends. Two different secrets-handling patterns exist in this codebase now, and that's intentional: which one applies depends on whose access is supposed to be the boundary.

**Why auto-lock is enforced in `session::get_active_key`, not just in the UI.** A frontend timer that calls `journal_lock()` after N minutes of idle is necessary for the UI to *look* locked promptly, but it's not sufficient as the actual security mechanism — a UI bug, a missed interval, or a paused tab could all fail to fire it. `get_active_key` re-checks elapsed time against the threshold on every single call that would decrypt something, and clears the in-memory key itself if the threshold has passed. The frontend's own idle handling (not yet built beyond the explicit Lock button) is a UX nicety layered on top of a backend guarantee that holds regardless.

**Why title/note are encrypted, not just the video.** Nothing in future_enhancement.md §8 explicitly required this — it only calls out encrypting videos at rest. But storing a private journal's titles and notes in plaintext SQLite would leave exactly the kind of content someone opens this feature to keep private sitting in the clear, so `journal_entries.title_encrypted`/`note_encrypted` use the same per-entry AES-GCM encryption as the video. The cost is that search (`journal_search`) can't be a SQL `LIKE` query — it decrypts in memory, once unlocked, and filters there. Fine at the realistic scale of a personal daily journal; would need reconsidering if this ever became a bulk-import feature.

**Recording crosses the IPC boundary as base64, not a file path — a deliberate, named tradeoff.** The natural-seeming alternative (write the recorded blob to a temp file via a filesystem plugin, hand Rust just the path) would mean unencrypted video sits on disk, however briefly, before Rust ever touches it — directly undermining "encrypt videos at rest" for the sake of avoiding a JSON-serialized byte transfer. Given realistic journal-entry lengths (a personal video journal, not bulk footage import), the base64 round-trip's inefficiency is the acceptable side of that tradeoff. Revisit if entries end up being unexpectedly large in practice.

**UI structure (modernization pass).** The frontend is `features/journal/` (see the README's "Private Journal modernization" entry), with `JournalOverlay` as the only export the app shell uses. Two design points worth keeping if this is touched again: (1) the `Recorder` is always rendered in the same position in `JournalContent`'s tree, because an auto-lock during an unsaved recording swaps the entry list for an in-place unlock prompt and must NOT remount the recorder (that would destroy the draft); the security model is unchanged, since the list is hidden and the password is still required. (2) All overlay/modal/drawer Escape and Tab handling goes through `useModalLayer`, one document-level handler that only serves the topmost layer; do not add a separate `keydown` Escape listener in a new modal. Recordings must be encoded with `blobToBase64`'s last-comma extraction, since recorder MIME types contain commas.

No other phase's scope or order changes.

---

## A16. Design-system conventions (UI/UX modernization)

Rules a new page or component should follow so the app stays consistent. Everything lives in `src/components/ui/` unless noted.

- **Page shell:** wrap every page in `<PageContainer size="narrow|settings|default|wide">` and start it with `<PageHeader title actions?>`. No hand-rolled `max-w-*`/`p-6`/`space-y-*` roots, and no subtitle under a page title (Settings category pages are the exception — they take a `description`).
- **Accent colour:** `bg-accent`/`border-accent` are for DECORATIVE use only (rings, progress fills, dots). Anything carrying white text uses `bg-accent-fill` (+ `-hover`/`-active`); accent-coloured text uses `text-accent-text`; focus rings use `ring-accent-text`. Both are derived in `lib/theme/accent.ts` to be >= 4.5:1 for any chosen accent in both themes. `text-accent`/`bg-accent text-white` fail AA — don't reintroduce them.
- **Status colours:** use `tones.ts` or the equivalents (`text-red-700 dark:text-red-400`, `bg-red-500/10 text-red-700 dark:text-red-300`). Never `bg-red-50`, `text-*-600` or `border-red-300` — they're light-theme-only or low contrast.
- **Messages:** page-level failure → `<ErrorBanner message onReload onDismiss>`; other callouts → `<Callout tone>`; one line under a field → `<FieldMessage>`. A failed load must never be rendered as empty data: keep the data `null` and say it failed (see Dashboard's `failed`/`pending`), and never leave a skeleton showing next to an error.
- **Empty/loading:** `<EmptyState icon title description action>` (what's empty, why it matters, a real next step; use `lib/focusField.ts` when the next step is a form on the same page). `<SkeletonBar>` where the final layout is known, `<LoadingState>` otherwise.
- **Forms:** a control that is ambiguous without its label gets `<FormField label>`; a text input with a descriptive placeholder gets `aria-label`. `FormField` is deliberately NOT a `<label>` wrapper (browsers forward clicks inside a `<label>` to its control, which re-clicked `SelectMenu`'s trigger and reopened the menu) — the primitives pick the label up from `FieldLabelContext` as `aria-labelledby`. Give every `SegmentedControl`/`SelectMenu` an `ariaLabel` when no `FormField` surrounds it.
- **Icon-only buttons:** use `<IconButton label>` (label is required). Shared icons are in `icons.tsx` and are `aria-hidden` by default.
- **Modals/overlays in the journal** go through `features/journal/useModalLayer.ts`; outside the journal there are currently none.
- **Motion:** a global `prefers-reduced-motion` rule in `globals.css` is the safety net; still add `motion-reduce:` variants to anything that loops.

## A17. App identity, startup, profile & navigation layout

**Logo and icon.** `brand/logo-source.jpg` is the master artwork (white on black). `python3 brand/make_brand_assets.py` regenerates, deterministically, (1) the app icon set in `src-tauri/icons/` (rounded 824px plate on a 1024 canvas for macOS; PNG/ICO/ICNS) and (2) the two in-app masks embedded in `index.html`. Because the artwork is light-on-black, **luminance is the alpha**, so one asset serves any theme: the logo is a `<span class="scc-logo">` with `background: currentColor` and a CSS `mask`. Two masks are used — *shaded* (keeps the bevel) on dark, *solid* (smoothstep-thresholded silhouette) on light; mid-grey bevel pixels turn muddy when a shaded mask is tinted dark, which is why light needs its own. Use `<AppLogo size label?>`; never import the logo as an image.

**Startup sequence** (the fix for the white-then-black flash):

1. Native window background `#101114` (`tauri.conf.json` → `backgroundColor`) covers the webview's own white until it paints.
2. `index.html` runs a tiny inline script that applies the cached theme — `localStorage["scc.theme"] = {mode, vars}` written by `applyTheme()` — or the OS preference when there is no/invalid cache (parsing and applying fail independently). It then paints a static copy of `<SplashScreen />`. Everything needed (`.scc-logo`, `.scc-splash`, `.scc-spinner`, both masks as data URIs, `#root` height) is inline in `index.html` because in `tauri dev` Vite injects `globals.css` from JavaScript, i.e. *after* first paint.
3. React mounts `<SplashScreen />` while settings load — identical markup/classes, so the swap is invisible. **Keep the two in sync.**
4. Settings arrive → `applyTheme` (also refreshes the cache) → if `!onboardingCompleted`, `<OnboardingScreen />`, else the shell.

**Profile & onboarding.** `user_settings.profile_icon` (an id from `features/profile/avatars.ts`, `''` = none → name's initial shown) and `onboarding_completed` (migration 0029; both default so a fresh install and the `INSERT INTO user_settings (id) VALUES (1)` in a settings reset land in onboarding with no extra code). `reset_saved_data` always clears name/icon/flag (`reset_profile`) whether or not settings are also reset, and the Data page always reloads afterwards. Only the id is stored, so glyphs/colours can change without a migration; Rust validates shape (`[a-z0-9-]{0,32}`) but not membership.

**Shell layout.** Rail (hamburger top, Settings gear bottom) + expanding panel (logo header, reorderable list, gear footer) on the left; on the right a 48px top bar holding the profile avatar, then `<main>`. The gear is the pinned `settings` entry of the nav registry.

**Navigation layout.** `src/app/navItems.ts` is the registry (stable `id`, route, label, `locked`, `pinned`). `user_settings.nav_layout_json` stores `[{id, hidden}]` in the user's order (migration 0027). `resolveNavLayout()` reconciles it with the registry on every read: saved order first, unknown ids dropped, duplicates keep the first, new registry items appended visible, `locked` items forced visible. An empty list means default order. Rust validates structure only (unique `[a-z0-9-]` ids, ≤ 64 entries, `settings` never hidden) — never membership, so removing a page later can't make saving fail. Hiding removes the link only; the route still works. `NavigationOrderEditor` reorders three ways (pointer-captured drag, ArrowUp/Down on the grip, ↑/↓ buttons) and commits **one save per gesture**.

**Time handling (rule).** Every timestamp in the database is the user's LOCAL wall-clock time, never UTC: frontend-written values are local `YYYY-MM-DDTHH:MM:SS`; SQL that stamps "now" for a study session or compares against "today" must use `'now', 'localtime'` (modifier order matters: `'localtime'` before any `'-N days'`). Pure metadata (`created_at`/`updated_at`, companion event log, journal lockout) stays UTC and is only ever compared with other UTC values. Migration 0028 converted the pre-fix Pomodoro rows once.

## A18. Performance & failure-handling rules

- **Indexed range joins.** Bucketed stats (`analytics.rs`, `finance.rs`) join the series to the raw column with a range, never `date(col) = d` / `strftime(..., col) = ...` — a function on the column disables the index and turns each bucket into a full scan (measured: 12.9 s → 118 ms at 200k rows). Both stored timestamp formats begin `YYYY-MM-DD`, so range comparison on the string is equivalent.
- **Long lists.** Use `useIncrementalList` + `<ShowMore>` (`components/ui/ShowMore.tsx`): filter on the full list, slice after, pass the filter/search/month as `resetKey`. Page size 100.
- **Settings saves** go through `useSettingsSave` (rollback to the last stored settings + `<SettingsSaveError>`); never `try/finally` without a `catch` around `updateSettings`.
- **AI cost accounting.** `check_budget` sums only costs a provider *reported*: OpenRouter reports one; Gemini doesn't, so Gemini Pro is invisible to the dollar limit. It is guarded instead by `ai_pro_monthly_request_cap` (migration 0030), counted by `usage::paid_gemini_requests_this_month` (all non-Flash Gemini rows this UTC month, failures included) and enforced in `router::route()` after the dollar gate. Any new paid provider that reports no price needs the same kind of count-based guard — never leave an unmeasurable cost outside every limit.

## A19. Backup & restore

**File.** `*.sccbackup` = zip: `manifest.json` (`format`, `appVersion`, `schemaVersion`, `createdAt` UTC, `includesJournalVideos`, `journalVideoCount`), `database.sqlite`, `journal/videos/<name>.enc` (optional, stored uncompressed — already encrypted), `companion_custom/…` (custom companion artwork). Written to `<name>.partial` and renamed, so a failure or full disk never leaves something that looks complete.

**Never in a backup:** API keys and Spotify tokens (OS keychain, not the database). The journal password is only an Argon2 hash in `journal_security`; the videos stay encrypted, so a restored journal opens with its old password.

**Consistency.** Snapshots use `VACUUM INTO`, never a file copy — the database is in WAL mode, so a copied `.sqlite` can be stale or unusable. `backup::snapshot_to` is shared with "Reset saved data".

**Restore invariants** (`commands/backup.rs`):
1. Validate before touching anything: zip + manifest + `format` + `schemaVersion ≤ latest_schema_version()` + `PRAGMA integrity_check` + a `user_settings` row.
2. Never swap the database file under the connection pool. `ATTACH` the extracted snapshot as `bk` and copy rows in ONE transaction (`BEGIN IMMEDIATE`, `foreign_keys` OFF before it, `PRAGMA foreign_key_check` must be empty before `COMMIT`). Any failure → `ROLLBACK` → current data untouched. The pooled connection is always returned with `foreign_keys = ON` and `bk` detached.
3. Per table: `DELETE` then `INSERT (common columns) SELECT …` — columns the backup lacks take their defaults (older backups), extra ones are ignored; tables the backup lacks are emptied (replace everything).
4. Not replaced: `schema_migrations`; `xp_rules`, `level_thresholds` (migration-defined config; an old backup must not roll back tuned values). `companion_species` / `companion_evolution_stages` hold built-ins too, so only the `'custom'` rows are replaced, re-inserted with a fresh id and every `species_id` pointing at the old one remapped.
5. AUTOINCREMENT counters (`sqlite_sequence`) are carried over for replaced tables so ids of rows deleted before the backup aren't reused.
6. Folders (journal videos, custom companion pack) are renamed aside (`…pre-import-<stamp>`) and the staged ones renamed in; undone if the database step fails. The aside folder is kept only if it contains files.
7. A safety copy of the current database is written to `backups/pre_import_<stamp>.sqlite` first. The journal session is locked afterwards, and the frontend reloads.

**Privacy rule for the UI.** Journal wording appears on the Data page only when journal videos exist (or the chosen backup contains some).

**Dead-code hygiene.** `rustc` warns on unused `pub` items in this binary crate — treat every `cargo build` warning as real (one of the seven was a swallowed error). `create_study_session` is intentionally kept as the backend of the not-yet-built manual session screen.

## A20. Cross-platform support (macOS · Windows · Linux)

One shared React + Rust codebase; platform differences live in a few named places, not scattered `if (platform)` checks. The frontend has **no** OS branches at all (there are no `Cmd`/`Ctrl` shortcuts in the app — the only key handling is Escape/Arrow/Enter/Tab, which is identical everywhere — and no clipboard, drag-and-drop or notification code).

**Platform audit** (what was checked, and where each difference is handled):

| Area | Verdict | Handled in |
|---|---|---|
| App data folder | **Was wrong on Win/Linux** — see below | `db::app_data_dir()` |
| SQLite, migrations, WAL, backup/restore | Shared (bundled SQLite; restore uses `ATTACH` + SQL, never swaps the open file, so Windows file locks don't matter) | `db/`, `commands/backup.rs` |
| Secret storage (API keys, Spotify tokens) | Platform backend, one API | `keyring` features: `apple-native` / `windows-native` / `sync-secret-service`; `ai::keychain::platform_hint()` adds the Linux explanation to errors |
| Private Journal key | Shared, in memory only (deliberately not in any keychain) | `journal/session.rs` |
| Opening URLs | Shared, via the Tauri opener plugin (`open_url` in Rust; the plugin's init script is what makes `<a target="_blank">` open the system browser — to be confirmed on Windows/Linux) — no `open`/`xdg-open`/`start` anywhere | `spotify/oauth.rs`, `Spotify.tsx` |
| File dialogs | Shared, `tauri-plugin-dialog` (Cocoa / Win32 / GTK) | `BackupRestore.tsx`, `Companion.tsx` |
| Companion pack art (asset protocol) | Shared **once the data folder matches `$APPDATA`** | `tauri.conf.json` scope, `db::app_data_dir()` |
| Window / title / icons | Shared config; Linux icon list starts with the 512 px PNG so the taskbar icon isn't the 32 px one | `tauri.conf.json`, `tauri.linux.conf.json` |
| Installer / packages | Per-platform override files | `tauri.windows.conf.json` (NSIS), `tauri.linux.conf.json` (deb + AppImage); macOS keeps `"all"` (app + dmg) |
| Camera/mic (Journal recording) | macOS: `Info.plist` usage strings; Windows: WebView2 permission prompt; Linux: needs a WebKitGTK with MediaRecorder + GStreamer plugins (AppImage bundles the media framework) | `Info.plist`, `bundleMediaFramework`, `journalUtils.describeMediaError` |
| Fonts | `system-ui` first, then Segoe UI / Roboto / Noto Sans / Cantarell / Ubuntu / Arial; emoji fonts last | `styles/globals.css` |
| Native scrollbars / form chrome | `color-scheme: light` on `:root`, `dark` on `.dark` — Windows/Linux draw classic scrollbars that would otherwise stay light in the dark theme | `styles/globals.css` |
| JS build target | Tauri v2 env names (`TAURI_ENV_PLATFORM`); WebView2 → `chrome105`, WebKit → `safari13` | `vite.config.ts` |
| Logs / startup failures | One log file in the data folder; Windows startup panics show a message box | `logging.rs` |
| Dev/build scripts | Plain `npm`/`tauri` scripts — no shell-specific commands | `package.json` |

**Data folder rule.** `app_data_dir()` is `<per-user data folder>/<identifier>` with the identifier from `tauri.conf.json` (`com.studentcommandcenter.app`) — exactly what Tauri calls `$APPDATA`:

- macOS `~/Library/Application Support/com.studentcommandcenter.app` (identical to before — existing data is untouched)
- Windows `%APPDATA%\com.studentcommandcenter.app`
- Linux `$XDG_DATA_HOME` or `~/.local/share/com.studentcommandcenter.app`

The previous code used the `directories` crate's `ProjectDirs`, which agrees with Tauri only on macOS (Windows: `…\studentcommandcenter\app\data`; Linux: `~/.local/share/app`). On those two the custom-companion asset scope (`$APPDATA/companion_packs/**`) would not have covered the folder the packs are written to, so custom art would never have rendered. If a database exists at the old location and none at the new one, the folder is **renamed** to the new location on first launch (never copied-then-deleted; if the rename fails the old folder keeps being used). Changing the identifier changes the data folder and the asset scope together — don't.

**Install locations.** Nothing is read relative to the working directory or the install folder: the database, packs, journal videos, backups and logs are all under the data folder, and companion sprites are Tauri resources. So `C:\Program Files\…`, `~/Applications`, `/usr/bin` and a mounted AppImage all behave the same. The NSIS installer offers per-user or all-users; uninstalling keeps your data (the "delete app data" option is off).

**Known WebView differences to watch** (not yet exercised on real Windows/Linux — see README "Platform test status"): classic scrollbars take ~15 px of width (the app uses no `100vw`/`w-screen`, so nothing is sized against the full window width); `backdrop-blur` is software-rendered on some Linux GPUs; WebKitGTK can show a blank window on some NVIDIA/Wayland setups (workaround: launch with `WEBKIT_DISABLE_DMABUF_RENDERER=1`); `<input type="date">` pickers are drawn by the engine, not the OS.

**Not added, on purpose:** no Ollama/local AI, no OCR or document dependencies, no tray icon, no auto-updater, no new crates. Documents, Flashcards, spaced repetition, the study canvas and RAG remain unbuilt.

## Next Step

With the companion amendment incorporated, Phase 1 remains: Tauri project scaffold, React+TS+Tailwind frontend, Rust command layer, SQLite with initial migrations (courses/subjects/topics/tasks/schedule_blocks/user_settings), sidebar navigation, dashboard shell, settings page, theme/accent system, task manager with full CRUD, and manual scheduling — all persisted to disk. **Phase 1B (Companion Foundation)** follows immediately after, per A11.

Say the word and I'll start building Phase 1, then 1B, testing as I go.
