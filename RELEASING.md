# Building and releasing Student Command Center

Version **1.0.0**. The version lives in four places and they must match:
`package.json` (what Settings → About shows), `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`, and the `student-command-center` entry in `src-tauri/Cargo.lock`
(cargo updates the lock itself on the next build; `package-lock.json`'s root entry too).

## 0. Publishing a release (the way to share the app)

Nobody who downloads the app should need Node, Rust or `npm`. Installers are built by GitHub
Actions (`.github/workflows/build.yml`) on macOS, Windows and Linux and attached to a Releases page:

1. One time: create a GitHub repository for the project and push it. (Make it **public** if anyone
   should be able to download without a GitHub account; a private repository's Releases are visible only
   to people you invite.)
2. Make sure the version matches in all four places (see top of this file), commit, push.
3. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
4. Wait about 20–40 minutes (first run is the slowest). Watch Actions → *build*. When it's green, the
   repository's **Releases** page has four files: a universal Mac `.dmg`, a Windows `-setup.exe`, a Linux
   `.deb` and a Linux `.AppImage`, plus first-launch instructions for each OS.
5. Share the Releases link (or the direct file links).

If a job is red, open it and read the failing step — that's the first real compile of the Windows/Linux
builds, so send the log to Claude. To test-build without publishing: Actions → *build* → *Run workflow*.

Not code-signed: Macs ask for right-click → Open once, Windows shows SmartScreen once. Removing those
prompts needs paid certificates (Apple Developer ID, a Windows code-signing certificate) — see section 4.

## 1. Before you build (building by hand on your own Mac)

1. **Back up your current data**: Settings → Data → *Back up your data*. The built app uses
   the SAME data folder as `tauri dev`, so it will open your existing data. (Migrations also
   make an automatic `*.pre-migration-bak`.) The folder is `<per-user data>/com.studentcommandcenter.app`:
   macOS `~/Library/Application Support/…`, Windows `%APPDATA%\…`, Linux `~/.local/share/…`
   (or `$XDG_DATA_HOME`). `logs/scc.log` in it is where start-up failures are recorded.
   This is also the first real test of the backup feature.
2. **Type-check — this is the step `tauri dev` never runs.** `tauri build` runs
   `npm run build` = `tsc && vite build`, and `tsc` is strict (unused variables/imports are
   errors). Run it first so you see the errors in isolation:
   ```
   npm install
   npx tsc --noEmit
   ```
   Fix anything it reports (paste it to Claude if unsure).
3. `cd src-tauri && cargo build` should print **no warnings** now (the 7 old ones were fixed).

## 2. Build

```
npm run tauri build
```

The first build compiles everything in release mode and takes several minutes. Output:

- `src-tauri/target/release/bundle/macos/Student Command Center.app`
- `src-tauri/target/release/bundle/dmg/Student Command Center_1.0.0_<arch>.dmg`

The Tauri CLI prints a warning that the identifier ends in `.app`. **Do not change it**: the
custom-companion asset scope in `tauri.conf.json` (`$APPDATA/companion_packs/**`) is tied to it,
and changing it would point the built app at a different, empty data folder.

## 3. Test the BUILT app (not `tauri dev`) — things only a release build can break

Open the `.app` from `bundle/macos` and check:

- [ ] Starts with the logo + spinner, no white flash; your data is there.
- [ ] **Companion sprites show** (they are bundled as resources and found differently than in dev).
- [ ] **Recording** (the journal, if you use it): macOS asks for camera and microphone **once**,
      and recording works. (This is why `src-tauri/Info.plist` exists — without those
      usage strings the packaged app is refused access.) If you previously clicked *Don't Allow*:
      System Settings → Privacy & Security → Camera / Microphone.
- [ ] **Keychain**: entering an API key / connecting Spotify may prompt for keychain access
      ("student-command-center") — choose *Always Allow* so it doesn't ask every launch.
- [ ] Spotify connect opens the browser and returns to the app.
- [ ] Pomodoro finishes and saves a session; Calendar/Analytics show it at the right time.
- [ ] Export a backup, then restore it (Settings → Data).
- [ ] Quit and reopen: everything persisted.

## 4. Sharing it with someone else / another Mac

The build is **not code-signed or notarized**. On the Mac that built it, it just runs. On another
Mac, Gatekeeper may say the app is "damaged" or from an unidentified developer. Either:

- right-click the app → **Open** (first launch only), or
- `xattr -dr com.apple.quarantine "/Applications/Student Command Center.app"`

To distribute without those steps you need an Apple Developer account (paid): sign with a
Developer ID certificate and notarize (`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID` environment variables; see the Tauri macOS signing docs). Signing with the hardened
runtime also needs an entitlements file with `com.apple.security.device.camera` and
`com.apple.security.device.audio-input`, referenced from `bundle.macOS.entitlements`.
Windows and Linux builds must be made on those systems (`npm run tauri build` there) — or let
GitHub Actions do it, see below.

## 4b. Windows and Linux

Same commands, run on that OS (prerequisites per OS: README → Prerequisites):

```
npm install
npx tsc --noEmit
npm run tauri build
```

Tauri merges the platform file next to `tauri.conf.json` automatically — `tauri.windows.conf.json`
or `tauri.linux.conf.json` — so no flags are needed. Output:

- **Windows:** `src-tauri/target/release/bundle/nsis/Student Command Center_1.0.0_x64-setup.exe`.
  NSIS only (one self-contained setup file; per-user or all-users; no WiX/MSI toolchain). The
  installer embeds the WebView2 bootstrapper, so a PC without the runtime installs it (needs internet
  only in that case). Not code-signed: SmartScreen shows "Windows protected your PC" → *More info → Run
  anyway*; avoiding that needs a code-signing certificate. Uninstalling keeps your data.
- **Linux:** `…/bundle/deb/*.deb` (`sudo apt install ./that.deb`) and
  `…/bundle/appimage/…AppImage` (`chmod +x`, run). Build on the oldest distro you want to support
  (CI uses Ubuntu 22.04). Only Debian/Ubuntu-family has been targeted; other distributions are untested.
  API keys / Spotify sign-in need a running Secret Service (GNOME Keyring or KWallet).

**Let GitHub Actions build all three:** `.github/workflows/build.yml` (Actions → *build* → *Run workflow*,
or push a `v*` tag). It type-checks, runs `cargo test`, builds on macOS/Windows/Linux, uploads the
installers as artifacts, and on Linux installs the `.deb` into a fresh profile, launches it under a
virtual display with a keyring running, and checks that the database and `logs/scc.log` appear.

**Clean-install checklist (do this on each OS with the BUILT package, not `tauri dev`):**

- [ ] Install, launch: logo + spinner, then onboarding (name/icon) on a fresh profile.
- [ ] Data folder created; `logs/scc.log` has a "started on …" line.
- [ ] Create a task, a course, a transaction and an exam; run a Pomodoro; quit; reopen — all still there.
- [ ] Settings → Appearance: Light/Dark/System and an accent; scrollbars follow the theme.
- [ ] Settings → AI: save a key (OS keychain prompt / Secret Service), run "Generate my day".
- [ ] Settings → Companion: upload a custom pack — **the artwork must display** (this is what the
      data-folder fix is for); Settings → Data: export a backup, restore it.
- [ ] Spotify connect opens the system browser and returns to the app.
- [ ] Journal (triple-click Settings): record, save, play back — Linux AppImage/WebKitGTK and
      Windows WebView2 are the unknown here.
- [ ] Uninstall: app removed, data folder kept.

Linux blank window? Try `WEBKIT_DISABLE_DMABUF_RENDERER=1 student-command-center` (some NVIDIA/Wayland setups).

## 5. Optional hardening / housekeeping (not required to ship)

- **Content-Security-Policy.** `app.security.csp` is `null` (no restriction), which is the
  Tauri default and fine for a local app that loads no remote scripts. If you want a policy,
  something like the following is the starting point — but it must be tested in the built app
  (Spotify album art, journal playback, companion sprites), and the Spotify image hosts must
  match what Spotify actually returns:
  `default-src 'self'; img-src 'self' data: blob: asset: http://asset.localhost https://*.scdn.co https://*.spotifycdn.com; media-src 'self' blob: asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost`
  (Tauri adds hashes for the inline theme script in `index.html` automatically.)
- **Smaller binary.** Add to `src-tauri/Cargo.toml`: `[profile.release]` with `strip = true`
  and `lto = "thin"` (slower to compile). Don't set `panic = "abort"`.
- **Dependencies.** See README (pass 5) for the `npm audit` triage; none are exploitable here.
  React Router v7 is the one shipping dependency worth upgrading, as its own tested change.
