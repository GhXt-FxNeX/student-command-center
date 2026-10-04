# Student Command Center — Future Enhancements

> Features intentionally deferred from the core roadmap. Implement them only when promoted into a phase. Preserve the existing local-first, privacy-first architecture.

## 1. Data Management — Reset Saved Data & Reset Demo Data

**Status: implemented (Phase 14, first item).** `commands/data_management.rs` — `reset_saved_data` (full reset, auto-backup, settings kept unless opted in, companion reset to its seeded state rather than deleted), `reset_demo_data` (deletes only `is_demo = 1` rows, migration 0018), `generate_demo_data` (small "[Demo] ..." sample dataset). UI lives in Settings under "Data Management." Next: item 2, Collapsible Navigation.

### Reset Saved Data
Add a clearly labeled Settings action to reset user-created application data.

Requirements:
- Explain exactly what will be deleted.
- Require explicit confirmation.
- Never silently delete data.
- Use a transaction where appropriate.
- Create a backup before a full reset when practical.
- Keep application settings/configuration unless the user explicitly chooses to reset them.

### Reset Demo Data
Add a separate action that deletes only data explicitly tagged as demo/test data.
- Never guess which records are demo data.
- Never delete real user data.
- Allow demo data to be regenerated for testing.

---

## 2. Companion — Application-Wide Persistent Pet

**Status: implemented (Phase 14, third item).** The companion's live state (`useCompanion()`) is now subscribed once in `App.tsx` and passed down to both `Shell.tsx` (new `FloatingCompanion.tsx`, a bottom-right corner bubble rendered outside `<Routes>` — so navigating between pages never unmounts or resets it) and `Dashboard.tsx`'s existing detailed `CompanionWidget` card, which now takes that state as props instead of opening its own IPC listener. Clicking the bubble opens a small popover (name, level, stage, mood, dialogue line, XP/happiness bars — sharing the new `CompanionStatBars.tsx` with the Dashboard widget) that closes on outside click or Escape. A new `usePrefersReducedMotion()` hook (`src/lib/`) freezes `SpriteAnimator`'s frame-stepping `setInterval` for users with that OS preference, since Tailwind's `motion-reduce:`/`motion-safe:` variants only reach CSS, not JS animation loops — those still cover the bubble's own hover/pop transitions. Everything is themed via the existing CSS-variable tokens (`bg-surface`, `border-border`, `bg-accent`, …), so it's correct under light/dark and any custom accent color with no extra styling logic. Next: item 4, Companion naming/customization.

Turn the companion into a persistent part of the entire application rather than a Dashboard-only decoration.

### Progression
The companion gains XP from:
1. Completing tasks.
2. Scoring 95% or higher on an exam.
3. Completing the weekly study goal.

Support configurable XP values and evolution thresholds.

Track:
- Level
- XP
- Evolution stage
- Name
- Mood
- Unlock state
- Evolution history

When thresholds are reached, evolve through the configured evolution stages.

### Mood and reactions
Positive events:
- Task completed → happy/proud animation.
- 95%+ exam → celebration animation.
- Weekly study goal completed → excited/celebration animation.
- Evolution → special evolution animation.

Negative/neutral events:
- Missed weekly study goal → sad/disappointed animation.
- Long inactivity → sleepy/bored animation.
- Lost streak → disappointed reaction.

The companion should motivate rather than excessively punish or guilt the user.

### Global placement
Render the companion from the global application shell so it remains visible while navigating between tabs.

Requirements:
- Float away from navigation controls.
- Never obstruct important controls.
- Follow the user between tabs without resetting.
- React immediately to qualifying events.
- Preserve appropriate animation state.
- Respect reduced-motion settings.
- Work with light/dark themes and custom accent colors.

---

## 3. Companion — Rename & Custom Companion Upload

**Status: implemented (Phase 14, fourth item).** Settings → Companion now has a name field (`rename_companion` command, saved on blur) and an "Upload a pack…" flow: a native file dialog (new `tauri-plugin-dialog` dependency) picks a `.zip`, which `custom_pack.rs` extracts to a temp staging dir (zip-slip-protected via `enclosed_name()`), validates in one pass — collecting every problem rather than stopping at the first — against the rules below, and on success copies it into `{app_data_dir}/companion_packs/custom/` and registers it as a `companion_species` row named "custom" with `companion_evolution_stages` thresholds copied verbatim from the built-in "sparkling" species (a custom pack supplies art, not a progression curve). Installing doesn't switch the active companion — a separate "Use this companion" / "Revert to default companion" pair in Settings does that explicitly, so a validation result (including non-fatal warnings) can be reviewed before committing. Exactly one custom slot exists; re-uploading replaces it. See `assets/companions/README.md`'s "Phase 14 Item 4" section for the full manifest schema and validation rules.

