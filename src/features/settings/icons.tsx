/**
 * Minimal line icons for the Settings category grid — same stroke style
 * as the nav rail's hamburger icon in Shell.tsx (currentColor, 1.6 stroke,
 * round caps) so they read as part of the same visual system. Hand-drawn
 * rather than pulled from an icon library, since the app doesn't depend
 * on one anywhere else yet.
 *
 * The Spotify tile deliberately uses a generic "sound bars" glyph, not
 * Spotify's own logo/mark (third-party brand IP).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 20 20",
    fill: "none" as const,
    xmlns: "http://www.w3.org/2000/svg",
    ...props,
  };
}

export function GeneralIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 5.5h6.5M12.5 5.5H17M3 10h3.5M9.5 10H17M3 14.5h6.5M12.5 14.5H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10.5" cy="5.5" r="1.7" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="10" r="1.7" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10.5" cy="14.5" r="1.7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function AppearanceIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.8v1.9M10 15.3v1.9M17.2 10h-1.9M4.7 10H2.8M15.1 4.9l-1.3 1.3M6.2 13.8l-1.3 1.3M15.1 15.1l-1.3-1.3M6.2 6.2 4.9 4.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AiIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M10 2.5c.35 2.8 1.02 4.4 2.05 5.45C13.1 8.98 14.7 9.65 17.5 10c-2.8.35-4.4 1.02-5.45 2.05C11.02 13.1 10.35 14.7 10 17.5c-.35-2.8-1.02-4.4-2.05-5.45C6.9 11.02 5.3 10.35 2.5 10c2.8-.35 4.4-1.02 5.45-2.05C8.98 6.9 9.65 5.3 10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CompanionIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M10 3.2c-3.4 0-5.8 2.5-5.8 6 0 2.4 1 4.3 2.6 5.5.15.9.5 1.7.98 2.3.2.25.55.2.68-.1.2-.45.35-.98.42-1.5a7 7 0 0 0 2.05.28c1.1 0 2.1-.2 2.9-.55.08.5.22.98.4 1.4.13.3.48.35.68.1.5-.62.85-1.42 1-2.35 1.5-1.2 2.4-3.05 2.4-5.4 0-3.5-2.4-6-5.8-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="7.6" cy="9.6" r="1" fill="currentColor" />
      <circle cx="12.4" cy="9.6" r="1" fill="currentColor" />
    </svg>
  );
}

export function SpotifyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="9" width="2.4" height="7.5" rx="1.2" fill="currentColor" />
      <rect x="8.8" y="4.5" width="2.4" height="12" rx="1.2" fill="currentColor" />
      <rect x="14.1" y="7" width="2.4" height="9.5" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function DataIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="10" cy="5" rx="6" ry="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 5v4.5c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5M4 9.5V14c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PrivacyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M10 2.6 16 4.9v4.4c0 4-2.6 6.8-6 8.1-3.4-1.3-6-4.1-6-8.1V4.9L10 2.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M7.5 10.1 9.2 11.8 12.6 8.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AboutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6.7" r="1" fill="currentColor" />
      <path d="M10 9.3v4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BackChevronIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
