/**
 * Interface symbols.
 *
 * Drawn from geological notation rather than a general-purpose icon set: the
 * offset mark is the section a technician is about to record, and the
 * observation mark is the standard strike-and-dip symbol they already read on
 * every plan. A technician recognises these before they read the label, which
 * is the entire job of an icon on a screen operated with gloves on.
 *
 * All are monochrome line work on `currentColor`, so they inherit the state of
 * the control they sit in and stay legible in high-contrast mode.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

/** A new face log: the record sheet. */
export function IconFaceLog({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 3.5h9l5 5V20.5H5z" />
      <path d="M14 3.5V9h5" />
      <path d="M12 12v6M9 15h6" />
    </svg>
  );
}

/** The offset section itself: a marker displaced across a structure. */
export function IconOffset({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 9h8" />
      <path d="M13.5 15h8" />
      <path d="M11.5 3v18" strokeDasharray="2.5 2.5" />
      <path d="M18 9v6M16 9.8l2-1.4 2 1.4M16 14.2l2 1.4 2-1.4" strokeWidth="1.4" />
    </svg>
  );
}

/** The strike-and-dip symbol, as it appears on every geological plan. */
export function IconObservation({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7.5h16" />
      <path d="M12 7.5v7" />
      <path d="M9.5 18.5h5" strokeWidth="1.4" />
    </svg>
  );
}

/** Face photography. */
export function IconPhoto({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 7.5h4l1.5-2.5h7L17 7.5h4v12H3z" />
      <circle cx="12" cy="13" r="3.6" />
    </svg>
  );
}

/** A channel sample: the bracket and its interval ticks. */
export function IconSample({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3.5v17M18 3.5v17" />
      <path d="M6 7h12M6 12h12M6 17h12" strokeWidth="1.4" />
    </svg>
  );
}

/** Geological hazard. */
export function IconHazard({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3.5 21.5 20H2.5z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.4v.2" strokeWidth="2.2" />
    </svg>
  );
}

/** Device compass, for a sensor-taken bearing. */
export function IconCompass({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.5 14.2 12 12 17.5 9.8 12z" />
    </svg>
  );
}

/* ── sync states ───────────────────────────────────────────────────────
   Three marks that differ in *shape*, not only colour, so the state is
   readable under a cap lamp and in high-contrast mode (§33).            */

/** Offline: an open circle — nothing is moving. */
export function IconOffline({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="7" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

/** Synced: the check. */
export function IconSynced({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 12.5 10 18 19.5 6.5" />
    </svg>
  );
}

/** Syncing or queued: an upward transfer. */
export function IconSyncing({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 19.5V5" />
      <path d="M6.5 10.5 12 5l5.5 5.5" />
    </svg>
  );
}

/** Needs attention. */
export function IconAttention({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.4v.2" strokeWidth="2.2" />
    </svg>
  );
}

export function IconClose({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconBack({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14.5 5 7.5 12l7 7" />
    </svg>
  );
}
