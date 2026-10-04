use super::assets::{ClipDef, RawSpecies};
use super::persistence;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The app only understands these 7 stage names (they're hardcoded into the
/// `companion`/`companion_evolution_stages` CHECK constraints — see
/// migrations/0003_companion.sql). A custom pack can't introduce new
/// stages, only supply art for the existing ones.
const CANONICAL_STAGES: [&str; 7] = [
    "egg",
    "baby",
    "in_training",
    "rookie",
    "champion",
    "ultimate",
    "mega",
];

/// Every stage must at minimum provide this animation — it's the fallback
/// SpriteAnimator uses for any mood/clip the pack doesn't cover (mirrors
/// the built-in Sparkling pack's own "idle-is-the-floor" convention).
const REQUIRED_ANIMATION: &str = "idle";

const DEFAULT_FRAME_RATE: i64 = 6;

// ---- Where things live on disk ------------------------------------------
//
// `_staging` sits inside `companion_packs/` (not the OS temp dir, as the
// old manifest-in-zip flow used) on purpose: Tauri's asset protocol scope
// is `$APPDATA/companion_packs/**` (tauri.conf.json), so the not-yet-
// installed sprites can be previewed live in the editor screen via
// `convertFileSrc()`. `assets::load_all_custom_species` only loads
// subfolders that contain a `manifest.internal.json`, and `_staging`
// never does, so it's invisible to the rest of the app.

fn packs_dir() -> PathBuf {
    crate::db::app_data_dir().join("companion_packs")
}
fn install_dir() -> PathBuf {
    packs_dir().join("custom")
}
/// Where the installed custom companion's files live (used by backup & restore).
pub fn install_dir_path() -> PathBuf {
    install_dir()
}
fn staging_dir() -> PathBuf {
    packs_dir().join("_staging")
}

// ---- Wire types ---------------------------------------------------------
//
// The zip no longer carries a manifest.json. Instead, `inspect_zip` scans
// the animations, guesses sensible defaults, and hands the frontend a
// `PackDraft` to show on an editor screen; whatever the person confirms or
// changes comes back as a `PackEdit`, and only then is anything installed.
// The same two shapes also drive "edit details" for an already-installed
// pack, so the manifest is editable from the app for good, not just once.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDraft {
    pub stage: String,
    pub clip: String,
    /// Path relative to the pack root, e.g. "baby/happy.png".
    pub file: String,
    /// Absolute path, for the editor's live preview (convertFileSrc).
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub has_alpha: bool,
    /// None = inherit the pack's default frame rate.
    pub fps: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDraft {
    /// "new" (freshly uploaded, sitting in staging) or "installed" (the
    /// currently installed pack, opened for editing).
    pub mode: String,
    pub name: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub frame_rate: i64,
    pub pixel_art: bool,
    pub clips: Vec<ClipDraft>,
    pub warnings: Vec<String>,
    pub ignored_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEdit {
    pub stage: String,
    pub clip: String,
    pub file: String,
    pub fps: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackEdit {
    pub name: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub frame_rate: i64,
    pub pixel_art: bool,
    pub clips: Vec<ClipEdit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPackSummary {
    pub name: String,
    pub stages: Vec<String>,
    pub animations: HashMap<String, Vec<String>>,
    pub warnings: Vec<String>,
    pub active: bool,
}

/// Frame geometry + default speed, saved next to `manifest.internal.json`
/// (which only stores per-clip resolved frame counts/fps) so "edit details"
/// can show and change them later.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackMeta {
    frame_width: u32,
    frame_height: u32,
    frame_rate: i64,
}

// ---- Scanning an uploaded zip -------------------------------------------

fn stage_rank(stage: &str) -> usize {
    CANONICAL_STAGES
        .iter()
        .position(|s| *s == stage)
        .unwrap_or(usize::MAX)
}

fn sort_clips(clips: &mut [ClipDraft]) {
    clips.sort_by(|a, b| {
        stage_rank(&a.stage)
            .cmp(&stage_rank(&b.stage))
            .then_with(|| (a.clip != REQUIRED_ANIMATION).cmp(&(b.clip != REQUIRED_ANIMATION)))
            .then_with(|| a.clip.cmp(&b.clip))
    });
}

fn has_stage_dir(dir: &Path) -> bool {
    CANONICAL_STAGES.iter().any(|s| dir.join(s).is_dir())
}

/// Accepts either a zip whose stage folders are already at the top level
/// or one where everything is nested one level inside a single enclosing
/// folder — the latter is what most "zip this folder" workflows (Finder,
/// Explorer, 7-Zip) produce, and rejecting it would be a needlessly sharp
/// edge for a solo user packaging their own art.
fn find_pack_root(staging: &Path) -> Result<PathBuf, String> {
    if has_stage_dir(staging) {
        return Ok(staging.to_path_buf());
    }
    let entries = fs::read_dir(staging)
        .map_err(|e| format!("could not read extracted pack contents: {e}"))?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && has_stage_dir(&path) {
            candidates.push(path);
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err(
            "no animation folders found — the zip should contain folders named after the \
             evolution stages (egg, baby, in_training, rookie, champion, ultimate, mega), \
             each holding PNG sprite sheets such as idle.png."
                .to_string(),
        ),
        _ => Err(
            "found more than one pack folder in the zip — zip a single pack's contents, \
             not several packs together."
                .to_string(),
        ),
    }
}

/// Reads `<stage>/<clip>.png` files out of a pack root. Returns the clips
/// found, per-file problems (skipped files), and files that were ignored
/// because the app doesn't use them (shown to the person, never silently
/// dropped).
fn scan_clips(pack_root: &Path) -> (Vec<ClipDraft>, Vec<String>, Vec<String>) {
    let mut clips = Vec::new();
    let mut warnings = Vec::new();
    let mut ignored = Vec::new();

    if let Ok(entries) = fs::read_dir(pack_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !CANONICAL_STAGES.contains(&name.as_str()) {
                    ignored.push(format!("{name}/ (not one of the 7 stage folders)"));
                }
            } else if name.eq_ignore_ascii_case("manifest.json") {
                ignored.push(
                    "manifest.json (no longer needed — those details are set in the app)"
                        .to_string(),
                );
            } else {
                ignored.push(name);
            }
        }
    }

    for stage in CANONICAL_STAGES {
        let stage_dir = pack_root.join(stage);
        let Ok(entries) = fs::read_dir(&stage_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                ignored.push(format!("{stage}/{file_name}/ (nested folders aren't used)"));
                continue;
            }
            let is_png = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("png"))
                .unwrap_or(false);
            if !is_png {
                ignored.push(format!("{stage}/{file_name}"));
                continue;
            }
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if stem.is_empty()
                || !stem
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                warnings.push(format!(
                    "{stage}/{file_name}: file names may only use letters, numbers, - and _ — skipped."
                ));
                continue;
            }
            match read_png_info(&path) {
                Ok(info) => clips.push(ClipDraft {
                    stage: stage.to_string(),
                    clip: stem,
                    file: format!("{stage}/{file_name}"),
                    path: path.to_string_lossy().to_string(),
                    width: info.width,
                    height: info.height,
                    has_alpha: info.has_alpha,
                    fps: None,
                }),
                Err(e) => warnings.push(format!("{stage}/{file_name}: {e} — skipped.")),
            }
        }
    }

    sort_clips(&mut clips);
    ignored.sort();
    (clips, warnings, ignored)
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// Best guess at the frame size from the sheets alone: the most common
/// sheet height is the frame height; frames are assumed square unless the
/// widths say otherwise. Only a starting point — the editor screen lets
/// the person correct it, and shows immediately whether every sheet fits.
fn infer_frame_size(clips: &[ClipDraft]) -> (u32, u32) {
    if clips.is_empty() {
        return (256, 256);
    }
    let mut counts: BTreeMap<u32, usize> = BTreeMap::new();
    for c in clips {
        *counts.entry(c.height).or_insert(0) += 1;
    }
    let mut best_h = 0u32;
    let mut best_n = 0usize;
    for (h, n) in &counts {
        if *n > best_n {
            best_h = *h;
            best_n = *n;
        }
    }
    if best_h == 0 {
        return (256, 256);
    }
    let widths: Vec<u32> = clips
        .iter()
        .filter(|c| c.height == best_h)
        .map(|c| c.width)
        .collect();
    if widths.iter().all(|w| w % best_h == 0) {
        return (best_h, best_h);
    }
    let g = widths.iter().fold(0u32, |acc, w| gcd(acc, *w));
    let min_w = widths.iter().copied().min().unwrap_or(best_h);
    (if g >= 16 { g } else { min_w }, best_h)
}

