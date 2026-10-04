/**
 * Accent color system.
 *
 * The user only ever picks ONE color (a preset or a custom hex). Everything
 * else — hover, active, soft background, and dark-mode adjustment — is
 * derived deterministically here, per spec §12: "Do not force the user to
 * manually configure dozens of colors."
 */

export const ACCENT_PRESETS = {
  blue: "#4f7cff",
  purple: "#8b5cf6",
  green: "#22c55e",
  orange: "#f97316",
  red: "#ef4444",
  pink: "#ec4899",
  teal: "#14b8a6",
} as const;

export type AccentPreset = keyof typeof ACCENT_PRESETS;
export type ThemeMode = "light" | "dark" | "system";

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let [r, g, b] = [0, 0, 0];

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const clampL = (l: number) => Math.min(100, Math.max(0, l));

export interface DerivedAccent {
  /** The color the person chose, untouched. Use for DECORATIVE things: rings,
   * progress fills, dots, borders, the focus of a chart. Never for text and
   * never as a fill that carries white text — it fails WCAG AA for every
   * preset (white on the default blue is 3.7:1, on green 2.3:1). */
  accent: string;
  hover: string;
  active: string;
  soft: string;
  /** A fill for solid buttons/badges with WHITE text on them: the chosen
   * accent darkened just far enough to reach 4.5:1 against white (AA). */
  fill: string;
  fillHover: string;
  fillActive: string;
  /** Accent as TEXT (links, ghost buttons, active tab labels): shifted just
   * far enough (darker in light mode, lighter in dark) to reach 4.5:1 on the
   * page background, the card surface AND the accent-soft tint it often sits on. */
  text: string;
}

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(clean.substring(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The AA minimum for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Moves `hex`'s lightness one point at a time in `direction` until it reaches
 * `min` contrast against EVERY color in `against`. Hue and saturation are
 * kept, so it stays recognizably the chosen accent, just deeper/lighter. If
 * the color already passes it is returned unchanged; an extreme lightness
 * always passes, so the loop always terminates.
 */
function shiftUntilContrast(hex: string, against: string[], min: number, direction: "darken" | "lighten"): string {
  const hsl = hexToHsl(hex);
  const passes = (h: string) => against.every((bg) => contrastRatio(h, bg) >= min);
  if (passes(hex)) return hex;
  const step = direction === "darken" ? -1 : 1;
  for (let l = Math.round(hsl.l) + step; l >= 0 && l <= 100; l += step) {
    const candidate = hslToHex({ ...hsl, l });
    if (passes(candidate)) return candidate;
  }
  return direction === "darken" ? "#000000" : "#ffffff";
}

// Surface colors the accent text/fill must clear. These MIRROR the theme
// values in styles/globals.css (:root / .dark) — keep the two in sync.
const SURFACES = {
  light: { bg: "#f7f7f8", surface: "#ffffff" },
  dark: { bg: "#101114", surface: "#1a1b1f" },
} as const;

/** Derive the full accent palette from a single base hex color. */
export function deriveAccentPalette(baseHex: string, mode: "light" | "dark"): DerivedAccent {
  const hsl = hexToHsl(baseHex);
  const hoverDelta = mode === "dark" ? 8 : -8;
  const activeDelta = mode === "dark" ? 16 : -16;

  const soft = hslToHex({ ...hsl, s: Math.min(100, hsl.s * 0.5), l: mode === "dark" ? 20 : 94 });

  // Solid fill that carries white text. Same in both modes: white-on-fill
  // contrast doesn't depend on the theme. Hover/active go DARKER in both
  // modes (unlike the decorative hover above, which lightens in dark mode)
  // because lightening a fill lowers its contrast with the white text on it.
  const fill = shiftUntilContrast(baseHex, ["#ffffff"], MIN_TEXT_CONTRAST, "darken");
  const fillHsl = hexToHsl(fill);
  const surfaces = SURFACES[mode];

  return {
    accent: baseHex,
    hover: hslToHex({ ...hsl, l: clampL(hsl.l + hoverDelta) }),
    active: hslToHex({ ...hsl, l: clampL(hsl.l + activeDelta) }),
    soft,
    fill,
    fillHover: hslToHex({ ...fillHsl, l: clampL(fillHsl.l - 6) }),
    fillActive: hslToHex({ ...fillHsl, l: clampL(fillHsl.l - 12) }),
    text: shiftUntilContrast(baseHex, [surfaces.bg, surfaces.surface, soft], MIN_TEXT_CONTRAST, mode === "dark" ? "lighten" : "darken"),
  };
}

/** Resolve "system" to an actual light/dark mode. */
export function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

/** Apply theme mode + accent to the document by writing CSS variables. */
export function applyTheme(mode: ThemeMode, accentHex: string) {
  const resolved = resolveThemeMode(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");

  const palette = deriveAccentPalette(accentHex, resolved);
  const root = document.documentElement.style;
  root.setProperty("--color-accent", palette.accent);
  root.setProperty("--color-accent-hover", palette.hover);
  root.setProperty("--color-accent-active", palette.active);
  root.setProperty("--color-accent-soft", palette.soft);
  root.setProperty("--color-accent-fill", palette.fill);
  root.setProperty("--color-accent-fill-hover", palette.fillHover);
  root.setProperty("--color-accent-fill-active", palette.fillActive);
  root.setProperty("--color-accent-text", palette.text);

  // Cache for index.html's first-paint script, so the NEXT launch paints the
  // right theme + accent before settings have loaded from the database (this
  // is what removes the white flash on a dark theme). Best-effort: storage can
  // be unavailable, and a missing cache just means the OS preference is used.
  try {
    const vars: Record<string, string> = {};
    for (let i = 0; i < root.length; i++) {
      const name = root[i];
      if (name.startsWith("--")) vars[name] = root.getPropertyValue(name);
    }
    localStorage.setItem("scc.theme", JSON.stringify({ mode, vars }));
  } catch {
    /* ignore */
  }
}
