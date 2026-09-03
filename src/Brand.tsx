export function BtcMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#f7931a" />
      <text
        x="20"
        y="26"
        textAnchor="middle"
        fill="#fff"
        fontSize="18"
        fontWeight="700"
        fontFamily="Outfit, system-ui, sans-serif"
      >
        ₿
      </text>
    </svg>
  );
}

export function EthMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#627eea" />
      <path d="M20 8 L28 20 L20 16.5 L12 20 Z" fill="#fff" />
      <path d="M20 17.2 L28 20.4 L20 32 L12 20.4 Z" fill="#c7d2fe" />
    </svg>
  );
}

export function AssetAvatar({ asset, size = 40 }: { asset: "BTC" | "ETH" | "OTHER"; size?: number }) {
  if (asset === "ETH") return <EthMark size={size} />;
  if (asset === "BTC") return <BtcMark size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#2a3140" />
      <circle cx="20" cy="20" r="6" fill="#8b9aab" />
    </svg>
  );
}

export function ChanceMeter({ pct, size = 52 }: { pct: number; size?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="chance-meter">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#2a303c" strokeWidth="4" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="#3ddc8a"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="650" fontFamily="inherit">
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

export function Identicon({ seed, size = 32 }: { seed: string; size?: number }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 40 + (Math.abs(h >> 8) % 80)) % 360;
  const cells = Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 3 }, (_, x) => ((h >> (y * 3 + x)) & 1) === 1),
  );
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" className="identicon">
      <rect width="5" height="5" fill={`hsl(${hue} 38% 16%)`} />
      {cells.map((row, y) =>
        row.map((on, x) => {
          if (!on) return null;
          const fill = `hsl(${hue2} 62% 52%)`;
          return (
            <g key={`${x}-${y}`}>
              <rect x={x} y={y} width="1" height="1" fill={fill} />
              {x < 2 && <rect x={4 - x} y={y} width="1" height="1" fill={fill} />}
            </g>
          );
        }),
      )}
    </svg>
  );
}

export function RankMedal({ rank }: { rank: number }) {
  if (rank > 3) return <span className="rank-n">{rank}</span>;
  const fill = rank === 1 ? "#f5c542" : rank === 2 ? "#c5cdd8" : "#d08a4c";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="rank-medal" aria-label={`Rank ${rank}`}>
      <circle cx="14" cy="14" r="12" fill={fill} />
      <text x="14" y="18.5" textAnchor="middle" fill="#12151c" fontSize="12" fontWeight="700">
        {rank}
      </text>
    </svg>
  );
}