fn suggest_name(zip_path: &str) -> String {
    let stem = Path::new(zip_path)
        .file_stem()
        .map(|s| s.to_string_lossy().replace(|c: char| c == '_' || c == '-', " "))
        .unwrap_or_default();
    let trimmed: String = stem.trim().chars().take(60).collect();
    if trimmed.is_empty() {
        "Custom companion".to_string()
    } else {
        trimmed
    }
}

/// Step 1 of installing a pack: extracts the zip into staging, scans it,
/// and returns a draft for the editor screen. Installs nothing — a pack
/// only becomes the installed pack once `save_pack` is called with the
/// person's confirmed details. Uploading again replaces whatever draft was
/// already sitting in staging.
pub fn inspect_zip(zip_path: &str) -> Result<PackDraft, String> {
    let staging = staging_dir();
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("could not create staging dir: {e}"))?;

    let fail = |msg: String| -> Result<PackDraft, String> {
        let _ = fs::remove_dir_all(staging_dir());
        Err(msg)
    };

    if let Err(e) = extract_zip(zip_path, &staging) {
        return fail(e);
    }
    let pack_root = match find_pack_root(&staging) {
        Ok(r) => r,
        Err(e) => return fail(e),
    };

    let (clips, warnings, ignored_files) = scan_clips(&pack_root);
    if clips.is_empty() {
        return fail(
            "no usable PNG animations were found in the zip — put each sheet at \
             <stage>/<animation>.png, for example egg/idle.png."
                .to_string(),
        );
    }

    // Every stage needs an idle clip to be installable. The editor can't
    // add files, so a pack missing one is rejected up front (all missing
    // stages listed together) rather than after the person has filled in
    // the whole screen.
    let missing: Vec<String> = CANONICAL_STAGES
        .iter()
        .filter(|stage| {
            !clips
                .iter()
                .any(|c| c.stage == **stage && c.clip == REQUIRED_ANIMATION)
        })
        .map(|stage| format!("\"{stage}\" is missing the required idle animation ({stage}/idle.png)."))
        .collect();
    if !missing.is_empty() {
        return fail(missing.join("\n"));
    }

    let (frame_width, frame_height) = infer_frame_size(&clips);
    Ok(PackDraft {
        mode: "new".to_string(),
        name: suggest_name(zip_path),
        frame_width,
        frame_height,
        frame_rate: DEFAULT_FRAME_RATE,
        pixel_art: false,
        clips,
        warnings,
        ignored_files,
    })
}