Two things worth knowing about the plumbing: (1) custom-pack images don't live under the frontend's static asset root the way bundled ones do, so they're served through Tauri's asset protocol instead — `tauri.conf.json` now enables `security.assetProtocol` scoped to `$APPDATA/companion_packs/**`, and `SpriteAnimator` resolves a species' clips via `convertFileSrc()` when `SpeciesManifest.source === "custom"` instead of the bundled `/companions/...` relative path. (2) PNG dimension/color-type validation is a hand-rolled IHDR-chunk reader (33 fixed header bytes, no image-decoding crate) rather than a dependency — it confirms a PNG's format *supports* transparency, not that any given pixel is actually transparent, which is called out explicitly in both the in-app warning text and the README so it isn't mistaken for a stronger guarantee than it is. Next: item 7, Book Maker.

### Rename
Add a Settings control allowing the user to change the companion's name. Use the chosen name everywhere the companion identity is displayed.

### Custom companion
Allow users to upload their own companion asset pack without editing application source code.

A custom companion must provide assets for every supported evolution stage.

Validate:
- Evolution stages
- Animation folders
- PNG/image assets
- Consistent frame dimensions
- Required animations
- Transparent background where appropriate

Use a manifest containing:
- Companion name
- Stage order
- Frame dimensions
- Animation names
- Frame files
- Frame rate
- Optional metadata

Reject incomplete/invalid asset packs with a useful error.

---

## 4. Companion Collection / Multiple Companions

