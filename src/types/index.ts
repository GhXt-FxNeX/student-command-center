export type TaskStatus = "not_started" | "in_progress" | "completed" | "skipped";
export type TaskPriority = "low" | "medium" | "high";
export type TaskDifficulty = "easy" | "medium" | "hard";

export interface Course {
  id: number;
  name: string;
  color: string;
  archived: boolean;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  courseId: number | null;
  priority: TaskPriority;
  difficulty: TaskDifficulty;
  estimatedMinutes: number | null;
  deadline: string | null; // ISO 8601
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: TaskStatus;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTask {
  title: string;
  description?: string | null;
  courseId?: number | null;
  priority: TaskPriority;
  difficulty: TaskDifficulty;
  estimatedMinutes?: number | null;
  deadline?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  tags?: string[];
  notes?: string | null;
}

export type ThemeModeSetting = "light" | "dark" | "system";

export type WeekStart =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface UserSettings {
  name: string;
  timezone: string;
  weekStart: WeekStart;
  theme: ThemeModeSetting;
  accentColor: string;
  dashboardLayout: string[]; // ordered widget ids
  currency: string;
  pomodoroWorkMinutes: number;
  pomodoroShortBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  pomodoroSessionsBeforeLongBreak: number;
  pomodoroAutoStart: boolean;
  dailyStudyGoalMinutes: number;
  weeklyStudyGoalMinutes: number;
  monthlyIncomeAmount: number;
  // ---- Phase 6: AI settings (non-secret only — API keys never appear
  // here or anywhere else in the frontend; they live in the OS keychain
  // and are only ever set/checked/deleted by provider name, never read
  // back in raw form) ----
  aiRoutingMode: AiRoutingMode;
  aiManualProvider: AiProviderName;
  aiManualGeminiTier: AiGeminiTier;
  aiGeminiFlashModel: string;
  aiGeminiProModel: string;
  aiOpenrouterModel: string;
  aiLocalBaseUrl: string;
  aiLocalModel: string;
  aiTemperature: number;
  aiMaxOutputTokens: number;
  aiMonthlySpendingLimitUsd: number;
  // ---- Phase 7: reusable AI Planner preferences (day-specific input —
  // commitments text, the date itself — stays ephemeral, passed directly
  // to generate_plan rather than persisted here) ----
  plannerWakeTime: string; // "HH:MM"
  plannerSleepTime: string; // "HH:MM"
  plannerMaxContinuousMinutes: number;
  plannerBreakMinutes: number;
  /** Floating companion bubble diameter in px (48-160). A display
   * preference — doesn't affect the companion's actual art. */
  companionBubbleSizePx: number;
  /** The user's own Spotify app Client ID (Settings > Spotify) — public,
   * not a secret, entered by the user the same way a Gemini/OpenRouter
   * API key is. */
  spotifyClientId: string;
  /** Whether the companion is shown at all (Dashboard card + floating
   * bubble). Hiding it doesn't pause it — the engine keeps processing
   * events in the background. */
  companionEnabled: boolean;
  /** The user's navigation order + hidden tabs (Settings > Appearance >
   * Navigation). Empty means default order with nothing hidden. Don't read
   * this directly to render the nav — go through `resolveNavLayout()` in
   * `app/navItems.ts`, which reconciles it with the current page registry. */
  navLayout: NavItemPref[];
  /** Id of the chosen preset avatar (features/profile/avatars.ts); "" = none
   * chosen yet, in which case the name's initial is shown instead. */
  profileIcon: string;
  /** False on a fresh install and after "Reset saved data": App shows the
   * onboarding screen (pick a name + icon) instead of the app until it is true. */
  onboardingCompleted: boolean;
  /** Max paid-tier Gemini (Pro) requests per month; 0 disables Pro. Only
   * enforced when the spending limit is above $0 (at $0 Pro is blocked
   * outright). A count, not dollars, because Gemini reports no price. */
  aiProMonthlyRequestCap: number;
}

export interface NavItemPref {
  /** Stable slug from the nav registry ("planner"), not a route. */
  id: string;
  hidden: boolean;
}

// ---- Phase 6: AI infrastructure ----

export type AiProviderName = "gemini" | "openrouter";
export type AiRoutingMode = "automatic" | "manual";
export type AiGeminiTier = "flash" | "pro";

export type ProviderStatus = "connected" | "not_configured";

export interface ProviderStatusInfo {
  provider: AiProviderName;
  status: ProviderStatus;
  hasKey: boolean;
}

export interface TestCallResult {
  provider: AiProviderName;
  model: string;
  reason: string;
  responseText: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AiUsageTier = "free" | "paid" | "unknown";

export interface ProviderUsage {
  provider: AiProviderName;
  model: string;
  /** "free" | "paid" — a best-effort label for display grouping only,
   * not a guarantee. Google enforces Gemini's free tier via rate limits,
   * not a flag the client can request, so this can't be a cryptographic
   * promise once billing is enabled on the underlying Google Cloud
   * project — see Settings' AI section for the full caveat. */
  tier: AiUsageTier;
  requestCount: number;
  errorCount: number;
  totalTokens: number;
  /** null when no request in this provider/model's history reported a
   * real cost — shown as "Cost unavailable", never as $0 (never fabricated). */
  estimatedCostUsd: number | null;
}

export interface AiUsageStats {
  monthSpentUsd: number;
  monthlySpendingLimitUsd: number;
  /** Paid-tier Gemini requests this month (failed attempts included) and the cap. */
  proRequestsThisMonth: number;
  proRequestCap: number;
  byProvider: ProviderUsage[];
}

export type CompanionMood =
  | "happy"
  | "excited"
  | "proud"
  | "celebrating"
  | "neutral"
  | "sleepy"
  | "sad"
  | "worried";

export type EvolutionStage =
  | "egg"
  | "baby"
  | "in_training"
  | "rookie"
  | "champion"
  | "ultimate"
  | "mega";

export interface CompanionState {
  /** companion_collection row id — which collection slot is currently
   * active. Use switchActiveCompanion(id) (lib/ipc/companion.ts) to
   * change it, not this field directly. */
  id: number;
  name: string;
  speciesSlug: string;
  currentStage: EvolutionStage;
  xp: number;
  level: number;
  happiness: number; // 0-100
  mood: CompanionMood;
  state: string;
  /** "evolution" | "level_up" | null — which one-shot event is behind a
   * "celebrating" mood right now, so a more specific clip can be shown
   * than the generic "celebration" fallback. Only meaningful when
   * mood === "celebrating". Use clipForCompanionState() (moodClip.ts)
   * rather than reading this directly. */
  celebrationTrigger: "evolution" | "level_up" | null;
  xpForNextLevel: number | null;
}

export interface ClipDef {
  sheet: string;
  frames: number;
  fps: number;
}

export interface SpeciesManifest {
  id: string;
  name: string;
  stages: Record<string, Record<string, ClipDef>>;
  /** "bundled" = served from the frontend's /companions/ static path;
   * "custom" = a Phase 14 Item 4 uploaded pack living in the OS app-data
   * dir, whose ClipDef.sheet is an absolute path resolved via
   * convertFileSrc() instead. See SpriteAnimator.tsx. */
  source: "bundled" | "custom";
  /** When true, SpriteAnimator renders this species with nearest-neighbor
   * scaling (crisp pixel edges) instead of smooth/bilinear scaling — for
   * pixel-art packs, where smooth scaling would blur intentionally sharp
   * pixel boundaries into mush. Smooth scaling (the default, false) suits
   * painted/illustrated art. Set per-pack in manifest.json ("pixelArt"). */
  pixelArt: boolean;
}

export interface AssetManifest {
  species: SpeciesManifest[];
  missingFiles: string[];
}

export interface CustomCompanionPackSummary {
  name: string;
  stages: string[];
  animations: Record<string, string[]>;
  warnings: string[];
  active: boolean;
}

/** One animation found in an uploaded (or already-installed) custom pack,
 * as shown on the editor screen. `fps: null` = inherit the pack's default
 * speed. Frame count isn't stored — it's width / frameWidth. */
export interface CustomPackClipDraft {
  stage: string;
  clip: string;
  /** Relative to the pack root, e.g. "baby/happy.png". */
  file: string;
  /** Absolute path, for the live preview (convertFileSrc). */
  path: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  fps: number | null;
}

/** What the editor screen opens with. The zip itself carries only the
 * animation PNGs; everything else (name, pixel-art, frame size, speeds)
 * lives here and is edited in the app. */
export interface CustomPackDraft {
  /** "new" = a fresh upload waiting in staging; "installed" = the
   * currently installed pack, opened for editing. */
  mode: "new" | "installed";
  name: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  pixelArt: boolean;
  clips: CustomPackClipDraft[];
  warnings: string[];
  ignoredFiles: string[];
}

/** What the editor sends back to save. */
export interface CustomPackEdit {
  name: string;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  pixelArt: boolean;
  clips: { stage: string; clip: string; file: string; fps: number | null }[];
}

/** One collection slot (future_enhancement.md §4). Progress fields are
 * null for a locked companion — its row has real default values in the
 * database (egg/level 1/0xp), but showing them would misleadingly imply
 * progress the person hasn't actually made yet. */
export interface CollectionEntrySummary {
  id: number;
  speciesSlug: string;
  speciesName: string;
  name: string;
  isUnlocked: boolean;
  isActive: boolean;
  currentStage: EvolutionStage | null;
  level: number | null;
  xp: number | null;
  xpForNextLevel: number | null;
  happiness: number | null;
  mood: CompanionMood | null;
}

export type StudySessionType = "pomodoro" | "manual" | "free";

// ---- Phase 14 Item 6: Spotify ----

export interface SpotifyStatus {
  connected: boolean;
  displayName: string | null;
}

export interface SpotifyImage {
  url: string;
}
export interface SpotifyExternalUrls {
  spotify: string;
}
export interface SpotifyArtist {
  name: string;
}
export interface SpotifyPlaylist {
  id: string;
  name: string;
  images: SpotifyImage[];
  tracks: { total: number };
  externalUrls: SpotifyExternalUrls | null;
}
export interface SpotifyAlbum {
  id: string;
  name: string;
  images: SpotifyImage[];
  artists: SpotifyArtist[];
  externalUrls: SpotifyExternalUrls | null;
}
export interface SpotifyShow {
  id: string;
  name: string;
  images: SpotifyImage[];
  publisher: string;
  totalEpisodes: number;
  externalUrls: SpotifyExternalUrls | null;
}
export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  durationMs: number;
  externalUrls: SpotifyExternalUrls | null;
}
export interface SpotifyPlaybackState {
  isPlaying: boolean;
  item: SpotifyTrack | null;
  device: { name: string; volumePercent: number | null } | null;
  progressMs: number | null;
}

// ---- Phase 14 Item 8: Secret Private Video Journal ----

export interface JournalStatus {
  configured: boolean;
  unlocked: boolean;
  autoLockMinutes: number;
  lockedOutForSeconds: number;
}

export interface JournalEntrySummary {
  id: number;
  entryDate: string; // YYYY-MM-DD
  title: string | null;
  durationSeconds: number;
  fileSizeBytes: number;
  createdAt: string;
}

export interface JournalEntryDetail {
  id: number;
  entryDate: string;
  title: string | null;
  note: string | null;
  durationSeconds: number;
  /** Base64 of the decrypted video bytes — build a Blob URL from this for
   * playback, and revoke it when done (see features/journal/EntryViewer.tsx). */
  videoBase64: string;
  /** What MediaRecorder actually produced when this entry was recorded —
   * pass this as the Blob's `type` for playback. A browser picks its
   * decoder from the Blob's type, not the file extension, so using the
   * wrong value here is exactly what made recordings unplayable on
   * WebKit before this field existed (migration 0025). */
  videoMimeType: string;
}

export interface StudySession {
  id: number;
  taskId: number | null;
  courseId: number | null;
  subjectId: number | null;
  startTs: string;
  endTs: string;
  durationSeconds: number;
  sessionType: StudySessionType;
  completed: boolean;
}

export interface NewStudySession {
  taskId?: number | null;
  courseId?: number | null;
  subjectId?: number | null;
  startTs: string;
  endTs: string;
  durationSeconds: number;
  sessionType: StudySessionType;
}

export interface CalendarItem {
  id: string;
  title: string;
  itemType: "task" | "study_session" | "exam" | "schedule_block" | "class";
  start: string;
  end: string | null;
  courseId: number | null;
  completed: boolean;
}

export type StudyStatsRange = "day" | "week" | "month" | "year";

export interface StudyStatsBucket {
  label: string; // "HH" for day buckets, "YYYY-MM-DD" for week/month, "YYYY-MM" for year
  minutes: number;
}

export interface CourseMinutes {
  courseName: string;
  minutes: number;
}

export interface SubjectMinutes {
  subjectName: string;
  minutes: number;
}

export interface StudyStats {
  buckets: StudyStatsBucket[];
  totalMinutes: number;
  averageMinutesPerActiveDay: number;
  currentStreak: number;
  longestStreak: number;
  byCourse: CourseMinutes[];
  bySubject: SubjectMinutes[];
  todayMinutes: number;
  thisWeekMinutes: number;
  dailyGoalMinutes: number;
  weeklyGoalMinutes: number;
}

// ---- Phase 4: Finance ----

export interface FinanceCategory {
  id: number;
  name: string;
  color: string;
  budgetAmount: number | null;
  sortOrder: number;
  archived: boolean;
}

export interface NewFinanceCategory {
  name: string;
  color: string;
  budgetAmount?: number | null;
}

export type TransactionType = "income" | "expense" | "saving";

export interface Transaction {
  id: number;
  categoryId: number | null;
  amount: number;
  type: TransactionType;
  occurredOn: string; // "YYYY-MM-DD"
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTransaction {
  categoryId?: number | null;
  amount: number;
  type: TransactionType;
  occurredOn: string;
  description?: string | null;
}

export interface CategoryBudget {
  categoryId: number;
  categoryName: string;
  color: string;
  budgetAmount: number | null;
  spent: number;
}

export interface FinanceSummary {
  month: string; // "YYYY-MM"
  totalIncome: number;
  totalExpense: number;
  totalSaving: number;
  remainingBalance: number;
  savingsPercent: number | null;
  monthlyIncomeAmount: number;
  byCategory: CategoryBudget[];
}

export interface FinanceMonthBucket {
  month: string; // "YYYY-MM"
  income: number;
  expense: number;
  saving: number;
}

export interface FinanceStats {
  buckets: FinanceMonthBucket[];
  byCategory: CategoryBudget[];
}

// ---- Phase 5: Academic structure (subjects) ----

export interface Subject {
  id: number;
  courseId: number;
  name: string;
  color: string | null;
}

export interface NewSubject {
  courseId: number;
  name: string;
  color?: string | null;
}

// ---- Phase 5: Exams ----

export type ExamStatus = "upcoming" | "awaiting_result" | "completed";

export interface Exam {
  id: number;
  name: string;
  courseId: number | null;
  courseName: string | null;
  subjectId: number | null;
  subjectName: string | null;
  date: string; // "YYYY-MM-DD"
  status: ExamStatus;
  score: number | null;
  maxScore: number | null;
  percentage: number | null; // null unless status === "completed" — never a fabricated 0
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewExam {
  name: string;
  courseId?: number | null;
  subjectId?: number | null;
  date: string;
  /** Only "upcoming" or "awaiting_result" are meaningful to send — the
   * server always promotes to "completed" itself once a valid score and
   * maxScore are both present, regardless of this value. */
  status: ExamStatus;
  score?: number | null;
  maxScore?: number | null;
  notes?: string | null;
}

export interface SubjectAverage {
  subjectId: number;
  subjectName: string;
  averagePercentage: number;
  examCount: number;
}

export interface ExamStats {
  /** Count of exams that actually have a result — NOT total exam rows. */
  completedCount: number;
  overallAverage: number | null;
  highest: Exam | null;
  lowest: Exam | null;
  bySubject: SubjectAverage[];
}

// ---- Phase 7: AI Daily Planner ----

export type ScheduleBlockSource = "ai" | "manual";

/** `startTs`/`endTs` are plain "YYYY-MM-DDTHH:MM:SS" local strings — never
 * parse these with `new Date(startTs)` for anything beyond what
 * lib/date.ts's helpers already do safely; prefer substring extraction
 * (`.slice(0, 10)` for the date, `.slice(11, 16)` for "HH:MM") to display
 * them, matching how Calendar.tsx already reads the date portion. */
export interface ScheduleBlock {
  id: number;
  taskId: number | null;
  taskTitle: string | null;
  courseId: number | null;
  courseName: string | null;
  subjectId: number | null;
  title: string;
  startTs: string;
  endTs: string;
  source: ScheduleBlockSource;
  locked: boolean;
  completed: boolean;
  /** Only ever set for AI-generated blocks — never fabricated for manual ones. */
  aiReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewScheduleBlock {
  taskId?: number | null;
  courseId?: number | null;
  subjectId?: number | null;
  title: string;
  startTs: string;
  endTs: string;
  locked: boolean;
}

export interface PlanRequest {
  date: string; // "YYYY-MM-DD"
  wakeTime: string; // "HH:MM"
  sleepTime: string;
  maxContinuousMinutes: number;
  breakMinutes: number;
  commitmentsText: string;
}

export interface PlanResult {
  blocks: ScheduleBlock[];
  /** Set when the deterministic capacity check found more requested task
   * time than available window time — computed server-side, never an AI
   * guess. */
  capacityWarning: string | null;
  provider: AiProviderName;
  model: string;
}

// ---- Phase 14: Data Management (Reset Saved Data / Reset Demo Data) ----

export interface TableResetCount {
  table: string;
  rowsDeleted: number;
}

export interface ResetSummary {
  deleted: TableResetCount[];
  settingsReset: boolean;
  /** Absolute path to a pre-reset backup of the database file — null for
   * reset_demo_data and generate_demo_data, which don't back up (a
   * scoped is_demo-only operation is lower-risk than a full reset). */
  backupPath: string | null;
}

// ---- Phase 14: Courses tab — recurring weekly class schedule ----

export type WeekdayName =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const WEEKDAY_ORDER: WeekdayName[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const WEEKDAY_LABELS: Record<WeekdayName, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export interface SubjectScheduleEntry {
  id: number;
  subjectId: number;
  dayOfWeek: WeekdayName;
  startTime: string; // "HH:MM"
  endTime: string | null;
}

// ---- Backup & restore (commands/backup.rs) ----

export interface BackupManifest {
  format: number;
  appVersion: string;
  schemaVersion: number;
  /** UTC, "YYYY-MM-DD HH:MM:SS". */
  createdAt: string;
  includesJournalVideos: boolean;
  journalVideoCount: number;
}

export interface BackupSizeEstimate {
  /** Upper bounds: the database compresses inside the file, so real files are usually smaller. */
  withoutVideosBytes: number;
  withVideosBytes: number;
  /** Journal videos that exist on disk; 0 means the journal option should not be shown at all. */
  journalVideoCount: number;
}

export interface BackupExportResult {
  path: string;
  bytes: number;
  includedJournalVideos: boolean;
  journalVideoCount: number;
}

export interface BackupInfo {
  manifest: BackupManifest;
  fileBytes: number;
  videosInFile: number;
}

export interface BackupImportResult {
  safetyBackupPath: string;
  oldJournalVideosKeptAt: string | null;
}