/// Throws away an un-installed draft (the person hit Cancel).
pub fn discard_draft() {
    let _ = fs::remove_dir_all(staging_dir());
}

/// Opens the currently installed pack as a draft, so its details can be
/// edited without re-uploading. Older installs (from before this flow)
/// have no saved frame geometry, so it's re-inferred from the sheets.
pub fn get_installed_draft(conn: &Connection) -> Result<Option<PackDraft>, String> {
    let install = install_dir();
    let manifest_path = install.join("manifest.internal.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let Some(species_id) = persistence::species_id_by_slug(conn, "custom")? else {
        return Ok(None);
    };
    let raw_text = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("could not read the installed pack's manifest: {e}"))?;
    let raw: RawSpecies = serde_json::from_str(&raw_text)
        .map_err(|e| format!("installed pack manifest is invalid: {e}"))?;

    let mut warnings = Vec::new();
    let mut clips = Vec::new();
    for (stage, raw_stage) in &raw.stages {
        for (clip, def) in &raw_stage.clips {
            let path = install.join(&def.sheet);
            match read_png_info(&path) {
                Ok(info) => clips.push(ClipDraft {
                    stage: stage.clone(),
                    clip: clip.clone(),
                    file: def.sheet.clone(),
                    path: path.to_string_lossy().to_string(),
                    width: info.width,
                    height: info.height,
                    has_alpha: info.has_alpha,
                    fps: Some(def.fps),
                }),
                Err(e) => warnings.push(format!("{stage}/{clip}: {e}")),
            }
        }
    }
    sort_clips(&mut clips);

    let meta: Option<PackMeta> = fs::read_to_string(install.join("pack.meta.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());
    let (frame_width, frame_height, frame_rate) = match meta {
        Some(m) => (m.frame_width, m.frame_height, m.frame_rate),
        None => {
            let (w, h) = infer_frame_size(&clips);
            (w, h, DEFAULT_FRAME_RATE)
        }
    };
    // A clip running at exactly the default speed is shown as "inherit",
    // so changing the pack's default speed still moves it.
    for c in clips.iter_mut() {
        if c.fps == Some(frame_rate) {
            c.fps = None;
        }
    }

    Ok(Some(PackDraft {
        mode: "installed".to_string(),
        name: persistence::species_display_name(conn, species_id)?,
        frame_width,
        frame_height,
        frame_rate,
        pixel_art: raw.pixel_art,
        clips,
        warnings,
        ignored_files: Vec::new(),
    }))
}

// ---- Validating + saving the person's confirmed details ------------------

struct ValidClip {
    stage: String,
    clip: String,
    /// Where the file is right now (staging or the install dir).
    src: PathBuf,
    /// The path recorded in the installed manifest, relative to the
    /// install dir.
    sheet: String,
    frames: i64,
    fps: Option<i64>,
}

fn valid_clip_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Only plain relative paths (no "..", no absolute roots) — the file
/// names come back from the frontend, so they're re-checked here instead
/// of trusted.
fn safe_rel(file: &str) -> Option<PathBuf> {
    let p = Path::new(file);
    if file.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(p.to_path_buf())
}

/// Everything that can go wrong is collected into one list rather than
/// stopping at the first problem, per future_enhancement.md §3's "reject
/// incomplete/invalid asset packs with a useful error" — a pack with five
/// mistakes should report five mistakes in one pass, not five re-saves.
fn validate_edit(src_root: &Path, edit: &PackEdit) -> Result<(Vec<ValidClip>, Vec<String>), Vec<String>> {
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut out: Vec<ValidClip> = Vec::new();

    let name = edit.name.trim();
    if name.is_empty() {
        errors.push("Name can't be empty.".to_string());
    } else if name.chars().count() > 60 {
        errors.push("Name is too long (60 characters max).".to_string());
    }
    let width_ok = edit.frame_width >= 1 && edit.frame_width <= 2048;
    let height_ok = edit.frame_height >= 1 && edit.frame_height <= 2048;
    if !width_ok {
        errors.push(format!(
            "Frame width must be between 1 and 2048 (got {}).",
            edit.frame_width
        ));
    }
    if !height_ok {
        errors.push(format!(
            "Frame height must be between 1 and 2048 (got {}).",
            edit.frame_height
        ));
    }
    if edit.frame_rate <= 0 {
        errors.push("Default speed must be a positive number of frames per second.".to_string());
    }
    let dims_ok = width_ok && height_ok;

    let mut seen: HashSet<(String, String)> = HashSet::new();
    for c in &edit.clips {
        let label = format!("{}/{}", c.stage, c.clip);
        if !CANONICAL_STAGES.contains(&c.stage.as_str()) {
            errors.push(format!("{label}: not one of the 7 supported stages."));
            continue;
        }
        if !valid_clip_name(&c.clip) {
            errors.push(format!("{label}: animation names may only use letters, numbers, - and _."));
            continue;
        }
        if !seen.insert((c.stage.clone(), c.clip.clone())) {
            errors.push(format!("{label}: listed more than once."));
            continue;
        }
        if let Some(fps) = c.fps {
            if fps <= 0 {
                errors.push(format!("{label}: speed must be a positive number."));
                continue;
            }
        }
        let Some(rel) = safe_rel(&c.file) else {
            errors.push(format!("{label}: unsafe file path."));
            continue;
        };
        let src = src_root.join(&rel);
        if !src.is_file() {
            errors.push(format!("{label}: file \"{}\" was not found.", c.file));
            continue;
        }
        let info = match read_png_info(&src) {
            Ok(i) => i,
            Err(e) => {
                errors.push(format!("{label}: {e}"));
                continue;
            }
        };
        let mut frames = 1i64;
        if dims_ok {
            if info.height != edit.frame_height || info.width % edit.frame_width != 0 {
                errors.push(format!(
                    "{label}: \"{}\" is {}x{}px, but frames are {}x{}px — its height must be \
                     exactly {}px and its width a multiple of {}px.",
                    c.file, info.width, info.height, edit.frame_width, edit.frame_height,
                    edit.frame_height, edit.frame_width
                ));
                continue;
            }
            frames = (info.width / edit.frame_width) as i64;
        }
        if !info.has_alpha {
            warnings.push(format!(
                "{label}: \"{}\" doesn't have an alpha channel — it will render with an opaque \
                 background instead of a transparent one.",
                c.file
            ));
        }
        out.push(ValidClip {
            stage: c.stage.clone(),
            clip: c.clip.clone(),
            src,
            sheet: rel.to_string_lossy().to_string(),
            frames,
            fps: c.fps,
        });
    }

    for stage in CANONICAL_STAGES {
        if !edit
            .clips
            .iter()
            .any(|c| c.stage == stage && c.clip == REQUIRED_ANIMATION)
        {
            errors.push(format!("\"{stage}\" is missing the required \"idle\" animation."));
        }
    }

    if errors.is_empty() {
        Ok((out, warnings))
    } else {
        Err(errors)
    }
}

/// Writes `manifest.internal.json` (the shape `assets::load_custom_species`
/// reads) plus `pack.meta.json` (frame geometry, for later editing).
fn write_pack_files(install: &Path, edit: &PackEdit, clips: &[ValidClip]) -> Result<(), String> {
    let mut stages: HashMap<String, RawStageForWrite> = HashMap::new();
    for c in clips {
        let entry = stages
            .entry(c.stage.clone())
            .or_insert_with(|| RawStageForWrite {
                clips: HashMap::new(),
            });
        entry.clips.insert(
            c.clip.clone(),
            ClipDef {
                sheet: c.sheet.clone(),
                frames: c.frames,
                fps: c.fps.unwrap_or(edit.frame_rate),
            },
        );
    }
    let species = RawSpeciesForWrite {
        id: "custom".to_string(),
        name: edit.name.trim().to_string(),
        stages,
        pixel_art: edit.pixel_art,
    };
    let internal_json = serde_json::to_string_pretty(&species)
        .map_err(|e| format!("could not serialize installed manifest: {e}"))?;
    fs::write(install.join("manifest.internal.json"), internal_json)
        .map_err(|e| format!("could not write installed manifest: {e}"))?;

    let meta = PackMeta {
        frame_width: edit.frame_width,
        frame_height: edit.frame_height,
        frame_rate: edit.frame_rate,
    };
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("could not serialize pack details: {e}"))?;
    fs::write(install.join("pack.meta.json"), meta_json)
        .map_err(|e| format!("could not write pack details: {e}"))?;
    Ok(())
}

