App icon set, generated from the Student Command Center logo (white "S" with an
open book, star and arrow, on a near-black rounded plate).

- `icon.png` (512px) is the source for everything else. To regenerate the full
  platform set after changing the artwork, replace a 1024x1024 PNG and run
  `npm run tauri icon path/to/icon.png`.
- The in-app logo (navigation, loading screen, onboarding) is NOT these files:
  it is a theme-aware mask embedded in `index.html` (see architecture.md §A17).
- On macOS the Dock/Finder icon only appears in a built app (`npm run tauri
  build`); `tauri dev` runs a bare binary, so the Dock shows a generic icon.
