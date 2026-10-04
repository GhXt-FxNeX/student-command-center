use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// Mirrors assets/companions/manifest.json. Kept intentionally generic (a
/// clip is just a sheet path + frame count + fps) so new creatures/stages/
/// clips are pure data — no engine or component code changes required.
#[derive(Debug, Serialize, serde::Deserialize, Clone)]
pub struct ClipDef {
    pub sheet: String,
    pub frames: i64,
    pub fps: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetManifest {
    pub species: Vec<SpeciesManifest>,
    /// Sheets referenced by the manifest that don't exist on disk. Surfaced
    /// to the frontend so missing assets are visible in dev, never silent.
    pub missing_files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesManifest {
    pub id: String,
    pub name: String,
    pub stages: HashMap<String, HashMap<String, ClipDef>>,
    /// "bundled" (shipped with the app, served from the frontend's
    /// `/companions/...` static path) or "custom" (a Phase 14 Item 4
    /// user-uploaded pack living in the OS app-data dir, served via Tauri's
    /// asset protocol / `convertFileSrc`). Tells SpriteAnimator which URL
    /// scheme to use — see FRONTEND note in custom_pack.rs.
    pub source: String,
    /// True renders this species with nearest-neighbor scaling instead of
    /// smooth/bilinear — crisp for pixel-art packs, wrong for
    /// painted/illustrated ones (see SpriteAnimator.tsx). Defaults false
    /// (smooth) via #[serde(default)] on RawSpecies, so every bundled
    /// species entry that predates this field is unaffected.
    pub pixel_art: bool,
}

/// Raw JSON shape of a single species entry — used both for entries inside
/// the bundled manifest.json's `species` array, and standalone for a custom
/// pack's installed `manifest.internal.json` (custom_pack.rs converts an
/// uploaded pack's own manifest format into exactly this shape at install
/// time, so this loader doesn't need to know custom packs exist at all).
#[derive(Debug, serde::Deserialize)]
pub(crate) struct RawSpecies {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) stages: HashMap<String, RawStage>,
    #[serde(default, rename = "pixelArt")]
    pub(crate) pixel_art: bool,
}
#[derive(Debug, serde::Deserialize)]
pub(crate) struct RawStage {
    pub(crate) clips: HashMap<String, ClipDef>,
}
#[derive(Debug, serde::Deserialize)]
struct RawManifest {
    species: Vec<RawSpecies>,
}

/// Turns one raw species entry into a validated `SpeciesManifest`, checking
/// every clip's sheet file exists under `root` (bundled) or is already an
/// absolute path (custom — see `resolve_custom_species` below, which
/// rewrites sheet paths to absolute before this runs). Shared by both the
/// bundled-manifest loader and the custom-pack loader so "does this file
/// exist, and what do we do if not" lives in exactly one place.
fn process_raw_species(
    s: RawSpecies,
    root: &Path,
    source: &str,
    resolve_full_path: impl Fn(&Path, &str) -> std::path::PathBuf,
) -> (SpeciesManifest, Vec<String>) {
    let mut missing_files = Vec::new();
    let mut stages = HashMap::new();
    for (stage_name, stage) in s.stages {
        let mut clips = HashMap::new();
        for (clip_name, clip) in stage.clips {
            let full_path = resolve_full_path(root, &clip.sheet);
            if !full_path.exists() {
                missing_files.push(clip.sheet.clone());
            }
            clips.insert(clip_name, clip);
        }
        stages.insert(stage_name, clips);
    }
    (
        SpeciesManifest {
            id: s.id,
            name: s.name,
            stages,
            source: source.to_string(),
            pixel_art: s.pixel_art,
        },
        missing_files,
    )
}

/// Loads and validates the companion asset manifest relative to the given
/// assets root (the project's `assets/companions/` directory). Missing
/// sprite sheet files are collected rather than causing a failure — a
/// companion with some clips missing (e.g. only "idle" shipped so far)
/// must still start up and fall back gracefully, per architecture.md A5.
pub fn load_manifest(assets_root: &Path) -> Result<AssetManifest, String> {
    let manifest_path = assets_root.join("manifest.json");
    let raw_text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("could not read companion manifest at {manifest_path:?}: {e}"))?;
    let raw: RawManifest = serde_json::from_str(&raw_text)
        .map_err(|e| format!("companion manifest.json is invalid: {e}"))?;

    let mut missing_files = Vec::new();
    let mut species = Vec::new();

    for s in raw.species {
        let (sm, missing) =
            process_raw_species(s, assets_root, "bundled", |root, sheet| root.join(sheet));
        missing_files.extend(missing);
        species.push(sm);
    }

    if !missing_files.is_empty() {
        eprintln!(
            "[companion] {} referenced sprite sheet(s) not found on disk (dev placeholder \
             clips not yet drawn) — frontend will fall back to idle/placeholder for those: {:?}",
            missing_files.len(),
            missing_files
        );
    }

    Ok(AssetManifest {
        species,
        missing_files,
    })
}

/// Loads one installed custom pack's `manifest.internal.json` from
/// `pack_dir` (e.g. `{app_data_dir}/companion_packs/custom/`). Sheet paths
/// are rewritten to absolute filesystem paths (rather than left relative
/// like bundled species) because custom packs don't live under the
/// frontend's static asset root — the frontend resolves them via
/// `convertFileSrc()` instead of a relative `/companions/...` URL.
pub fn load_custom_species(pack_dir: &Path) -> Result<(SpeciesManifest, Vec<String>), String> {
    let manifest_path = pack_dir.join("manifest.internal.json");
    let raw_text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("could not read custom companion manifest at {manifest_path:?}: {e}"))?;
    let raw: RawSpecies = serde_json::from_str(&raw_text)
        .map_err(|e| format!("installed custom companion manifest is invalid: {e}"))?;

    let (sm, missing) = process_raw_species(raw, pack_dir, "custom", |root, sheet| {
        root.join(sheet)
    });
    // Sheets are stored relative to pack_dir in manifest.internal.json;
    // process_raw_species already resolved existence against that, but both
    // the ClipDef.sheet strings AND the missing-file list handed to the
    // frontend need to become absolute paths — the frontend compares
    // clipDef.sheet against missingFiles by exact string match
    // (SpriteAnimator.tsx), so leaving one relative and one absolute would
    // silently break that comparison for custom packs.
    let missing: Vec<String> = missing
        .into_iter()
        .map(|rel| pack_dir.join(rel).to_string_lossy().to_string())
        .collect();
    let mut sm = sm;
    for stage in sm.stages.values_mut() {
        for clip in stage.values_mut() {
            clip.sheet = pack_dir.join(&clip.sheet).to_string_lossy().to_string();
        }
    }
    Ok((sm, missing))
}

/// Scans `{app_data_dir}/companion_packs/*/` for installed custom packs
/// (Phase 14 Item 4) and loads each one. A missing `companion_packs`
/// directory just means no custom pack has ever been installed — not an
/// error, since custom packs are entirely optional.
pub fn load_all_custom_species(companion_packs_dir: &Path) -> (Vec<SpeciesManifest>, Vec<String>) {
    let mut species = Vec::new();
    let mut missing_files = Vec::new();

    let Ok(entries) = std::fs::read_dir(companion_packs_dir) else {
        return (species, missing_files);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !path.join("manifest.internal.json").exists() {
            continue;
        }
        match load_custom_species(&path) {
            Ok((sm, missing)) => {
                missing_files.extend(missing);
                species.push(sm);
            }
            Err(e) => {
                eprintln!("[companion] skipping unreadable custom pack at {path:?}: {e}");
            }
        }
    }
    (species, missing_files)
}