/// Step 2: validates the person's confirmed details and saves them.
///
/// `mode == "new"` installs the staged upload as the single "custom" slot
/// (replacing any previous custom pack). `mode == "installed"` only
/// rewrites the installed pack's details — the sprite files stay put.
///
/// Neither mode changes which species the companion is wearing; the
/// separate "Use this companion" step in Settings does that, so the
/// person can review the result first (matching the rest of the app's
/// "installing shouldn't silently switch you" convention). Deliberately
/// one slot, not one-per-pack: multiple named custom companions is item
/// 5 (Companion Collection)'s job.
pub fn save_pack(conn: &Connection, mode: &str, edit: &PackEdit) -> Result<CustomPackSummary, String> {
    let install = install_dir();
    let (src_root, is_new) = match mode {
        "new" => {
            let staging = staging_dir();
            if !staging.is_dir() {
                return Err("The uploaded pack is no longer available — choose the zip again.".to_string());
            }
            (find_pack_root(&staging)?, true)
        }
        "installed" => {
            if !install.join("manifest.internal.json").exists() {
                return Err("No custom pack is installed yet — upload one first.".to_string());
            }
            (install.clone(), false)
        }
        other => return Err(format!("unknown save mode \"{other}\"")),
    };

    let (mut valid, warnings) = validate_edit(&src_root, edit).map_err(|errs| errs.join("\n"))?;

    if is_new {
        if install.exists() {
            fs::remove_dir_all(&install).map_err(|e| {
                format!("could not remove the previous custom pack before installing the new one: {e}")
            })?;
        }
        fs::create_dir_all(&install).map_err(|e| format!("could not create pack directory: {e}"))?;
        // Copy only the animations the person kept, under normalized
        // <stage>/<clip>.png names so the installed manifest is uniform
        // whatever the uploaded files were called.
        for c in valid.iter_mut() {
            let rel = format!("{}/{}.png", c.stage, c.clip);
            let dst = install.join(&rel);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&c.src, &dst).map_err(|e| format!("could not copy {}: {e}", rel))?;
            c.sheet = rel;
        }
    }

    write_pack_files(&install, edit, &valid)?;
    if is_new {
        let _ = fs::remove_dir_all(staging_dir());
    }

    let display_name = edit.name.trim().to_string();
    let species_id = persistence::upsert_species(
        conn,
        "custom",
        &display_name,
        "Custom uploaded companion pack (Phase 14 Item 4).",
    )?;
    if is_new {
        let sparkling_id = persistence::species_id_by_slug(conn, "sparkling")?.ok_or(
            "the built-in \"sparkling\" species is missing from the database — cannot copy its level curve",
        )?;
        persistence::copy_evolution_thresholds(conn, sparkling_id, species_id)?;
    }

    let active_species_id = persistence::get_active_companion(conn)?.species_id;
    let mut animations: HashMap<String, Vec<String>> = HashMap::new();
    for c in &valid {
        animations.entry(c.stage.clone()).or_default().push(c.clip.clone());
    }
    for names in animations.values_mut() {
        names.sort();
    }

    Ok(CustomPackSummary {
        name: display_name,
        stages: CANONICAL_STAGES.iter().map(|s| s.to_string()).collect(),
        animations,
        warnings,
        active: active_species_id == species_id,
    })
}

