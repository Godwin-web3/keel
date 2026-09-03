type IconProps = { size?: number };

const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function KeelMark({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 19 L12 4 L19 19" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 20 H20" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function MenuIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="4.2" />
      <line x1="12" y1="1.5" x2="12" y2="4.2" />
      <line x1="12" y1="19.8" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="4.2" y2="12" />
      <line x1="19.8" y1="12" x2="22.5" y2="12" />
      <line x1="4.6" y1="4.6" x2="6.5" y2="6.5" />
      <line x1="17.5" y1="17.5" x2="19.4" y2="19.4" />
      <line x1="4.6" y1="19.4" x2="6.5" y2="17.5" />
      <line x1="17.5" y1="6.5" x2="19.4" y2="4.6" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function TrophyIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H4.5A2.5 2.5 0 0 0 6 9.3" />
      <path d="M16 5h3.5A2.5 2.5 0 0 1 18 9.3" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <line x1="8.5" y1="20" x2="15.5" y2="20" />
      <line x1="12" y1="17" x2="12" y2="20" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M10 6H5.5A1.5 1.5 0 0 0 4 7.5v11A1.5 1.5 0 0 0 5.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
      <path d="M14 4h6v6" />
      <line x1="10" y1="14" x2="20" y2="4" />
    </svg>
  );
}

export function CoinsIcon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <ellipse cx="9" cy="7" rx="5.5" ry="3" />
      <path d="M3.5 7v4c0 1.66 2.46 3 5.5 3s5.5-1.34 5.5-3V7" />
      <path d="M3.5 11v4c0 1.66 2.46 3 5.5 3 .6 0 1.18-.05 1.7-.15" />
      <path d="M12 12.3c.7 1.16 2.5 2 4.5 2 3.04 0 5.5-1.34 5.5-3s-2.46-3-5.5-3c-.46 0-.9.03-1.33.09" />
      <path d="M12 16.3c.7 1.16 2.5 2 4.5 2 3.04 0 5.5-1.34 5.5-3v-4" />
    </svg>
  );
}

export function SpinnerIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
