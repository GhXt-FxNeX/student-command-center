/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Bridged to CSS variables so the accent-color system (Settings > Appearance)
        // can repaint the whole app at runtime without a Tailwind rebuild.
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        text: "var(--color-text)",
        "text-secondary": "var(--color-text-secondary)",
        accent: "var(--color-accent)",
        "accent-hover": "var(--color-accent-hover)",
        "accent-active": "var(--color-accent-active)",
        "accent-soft": "var(--color-accent-soft)",
        // AA-safe derivations (see lib/theme/accent.ts). `accent` itself is for
        // decorative use only; solid fills carrying white text use accent-fill,
        // and accent-colored TEXT uses accent-text.
        "accent-fill": "var(--color-accent-fill)",
        "accent-fill-hover": "var(--color-accent-fill-hover)",
        "accent-fill-active": "var(--color-accent-fill-active)",
        "accent-text": "var(--color-accent-text)",
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
};
