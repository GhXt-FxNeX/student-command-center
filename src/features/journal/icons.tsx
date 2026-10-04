/**
 * Line icons for the Private Journal — same stroke language as
 * features/settings/icons.tsx and the nav rail (currentColor, 1.6 stroke,
 * round caps/joins). Hand-drawn; the app has no icon-library dependency.
 * Kept inside the journal feature rather than added to the shared Settings
 * icon file, since nothing outside the journal uses them.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return { viewBox: "0 0 20 20", fill: "none" as const, xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, ...props };
}

const S = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="9" width="12" height="8" rx="2" {...S} />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" {...S} />
      <circle cx="10" cy="13" r="0.6" fill="currentColor" {...S} />
    </svg>
  );
}

export function UnlockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="9" width="12" height="8" rx="2" {...S} />
      <path d="M7 9V6.5a3 3 0 0 1 5.6-1.5" {...S} />
      <circle cx="10" cy="13" r="0.6" fill="currentColor" {...S} />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 2.8 16 5v4.5c0 3.6-2.4 6.3-6 7.7-3.6-1.4-6-4.1-6-7.7V5l6-2.2Z" {...S} />
      <path d="M7.4 9.8l2 2 3.4-3.6" {...S} />
    </svg>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="5.5" width="11" height="9" rx="2" {...S} />
      <path d="M13.5 9l4-2.2v6.4l-4-2.2" {...S} />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4.8v10.4L15.5 10 7 4.8Z" fill="currentColor" {...S} />
    </svg>
  );
}

export function RecordIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="5.5" fill="currentColor" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="2" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5l10 10M15 5L5 15" {...S} />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.5 9v4M11.5 9v4" {...S} />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.5 4.5l3 3L7 16H4v-3l8.5-8.5Z" {...S} />
      <path d="M11 6l3 3" {...S} />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="9" r="5" {...S} />
      <path d="M13 13l3.5 3.5" {...S} />
    </svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 5.5h6.5M12.5 5.5H17M3 10h3.5M9.5 10H17M3 14.5h6.5M12.5 14.5H17" {...S} />
      <circle cx="10.5" cy="5.5" r="1.7" {...S} />
      <circle cx="7" cy="10" r="1.7" {...S} />
      <circle cx="10.5" cy="14.5" r="1.7" {...S} />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" {...S} />
      <circle cx="10" cy="10" r="2.2" {...S} />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" {...S} />
      <circle cx="10" cy="10" r="2.2" {...S} />
      <path d="M4 4l12 12" {...S} />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4.5 6.5 10 12 15.5" {...S} />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 4.5 13.5 10 8 15.5" {...S} />
    </svg>
  );
}

/** Indeterminate spinner. Pair with `animate-spin motion-reduce:animate-none`. */
export function SpinnerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" opacity="0.25" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
