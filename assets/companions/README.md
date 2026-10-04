# Companion assets — Phase 1B status

All sprites here are **original, first-party placeholder art** (flat-color circles), not final creature designs and not anything scraped from Digimon or any other copyrighted source. Replace them with real art at any time — nothing in the engine or components hardcodes these files; everything is driven by `manifest.json`.

Currently present:
- `idle` clip for all 7 stages (egg → mega), single frame each
- `happy` clip for `baby` only, as the one multi-frame (4-frame) example so the animator's frame-stepping path is exercised

**Intentionally missing**: `manifest.json` references `sparkling/mega/celebration/sheet.png`, which does not exist on disk. This is deliberate — it's the test case for the missing-asset handling required by the spec (architecture.md A5): Rust's manifest loader detects and reports it (`AssetManifest.missing_files`), and the frontend's `SpriteAnimator` falls back to that stage's `idle` clip with a dev-mode warning rather than rendering blank. Don't "fix" this by deleting the reference — add the actual file instead when real art exists, which will make the missing-file warning go away naturally.

## Phase 14 Item 4 — temporary dragon test asset

`sparkling/_devtest_dragon/sheet.png` is a single 256×256 static frame, processed from the reference art you supplied for testing the new global-shell `FloatingCompanion`: the source file had a checkerboard "transparency indicator" baked into its pixels (a JPG export of what was originally a transparent PNG), so it wasn't usable as-is. It was cleaned up with an OpenCV flood-fill from the border (grayscale, brightness-banded, connected-component) to rebuild a real alpha channel, inpainted to remove the resulting edge fringe, then cropped and padded to a square canvas.

Every stage's `idle` clip currently points at this one shared file, so the global companion shows real art regardless of the seeded companion's current stage/level while you verify the Phase 14 Item 4 rendering pipeline (positioning, theming, reduced-motion, popover). It's intentionally *not* per-stage or per-mood art — it's one static frame reused everywhere, purely to prove the pipeline works with something other than the flat-color placeholder circles.

The original 7 circle placeholder files are untouched on disk (`egg/idle`, `baby/idle`, `in_training/idle`, `rookie/idle`, `champion/idle`, `ultimate/idle`, `mega/idle` — all still present, just unreferenced by `manifest.json` right now), so reverting to them is a one-line-per-stage edit in `manifest.json`, not a re-upload. Swap in real per-stage/per-mood art (or keep the dragon and draw the rest of the set around it) whenever you're ready — same "manifest.json + files, zero component code changes" story as before.

Also worth knowing if you didn't intend this: since the checkerboard was baked into a JPG rather than real transparency, there's no way to perfectly recover the original alpha at the pixel level — the flood-fill result is a good approximation (clean silhouette, defringed edges) but isn't pixel-identical to a true alpha channel. For any future companion art, export PNG with real transparency directly rather than a flattened JPG.

## Phase 14 Item 4 — custom companion pack format

Settings → Companion → "Upload a pack…" takes a `.zip` that contains **only the animations** — there is no `manifest.json` to write. Everything a manifest used to hold is set on a screen in the app right after you choose the zip.

```
my-pack.zip
├── egg/idle.png
├── baby/idle.png
├── baby/happy.png
├── in_training/idle.png
├── rookie/idle.png
├── champion/idle.png
├── ultimate/idle.png
└── mega/idle.png
```

(Zipping the *contents* of a folder or zipping the folder itself both work — the installer looks for the stage folders at the zip's root, and falls back to checking one level inside a single enclosing folder, since that's what most "compress this folder" tools produce.)

### How the zip is read

