import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToggleField } from "@/components/ui/Toggle";
import { saveCustomCompanionPack } from "@/lib/ipc/companion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { SpriteAnimator } from "./SpriteAnimator";
import { FieldMessage } from "@/components/ui/Callout";
import type {
  AssetManifest,
  CustomCompanionPackSummary,
  CustomPackClipDraft,
  CustomPackDraft,
} from "@/types";

interface ClipRow extends CustomPackClipDraft {
  included: boolean;
}

function clipKey(c: { stage: string; clip: string }) {
  return `${c.stage}/${c.clip}`;
}

function stageLabel(stage: string) {
  return stage.replace("_", "-");
}

/** A sheet fits when its height is exactly one frame tall and its width is
 * a whole number of frames — the same rule the backend enforces on save,
 * checked live here so mistakes show up as the person types. */
function fit(c: CustomPackClipDraft, frameWidth: number, frameHeight: number) {
  const ok = frameWidth > 0 && frameHeight > 0 && c.height === frameHeight && c.width % frameWidth === 0;
  return { ok, frames: ok ? c.width / frameWidth : 0 };
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  min = 1,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-text-secondary mb-1">{label}</span>
      <span className="flex items-center gap-1.5">
        <Input
          type="number"
          min={min}
          max={max}
          className="w-full"
          value={value || ""}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="text-xs text-text-secondary shrink-0">{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * The screen shown after choosing a companion zip (and again from "Edit
 * details" on an installed pack). The zip carries only animation PNGs —
 * every detail that used to live in a hand-written manifest.json (name,
 * pixel-art, frame size, speeds, which animations to keep) is set here
 * instead, with a live preview so the result is visible before anything
 * is installed.
 */
export function CustomPackEditor({
  draft,
  onSaved,
  onCancel,
}: {
  draft: CustomPackDraft;
  onSaved: (summary: CustomCompanionPackSummary) => void;
  onCancel: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [name, setName] = useState(draft.name);
  const [pixelArt, setPixelArt] = useState(draft.pixelArt);
  const [frameWidth, setFrameWidth] = useState(draft.frameWidth);
  const [frameHeight, setFrameHeight] = useState(draft.frameHeight);
  const [frameRate, setFrameRate] = useState(draft.frameRate);
  const [rows, setRows] = useState<ClipRow[]>(() => draft.clips.map((c) => ({ ...c, included: true })));
  const [previewKey, setPreviewKey] = useState<string>(() => (draft.clips[0] ? clipKey(draft.clips[0]) : ""));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isNew = draft.mode === "new";
  const stages = useMemo(() => Array.from(new Set(rows.map((r) => r.stage))), [rows]);

  // ---- live validation (mirrors the backend's rules) ----
  const blockers: string[] = [];
  if (!name.trim()) blockers.push("Give the companion a name.");
  else if (name.trim().length > 60) blockers.push("The name is too long (60 characters max).");
  if (!(frameWidth >= 1 && frameWidth <= 2048) || !(frameHeight >= 1 && frameHeight <= 2048)) {
    blockers.push("Frame width and height must each be between 1 and 2048.");
  }
  if (!(frameRate > 0)) blockers.push("Default speed must be more than 0 frames per second.");
  const badClips = rows.filter((r) => r.included && !fit(r, frameWidth, frameHeight).ok);
  if (badClips.length > 0) {
    blockers.push(
      `${badClips.length} animation${badClips.length === 1 ? " doesn't" : "s don't"} fit the frame size — adjust it above, or remove them.`,
    );
  }
  for (const stage of stages) {
    const idle = rows.find((r) => r.stage === stage && r.clip === "idle" && r.included);
    if (!idle) blockers.push(`"${stageLabel(stage)}" needs its idle animation.`);
  }
  const nonSquare = frameWidth !== frameHeight && frameWidth > 0 && frameHeight > 0;

  // ---- live preview: a throwaway manifest for just the selected clip ----
  const previewRow = rows.find((r) => clipKey(r) === previewKey) ?? null;
  const previewFit = previewRow ? fit(previewRow, frameWidth, frameHeight) : null;
  const previewManifest: AssetManifest | null = useMemo(() => {
    if (!previewRow || !previewFit?.ok) return null;
    return {
      missingFiles: [],
      species: [
        {
          id: "draft",
          name,
          source: "custom",
          pixelArt,
          stages: {
            [previewRow.stage]: {
              [previewRow.clip]: {
                sheet: previewRow.path,
                frames: previewFit.frames,
                fps: previewRow.fps ?? (frameRate > 0 ? frameRate : 6),
              },
            },
          },
        },
      ],
    };
  }, [previewRow, previewFit?.ok, previewFit?.frames, name, pixelArt, frameRate]);

  function updateRow(key: string, patch: Partial<ClipRow>) {
    setRows((rs) => rs.map((r) => (clipKey(r) === key ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const summary = await saveCustomCompanionPack(draft.mode, {
        name,
        frameWidth,
        frameHeight,
        frameRate,
        pixelArt,
        clips: rows
          .filter((r) => r.included)
          .map((r) => ({ stage: r.stage, clip: r.clip, file: r.file, fps: r.fps })),
      });
      onSaved(summary);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  /** One animation row: name, dimensions, fit/frame-count, an optional
   * per-clip speed override, and Remove/Restore for anything but idle.
   * Pulled out to a function (not a separate component) since it closes
   * over quite a bit of this component's own state — frameWidth/Height
   * and frameRate feed `fit()`, previewKey/setPreviewKey drive selection. */
  function renderClipRow(r: ClipRow) {
    const key = clipKey(r);
    const f = fit(r, frameWidth, frameHeight);
    const selected = key === previewKey;
    return (
      <div
        key={key}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
          selected ? "bg-accent-soft" : "hover:bg-bg"
        } ${r.included ? "" : "opacity-50"}`}
      >
        <button
          type="button"
          onClick={() => setPreviewKey(key)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text rounded"
        >
          <span className={`font-medium ${r.included ? "" : "line-through"}`}>{r.clip}</span>
          <span className="text-xs text-text-secondary tabular-nums">
            {r.width}×{r.height}
          </span>
          {f.ok ? (
            <span className="text-xs text-text-secondary">
              {f.frames} frame{f.frames === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-xs text-red-700 dark:text-red-400">doesn't fit frame size</span>
          )}
          {!r.hasAlpha && <span className="text-xs text-amber-700 dark:text-amber-400">no transparency</span>}
        </button>
        {f.frames > 1 && r.included && (
          <Input
            type="number"
            min={1}
            max={60}
            size="sm"
            className="w-16"
            aria-label={`${r.clip} speed in frames per second`}
            placeholder={String(frameRate || "")}
            value={r.fps ?? ""}
            onChange={(e) => updateRow(key, { fps: e.target.value ? Number(e.target.value) : null })}
          />
        )}
        {r.clip !== "idle" && (
          <button
            type="button"
            onClick={() => updateRow(key, { included: !r.included })}
            className="text-xs text-text-secondary hover:text-text hover:underline transition-colors shrink-0"
          >
            {r.included ? "Remove" : "Restore"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-slide-in">
      <div>
        <p className="font-medium text-sm">{isNew ? "Set up your companion" : "Edit companion details"}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {isNew
            ? `Found ${rows.length} animation${rows.length === 1 ? "" : "s"} across ${stages.length} stage${stages.length === 1 ? "" : "s"}. Check the details below — nothing is installed until you confirm.`
            : "Change how your custom companion is named and drawn. The sprite files themselves stay as they are."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-5">
        <div className="space-y-4 min-w-0">
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Pack name</span>
            <Input className="w-full" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>

          <ToggleField
            checked={pixelArt}
            onChange={setPixelArt}
            label="Pixel art"
            description="Keeps sharp, blocky edges when scaled. Leave off for painted or smooth art."
          />

          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Frame width" value={frameWidth} onChange={setFrameWidth} suffix="px" max={2048} />
            <NumberField label="Frame height" value={frameHeight} onChange={setFrameHeight} suffix="px" max={2048} />
            <NumberField label="Default speed" value={frameRate} onChange={setFrameRate} suffix="fps" max={60} />
          </div>
          {nonSquare && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Frames aren't square. The companion is drawn in a square box today, so non-square art will look
              stretched.
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="w-32 h-32 rounded-card border border-border bg-bg flex items-center justify-center">
            {previewManifest && previewRow ? (
              <SpriteAnimator
                manifest={previewManifest}
                speciesId="draft"
                stage={previewRow.stage}
                clip={previewRow.clip}
                size={112}
                devMode={false}
                reducedMotion={reducedMotion}
              />
            ) : (
              <span className="text-xs text-text-secondary text-center px-3">
                {previewRow ? "Doesn't fit the frame size" : "Pick an animation"}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-secondary">
            {previewRow ? `${stageLabel(previewRow.stage)} · ${previewRow.clip}` : "Preview"}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs text-text-secondary mb-2">
          Animations — click one to preview it. Speed is optional; blank uses the default.
        </p>
        <div className="rounded-card border border-border overflow-hidden divide-y divide-border">
          {stages.map((stage) => {
            const stageRows = rows.filter((r) => r.stage === stage);
            const idleRow = stageRows.find((r) => r.clip === "idle");
            // These three are grouped and explained on purpose: "celebration"
            // is what shows for any celebrating moment, but a level-up or an
            // evolution asks for the more specific "level_up"/"evolution"
            // name first (moodClip.ts) and only falls back to "celebration"
            // (then "idle") if that stage doesn't have one. Nothing else in
            // this list has that kind of relationship to another animation.
            const celebrationNames = ["celebration", "level_up", "evolution"];
            const celebrationRows = celebrationNames
              .map((name) => stageRows.find((r) => r.clip === name))
              .filter((r): r is ClipRow => !!r);
            const otherRows = stageRows.filter(
              (r) => r.clip !== "idle" && !celebrationNames.includes(r.clip),
            );

            return (
              <div key={stage}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary bg-bg px-3 py-1.5">
                  {stageLabel(stage)}
                </p>
                {idleRow && renderClipRow(idleRow)}

                {celebrationRows.length > 0 && (
                  <>
                    <p className="text-[11px] text-text-secondary bg-bg px-3 py-1">
                      Celebration — shown on level-up/evolution. "level_up" and "evolution" are optional and more
                      specific than plain "celebration"; either falls back to celebration (then idle) if you don't
                      provide it.
                    </p>
                    {celebrationRows.map(renderClipRow)}
                  </>
                )}

                {otherRows.map(renderClipRow)}
              </div>
            );
          })}
        </div>
      </div>

      {(draft.warnings.length > 0 || draft.ignoredFiles.length > 0) && (
        <details className="text-xs text-text-secondary">
          <summary className="cursor-pointer hover:text-text transition-colors">
            {draft.warnings.length + draft.ignoredFiles.length} note
            {draft.warnings.length + draft.ignoredFiles.length === 1 ? "" : "s"} about the zip
          </summary>
          <ul className="list-disc list-inside space-y-0.5 mt-2">
            {draft.warnings.map((w, i) => (
              <li key={`w${i}`}>{w}</li>
            ))}
            {draft.ignoredFiles.map((f, i) => (
              <li key={`i${i}`}>Ignored: {f}</li>
            ))}
          </ul>
        </details>
      )}

      {blockers.length > 0 && (
        <ul className="text-xs text-red-700 dark:text-red-400 list-disc list-inside space-y-0.5">
          {blockers.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {saveError && <FieldMessage className="whitespace-pre-line">{saveError}</FieldMessage>}

      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSave} disabled={saving || blockers.length > 0}>
          {saving ? "Saving…" : isNew ? "Install pack" : "Save changes"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