struct PngInfo {
    width: u32,
    height: u32,
    has_alpha: bool,
}

/// Reads just enough of a PNG's IHDR chunk to get its pixel dimensions and
/// color type, without pulling in an image-decoding crate for what's
/// otherwise a fixed 33-byte header read (PNG signature + IHDR chunk are
/// always the first bytes of a valid file, per the PNG spec). This checks
/// the *format* supports transparency (color type 4/6, or a palette that
/// may carry a tRNS chunk) — it doesn't inspect actual pixel alpha values,
/// so "has_alpha" means "capable of transparency", not "definitely has
/// transparent pixels".
fn read_png_info(path: &Path) -> Result<PngInfo, String> {
    let mut f = fs::File::open(path).map_err(|e| format!("could not open file: {e}"))?;
    let mut header = [0u8; 33];
    f.read_exact(&mut header)
        .map_err(|_| "file is too small to be a valid PNG".to_string())?;

    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if header[0..8] != PNG_SIGNATURE {
        return Err("not a PNG file (bad signature — only PNG is supported).".to_string());
    }
    if &header[12..16] != b"IHDR" {
        return Err("not a valid PNG (missing IHDR chunk).".to_string());
    }
    let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
    let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
    if width == 0 || height == 0 {
        return Err("PNG has a zero width or height.".to_string());
    }
    let color_type = header[25];
    // PNG color types: 0 grayscale, 2 RGB, 3 palette, 4 grayscale+alpha, 6 RGBA.
    // Palette (3) *may* carry transparency via an optional tRNS chunk — not
    // checked here, so it's treated as "might have alpha" rather than warned.
    let has_alpha = matches!(color_type, 3 | 4 | 6);

    Ok(PngInfo {
        width,
        height,
        has_alpha,
    })
}