- The folder name is the **stage** and must be one of the 7 names above (`egg`, `baby`, `in_training`, `rookie`, `champion`, `ultimate`, `mega`) — they're hardcoded into the database's `CHECK` constraints (migrations/0003_companion.sql), so a pack can't introduce new stages, only supply art for the existing ones.
- The file name (without `.png`) is the **animation**. Every stage needs at least `idle.png`; it's the last-resort fallback for any name the pack doesn't cover. Everything else is optional — the animations the mood engine reaches for on its own are `happy`, `proud`, `excited`, `sleep`, `worried`, `sad`, `celebration`, plus two one-shot clips, `evolution` and `level_up`, requested in place of `celebration` for that specific moment (see `moodClip.ts`'s `clipForCompanionState()`). The fallback chain for those two is `evolution`/`level_up` → `celebration` → `idle`: skip `evolution.png` and an evolution just plays your `celebration.png` (if you have one) instead, not `idle.png` — you only need the more specific files if you want evolving and leveling up to look different from an ordinary celebration. Any other name is accepted too and simply becomes a playable clip. File names may use letters, numbers, `-` and `_`, and are lower-cased.
- Each PNG is a horizontal sprite-sheet strip: its height is one frame tall and its width is a whole number of frames. A single-frame ("static") animation is just one frame-sized image.
- Only PNG is accepted. The installer reads just the IHDR header (no image-decoding dependency) to get dimensions and color type — it does **not** inspect actual pixel alpha values, so a format that supports transparency (RGBA, grayscale+alpha, palette) is fine even if you never used any transparent pixels. A format with no alpha channel at all (plain RGB) gets a non-fatal warning, not a rejection.
- Anything else in the zip (a stray `manifest.json` from the old format, other files, unknown folders) is ignored, and listed on the next screen so nothing disappears silently.
- A zip missing any stage's `idle.png` is rejected up front, with every missing stage listed at once.

### The details screen

After choosing a zip, the app scans it, guesses sensible defaults, and shows an editor **before installing anything**:

- **Pack name** — defaults to the zip's file name.
- **Pixel art** — nearest-neighbor (crisp, blocky) scaling instead of smooth scaling. Turn it on for pixel art; leave it off for painted/illustrated art.
- **Frame width / height** — guessed from the sheets (the most common sheet height is the frame height; frames are assumed square unless the widths say otherwise). Each animation shows its frame count, or "doesn't fit frame size" if its height isn't exactly one frame or its width isn't a whole number of frames. The companion is currently drawn in a square box, so non-square frames are allowed but will look stretched (the screen warns you).
- **Default speed** (frames per second) and an optional **per-animation speed** for multi-frame animations.
- **Remove / Restore** any non-idle animation you don't want included.
- A **live preview** of whichever animation you click, using the pixel-art and speed settings as you change them.
- `celebration`, `evolution` and `level_up` (if present) are grouped together under each stage with a short explanation, instead of sitting alphabetically among the mood animations — they're the one set of clips with a fallback relationship to each other (see above), so they're shown that way rather than as three unrelated rows.

Nothing is installed until you press **Install pack**. Cancel discards the upload.

### Editing later

With a custom pack installed, **Edit details…** reopens the same screen for it — rename it, flip pixel art, change frame size or speeds — without re-uploading. The sprite files themselves aren't touched. (The installed pack keeps its details in `manifest.internal.json` plus `pack.meta.json` for the frame size/default speed, under `{app_data_dir}/companion_packs/custom/`; while you're in the details screen for a fresh upload, the extracted files wait in `companion_packs/_staging/`, inside the same asset-protocol scope so the preview can load them.)

### Deleting a pack

**Delete pack**, next to Edit details, removes the installed pack for good — the species entry, its files on disk, everything. This used to be the only gap: the sole way to get rid of one was uploading a *different* pack, which replaces the old one as a side effect of installing; there was no way to just remove one and land back on a built-in companion. If the custom pack happens to be the active one when you delete it, the active companion switches back to the default Sparkling first, same as pressing "Revert to default companion" — your companion's name/level/XP/happiness are a property of the *collection slot*, not the species, so none of that is lost either way; only the art changes.

Installing a pack does **not** switch your active companion's appearance — that's the separate "Use this companion" step, so you can review the result first. "Revert to default companion" switches back to the built-in Sparkling art at any time; your companion's name, level, XP, and happiness are untouched by either switch — only the art changes. Only one custom pack slot exists right now — installing a new pack replaces whatever was installed before. Multiple named custom companions is item 5 (Companion Collection)'s job, not this one's.
