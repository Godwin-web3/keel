/** Keel lockup — mint keel cutting a waterline. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#12151c" />
      <path d="M16 5 L26 23 H6 Z" fill="#00d4a4" />
      <path d="M16 11 L22 22 H10 Z" fill="#12151c" />
      <rect x="5" y="24.2" width="22" height="2.2" rx="1.1" fill="#00d4a4" />
    </svg>
  );
}

export function LogoWordmark() {
  return (
    <span className="brand-lockup">
      <Logo size={30} />
      <span className="brand-name">Keel</span>
    </span>
  );
}