/// Extracts a zip file into `dest`, refusing any entry that would escape
/// `dest` via ".." or an absolute path (the "zip slip" vulnerability) and
/// skipping macOS's `__MACOSX/` metadata folder and dotfiles, which are
/// noise here, not pack content.
fn extract_zip(zip_path: &str, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("could not open zip file: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("could not read zip file: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("could not read zip entry: {e}"))?;
        let Some(raw_name) = entry.enclosed_name() else {
            return Err(format!(
                "zip entry \"{}\" has an unsafe path and was rejected.",
                entry.name()
            ));
        };
        let name_str = raw_name.to_string_lossy();
        if name_str.starts_with("__MACOSX")
            || raw_name
                .file_name()
                .map(|f| f.to_string_lossy().starts_with('.'))
                .unwrap_or(false)
        {
            continue;
        }

        let out_path = dest.join(&raw_name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file =
            fs::File::create(&out_path).map_err(|e| format!("could not write {out_path:?}: {e}"))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("could not extract {out_path:?}: {e}"))?;
    }
    Ok(())
}

/// `RawSpecies`'s fields are `pub(crate)` for reading, but it doesn't derive
/// `Serialize` (nothing needed to write one back out until now) — this is a
/// `RawSpecies` (assets.rs) only derives `Deserialize` — this is a tiny
/// mirror struct purely so `write_pack_files` can write
/// manifest.internal.json in exactly the shape `load_custom_species` reads.
#[derive(Serialize)]
struct RawSpeciesForWrite {
    id: String,
    name: String,
    stages: HashMap<String, RawStageForWrite>,
    #[serde(rename = "pixelArt")]
    pixel_art: bool,
}
#[derive(Serialize)]
struct RawStageForWrite {
    clips: HashMap<String, ClipDef>,
}
/// Deletes the installed "custom" pack entirely: the species row (cascades
/// to its evolution-threshold rows via ON DELETE CASCADE, migration
/// 0003) and its files on disk. Callers are responsible for making sure
/// nothing is still actively wearing this species first — see
/// commands::companion::delete_custom_companion_pack, which reverts to
/// Sparkling before calling this if the custom pack happens to be active,
/// so this never has to violate companion_collection's foreign key.
pub fn delete_installed(conn: &Connection, species_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM companion_species WHERE id = ?1", rusqlite::params![species_id])
        .map_err(|e| format!("could not remove the custom species from the database: {e}"))?;
    let install = install_dir();
    if install.exists() {
        fs::remove_dir_all(&install).map_err(|e| format!("could not delete the pack's files: {e}"))?;
    }
    // A stray in-progress draft (if "Edit details" was open) is no longer
    // meaningful once the pack itself is gone.
    let _ = fs::remove_dir_all(staging_dir());
    Ok(())
}

/// Current custom-pack status for the Settings page to show on load,
/// without re-uploading anything. `None` means no pack has ever been
/// installed.
pub fn get_status(conn: &Connection) -> Result<Option<CustomPackSummary>, String> {
    let install = install_dir();
    if !install.join("manifest.internal.json").exists() {
        return Ok(None);
    }
    let Some(species_id) = persistence::species_id_by_slug(conn, "custom")? else {
        return Ok(None);
    };
    let (sm, _missing) = super::assets::load_custom_species(&install)?;
    let active_species_id = persistence::get_active_companion(conn)?.species_id;

    let mut animations: HashMap<String, Vec<String>> = HashMap::new();
    for (stage, clips) in &sm.stages {
        animations.insert(stage.clone(), clips.keys().cloned().collect());
    }

    Ok(Some(CustomPackSummary {
        name: persistence::species_display_name(conn, species_id)?,
        stages: CANONICAL_STAGES.iter().map(|s| s.to_string()).collect(),
        animations,
        warnings: Vec::new(),
        active: active_species_id == species_id,
    }))
}
