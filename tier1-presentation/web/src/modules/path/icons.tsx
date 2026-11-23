/** Glyphs from the prototype icon set (core.js `ICONS`), stroke-drawn, sized by CSS. Decorative. */

const svg = {
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: false,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function SparkIcon() {
  return (
    <svg {...svg} className="gp-path-icon">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...svg} className="gp-path-icon">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...svg} className="gp-path-icon gp-path-lock">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