**Status: implemented (Phase 14, fifth item).** The old `companion` table was a hard singleton (`CHECK (id = 1)`) — replaced (migration `0021`) with `companion_collection`: one row per owned/lockable companion, `is_unlocked`/`is_active` flags, and exactly-one-active enforced by a partial unique index (`... WHERE is_active = 1`) so a second simultaneously-active companion isn't just discouraged, it's impossible to insert. Three slots seeded: Sparkling (unlocked, active — the original companion's data migrated in, unchanged), and two more locked ones (`emberpup`, `tidewhelp` — placeholder art, same "flat shape" bootstrap Sparkling itself started with; real designs can replace them later same as always). `engine.rs::process_event` now resolves and updates the *active* companion by id rather than assuming id 1, and calls a new `persistence::unlock_next_locked` the moment `new_stage == "mega"` — deterministic, no judgment call, matches architecture.md A1/A4's "no AI in the progression engine" rule. Switching (`switch_active_companion` command) only flips which row `is_active`; nothing needed to reset or preserve on either companion's progress, because process_event only ever touches the active row in the first place — the spec's "previous companion keeps its progress" and "new companion has independent XP" were already true by construction once the schema stopped assuming there was only one companion. `CollectionEntrySummary` (the type the new Settings → Companion → "Your companions" grid consumes) deliberately nulls out progress fields for a locked companion rather than exposing its real-but-meaningless default row values (level 1/egg/0xp) — showing that would read as fake progress, not "locked."

One thing this surfaced and fixed in the process: `reset_saved_data` (Item 1) still wrote to the now-dropped `companion` table — a real bug that would have broken every reset. Fixed to reset all 3 collection slots back to their migration-seeded state (Sparkling unlocked/active, the other two locked) rather than just one row.

Initially support a collection of three companions.

- User starts with one companion.
- Other companions begin locked.
- Reaching the ultimate/final evolution of the current companion unlocks another companion.
- Architecture must support adding more companions later.

### Switching
When switching to a different companion:
- New companion starts at Level 0.
- New companion starts at its first evolution stage.
- New companion has independent XP/progression.
- Previous companion keeps its progress.
- Unlocks remain permanent.

Example:

    Sparkling — Level 42 — Ultimate
                ↓
          Unlock companion
                ↓
       New companion — Level 0

Provide a collection UI showing owned/locked companions, current companion, level, XP, evolution progress and unlock requirements.

---

## 5. Spotify Integration

**Status: implemented (Phase 14, sixth item), confirmed working end-to-end after four rounds of real fixes.** Connection, OAuth, and general library browsing all confirmed working on Fayad's machine. Full fix history is in `README.md`'s "Spotify — post-release fixes" changelog entry — summary: (1) a `rename_all` direction bug meant every Spotify response failed to deserialize entirely (fixed), (2) Spotify's own Feb 2026 API migration renamed playlists' `tracks` field to `items` (handled via alias), (3) playback originally just opened a browser tab — now triggers Spotify Connect playback from inside the app, with the caveat spelled out in the UI that this controls an already-active device rather than producing audio in the app itself (a genuine Spotify Web API limit, not something fixable here), (4) a 411 error on play/pause from a missing `Content-Length` header on a body-less PUT request (fixed), (5) podcasts were never built at all — added (`/me/shows`, a fourth tab), (6) after adding podcasts, a further "missing field" error led to hardening *every* non-essential field across all four response structs with `#[serde(default)]`/`Option<T>`, rather than continuing to patch one field at a time as each was individually reported.

Authorization Code + PKCE (the flow Spotify requires for a distributed desktop app — no client_secret can be safely embedded in a binary users download), matching the "bring your own credential" pattern already used for the Gemini/OpenRouter API keys: the user creates their own free app at developer.spotify.com, gets a Client ID (not a secret — it's literally visible in the browser URL during login, so it lives in `user_settings.spotify_client_id`, migration `0023`, not the keychain), and registers `http://127.0.0.1:8898/callback` as its redirect URI. `spotify::oauth::connect` opens the consent screen in the system browser (`tauri-plugin-opener`), catches the redirect on a temporary `tiny_http` loopback listener, verifies the CSRF `state`, and exchanges the code + PKCE verifier for tokens — the app never sees the Spotify password. Tokens are stored via `spotify::token_store`, which reuses `ai/keychain.rs`'s exact OS-keychain pattern (one JSON blob — access token, refresh token, expiry — under a single keychain entry). `oauth::get_valid_access_token` refreshes automatically (60s before actual expiry) whenever a Spotify command runs, so nothing above `spotify::client`'s request functions needs to think about token lifetime at all.

`spotify::client` is a deliberately thin, boring layer — one function per endpoint (profile, playlists, saved tracks, saved albums, playback state, play/pause/next/previous/volume), each just building a bearer-authed request and parsing the response, no caching or business logic — so a Spotify API change is isolated to one function, per the spec's "keep the integration modular" requirement. A new **Spotify** nav page shows playlists/saved tracks/saved albums (each linking out to open the item in Spotify itself, not attempting to embed playback) plus a now-playing bar with play/pause/skip/volume when something's actively playing somewhere; Settings → Spotify handles the Client ID field and Connect/Disconnect. Nothing in `spotify::` or its callers is ever passed to `ai::router` or any `AiProvider` — no Spotify data reaches an AI provider anywhere in this integration, matching "do not send Spotify data to AI providers unless a future feature explicitly opts in" (no such feature exists yet).

Two honest limits worth knowing: playback control (play/pause/skip/volume) needs Spotify **Premium** and an already-active device (Spotify open somewhere) — a 404 from Spotify's player endpoints is deliberately surfaced as "no active device," not a generic error, since that's the actual common case for a free account or no device open. And "Disconnect Spotify" removes the locally-stored tokens (so this app can no longer act on the account) but doesn't reach into the user's Spotify account settings to revoke the app's access there — full revocation, if wanted, is still a manual step on Spotify's own "Apps" page, which the disconnect flow should probably say explicitly if this becomes confusing in practice.

Allow users to connect Spotify from inside Student Command Center and access supported Spotify content without manually opening Spotify.

### Authentication
Use Spotify's official OAuth flow.
- Never request/store the Spotify password.
- Store tokens securely using the existing OS keychain/security architecture.
- Handle expiration/refresh safely.
- Provide Disconnect Spotify.

### Initial capabilities
Where supported by the current Spotify API/account permissions:
- User albums/library.
- Playlists.
- Saved tracks.
- Appropriate playback/control features.

Keep the integration modular so Spotify API/policy changes do not break the rest of the app.

Do not send Spotify data to AI providers unless a future feature explicitly opts in.

---

# 6. Book Maker — Presentation/PDF to A4 Study Book

**Status: cancelled, skipped by explicit request — moving straight to item 8 (Secret Private Video Journal).** Not built, not started. If this is revisited later, treat the section below as an untouched spec, not a partial implementation to resume.

Create a Book Maker that turns educational presentations or PDFs into aesthetically designed A4 study books.

## Absolute rule: content preservation

Book Maker is a document transformation/layout engine, NOT a summarizer.

The final book must preserve the supplied source content:
- Nothing added.
- Nothing removed.
- Nothing paraphrased.
- Nothing summarized.
- No terminology changes.
- No invented explanations.
- No changed numerical values.

AI must NEVER rewrite source content.

### Input
Support:
- PPTX
- PDF
- Scanned PDF through OCR

PPTX pipeline:

    PPTX
      ↓
    PPTX → PDF
      ↓
    deterministic extraction
      ↓
    structure detection
      ↓
    AI design specification
      ↓
    deterministic book renderer
      ↓
    integrity verification
      ↓
    A4 PDF

PDF pipeline:

    PDF
      ↓
    text extraction
      ↓
    OCR only when needed
      ↓
    structure detection
      ↓
    design
      ↓
    rendering
      ↓
    verification
      ↓
    A4 PDF

If OCR is used, warn the user that OCR can introduce recognition errors and provide an integrity/review report.

## Canonical document model

Represent extracted content in a structured model containing, where available:
- Metadata
- Sections/chapters
- Titles/headings
- Paragraphs
- Bullet/numbered lists
- Tables
- Images
- Captions
- Source/page references
- Original ordering

The extracted representation is the content source of truth.

## AI design engine

AI may analyze the subject and document structure to choose/design:
- Cover
- Typography
- Heading hierarchy
- Chapter headers
- Section dividers
- Margins
- Headers/footers
- Page numbering
- Tables
- Image placement
- Page-break strategy
- Spacing
- Accent treatment

Different books should receive different professional designs instead of one repeated template.

Possible design families:
- Academic textbook
- Clinical reference
- Scientific
- Minimal
- Classic
- Modern
- Anatomy-oriented
- Pharmacology/reference
- Physiology/scientific
- Pathology/atlas-inspired
- Biochemistry/scientific

AI provides a design specification; deterministic rendering produces the actual book.

## Preview

Before full generation, show:
- Source filename
- Detected subject
- Estimated page count
- Detected sections
- Selected design
- Content-preservation status
- Representative page previews

## Integrity verification

Before export, compare source content with generated content.

Detect:
- Missing text
- Added text
- Modified text
- Duplicated text
- Missing sections/headings
- Missing tables where verification is possible

Example:

    BOOK INTEGRITY
    Source text: 48,392 characters
    Output text: 48,392 characters

    ✓ No missing text
    ✓ No additional text
    ✓ No modified text
    ✓ Structure verified

If verification fails, do not export the PDF and show the user what failed when possible.

## Output
Export a professional:
- A4 PDF
- Print-friendly layout
- Consistent typography
- Page numbers
- High-quality images where possible

---

# 7. Collapsible / Hover Navigation

**Status: implemented (Phase 14, second item).** `app/Shell.tsx` — collapsed by default (56px rail, hamburger only), hover expands (350ms collapse delay after pointer leaves), click pins/unpins, `focus-within` keeps it open and visible for keyboard nav, `motion-reduce:` disables the transition for users with that OS preference. Not persisted across launches (always starts collapsed) — no `user_settings` column for it yet; easy additive follow-up if that turns out to matter.

Implementation note: the first version animated the rail's own `width` between collapsed/expanded, which hit a classic flexbox bug — flex items default to `min-width: auto`, so a column of `whitespace-nowrap` nav labels set an intrinsic minimum width that kept the rail from actually shrinking, even after adding `min-w-0`. Rewritten to keep the 56px rail a fixed, never-resized element and float the expanded panel over it as an absolutely-positioned overlay that slides via `transform: translateX()` instead of `width` — transforms don't participate in flex sizing at all, so this bug class isn't reachable anymore.

That same `transform: translateX()` panel turned out to matter again for item 3 (Companion global-shell integration): a CSS `transform` on an ancestor creates a new containing block for `position: fixed` descendants, so the global companion had to be placed as a *sibling* of the nav rail rather than nested inside it — see `FloatingCompanion.tsx`'s doc comment.

Replace the permanently expanded sidebar with a compact navigation system.

### Collapsed state
- Hamburger/menu button at top-left.
- Main content expands into the freed sidebar space.

### Hover
Hovering the hamburger reveals the navigation panel.
- Show all tabs.
- Highlight current tab.
- Smooth subtle animation.
- Keep open while pointer is over the navigation.
- Collapse shortly after pointer leaves.

### Accessibility
- Clicking hamburger opens/pins the panel.
- Keyboard navigation remains possible.
- Respect reduced-motion.
- Do not trap focus.

The companion must remain functional and correctly layered regardless of navigation state. **Done** — see the implementation note above the Collapsible Navigation section and `FloatingCompanion.tsx`.

---

# 8. Secret Private Video Journal

**Status: implemented (Phase 14, eighth item), not yet confirmed working — needs an actual camera/mic recording test on Fayad's machine.** New `journal/` module (crypto.rs, session.rs, storage.rs) plus `commands/journal.rs`, following the same "kept isolated, narrow surface to commands" shape as `spotify/`. Security design, spelled out because it's the entire point of this feature:

- The password is never stored, anywhere, in any form that could reveal it. `journal_security.password_hash` is an Argon2id PHC string — safe to store, used only to verify a password attempt, structurally unable to be reversed back into the password.
- The AES-256 key that actually encrypts videos is *derived* from the password (Argon2id again, a separate stored salt) fresh every unlock, and lives **only in memory** for the unlocked session (`journal::session::JournalSession`, managed Tauri state, a `Mutex<Option<UnlockedState>>`) — never written to disk, not even encrypted, not in the OS keychain. This is deliberate: a keychain entry would make the app's OS-level storage access the real security boundary instead of the person's own password. Closing the app destroys this in-memory state along with the process — "closing the app always locks the journal" needed zero extra code to be true.
- Auto-lock is enforced at the point of use, not just suggested by the UI: `session::get_active_key` (called first by every command that touches entry content) checks elapsed time since last activity against the configured threshold and clears the key itself if it's passed — even a UI bug can't get a command to decrypt anything past the real timeout.
- Repeated wrong-password attempts get a growing backoff (30s → 2min → 15min, tracked in `journal_security.failed_attempts`/`locked_until`) rather than either no protection or an arbitrary permanent lockout.
- Title/note are encrypted too (`title_encrypted`/`note_encrypted`, same key as the videos) — search works by decrypting in memory once unlocked, not via SQL `LIKE` against plaintext, since storing a private journal's titles/notes as plaintext would defeat a lot of the point. Videos are never SQLite BLOBs — encrypted files live under `{app_data_dir}/private_journal/videos/`, filenames are random (not derived from anything user-provided, sidestepping path-traversal concerns entirely).
- Changing the password re-derives a new key and **re-encrypts every existing entry** (title, note, and video file) with it — necessary because the key IS the password via the KDF, so there's no separate "master key" a password change could otherwise leave untouched.

Secret activation is three consecutive clicks on the Settings nav item within 1.2s (`app/Shell.tsx`) — deliberately just a discovery mechanism, never the actual security boundary (the password is), matching §8's own framing. The journal is rendered as a full-screen overlay from `Shell.tsx`, entirely outside React Router — no route, no URL, nothing to type or bookmark to reach it directly. Recording uses the browser's native `getUserMedia`/`MediaRecorder` (no new Tauri plugin needed — this runs in the webview like any other browser API); the recorded blob crosses to Rust as base64 through the normal `invoke` call, since a temp-file-based transfer would mean briefly writing unencrypted video to disk, undermining the "encrypt at rest" point for the sake of IPC efficiency — accepted as the right tradeoff for realistic journal-entry lengths, called out explicitly rather than silently.

Wired into Item 1's `reset_saved_data`: a full app reset now also clears every journal entry, the password/security row, and the actual video files on disk (not just DB rows), and locks any stale in-memory unlocked session — found and fixed a real bug in the process where an earlier edit had accidentally dropped the `reset_saved_data` function signature line entirely, caught immediately by the balance-check pass that runs after every Rust edit in this project's workflow.

No AI provider, RAG pipeline, or external service ever sees journal content — `journal::` imports nothing from `ai::`, matching §8's "Local-first privacy" section ruling out Gemini/OpenRouter/Ollama/NotebookLM/RAG for journal content without explicit future opt-in.

Create a deliberately hidden private daily video-journal area.

It must NOT appear in normal sidebar navigation.

## Secret activation

1. Open Settings.
2. Click/press Settings three consecutive times within a short detection window.
3. Show a password prompt.
4. Correct password → open Private Journal.
5. Incorrect password → remain locked.

The triple-click is only an obscurity/discovery mechanism. It is NOT the security boundary.

## Recording

Allow the user to:
- Start recording.
- Stop recording.
- Preview.
- Re-record.
- Save.
- Delete.

Each entry contains:
- Date
- Video
- Duration
- Creation timestamp
- Optional title
- Optional text note

Use appropriate native/local Tauri recording capabilities.

## Local-first privacy

Journal videos must NOT automatically be:
- Uploaded to Gemini.
- Uploaded to OpenRouter.
- Sent to Ollama.
- Uploaded to NotebookLM.
- Added to RAG.
- Sent to external servers.

Any future AI journal feature requires explicit user consent and clearly states whether processing is local or external.

## Storage

Do not store large videos directly as SQLite BLOBs unless there is a compelling reason.

Preferred:

    SQLite
      └── Journal metadata + secure file reference

    Local private storage
      └── Encrypted video files

Show storage usage, individual file sizes and useful storage warnings.

## Security

Never store the raw password in:
- Plaintext SQLite
- localStorage
- .env
- configuration files
- logs

Use proper local password-derived key/authentication mechanisms.

Where practical, encrypt videos at rest.

Closing the app always locks the journal.

### Auto-lock
Configurable inactivity:
- 5 minutes
- 15 minutes
- 30 minutes
- Never

When locked:
- Videos cannot play.
- Journal cannot be accessed.
- Re-authentication is required.

Use reasonable protection against repeated password attempts.

## Journal management

Support:
- Browse by date.
- Calendar view.
- Search titles/notes.
- Sort newest/oldest.
- Play recordings.
- Rename entries.
- Delete individual entries.
- Delete all journal data.
- Export selected video.
- Export entire journal.

Destructive actions require explicit confirmation.

## Optional future extensions

Keep the architecture extensible for:
- Mood tracking
- Journal streaks
- Text entries
- Photos
- Voice-only entries
- Private timeline
- Searchable transcripts
- AI reflection
- Monthly/yearly summaries
- Private PDF/video archive

All AI analysis must be opt-in.

---

# 9. General Future UX Principles

All enhancements should preserve:
- Local-first behavior where practical.
- Privacy by default.
- No silent cloud uploads.
- Deterministic logic where safer than AI.
- Existing routing/navigation.
- Existing companion state across tabs.
- Existing theme/accent customization.
- Confirmation for destructive operations.
- Progress indicators for long-running operations.
- Clear, recoverable errors.
- Maintainable independent modules.
- No placeholder behavior presented as finished functionality.

---

# 10. Deterministic vs AI Boundary for Future Features

Prefer deterministic processing for:
- Exact document extraction.
- PPTX/PDF conversion.
- PDF rendering.
- Content integrity verification.
- File storage.
- Encryption/authentication.
- Database operations.
- Exam calculations.
- Finance calculations.
- Study-time aggregation.
- Spaced-repetition calculations.

AI may assist with:
- Planner reasoning.
- MCQ/flashcard generation.
- Curriculum interpretation.
- High-yield identification.
- Natural-language recommendations.
- Book Maker design selection.
- Future optional journal reflection with explicit consent.

---

# 11. Recommended Implementation Order

After the core AI/document/learning systems are stable:

1. Reset Saved Data / Reset Demo Data
2. Collapsible Navigation
3. Companion global-shell integration
4. Companion naming/customization
5. Companion collection/unlocking
6. Spotify integration
7. Book Maker
8. Private Video Journal
9. Optional journal/companion extensions

This order is flexible if architecture dependencies require a different sequence.

---

# 12. Completion Standard

A future enhancement is complete only when:
- Data persists correctly.
- Existing functionality remains intact.
- Error cases are handled.
- Security/privacy requirements are implemented.
- Navigation works correctly.
- Themes/custom accent colors work.
- Destructive actions are protected.
- Long-running operations show useful status.
- Local testing is performed.
- Documentation is updated.
- No unfinished placeholder behavior is presented as finished.
