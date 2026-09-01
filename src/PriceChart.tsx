import type { ProbabilityPoint } from "./lib/sdk";

type Props = {
  points: ProbabilityPoint[];
  height?: number;
};

/** A light line chart of a window's implied Up-probability over time — no charting library, just an SVG polyline. */
export default function PriceChart({ points, height = 96 }: Props) {
  if (points.length < 2) {
    return (
      <div className="price-chart empty" style={{ height }}>
        <span className="muted">Not enough trades yet to chart this window.</span>
      </div>
    );
  }

  const width = 320;
  const pad = 4;
  const xs = points.map((p) => p.t);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = maxX - minX || 1;

  const toXY = (p: ProbabilityPoint) => {
    const x = pad + ((p.t - minX) / spanX) * (width - pad * 2);
    const y = pad + (1 - p.probUp) * (height - pad * 2);
    return [x, y] as const;
  };

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${toXY(p)[0].toFixed(1)},${toXY(p)[1].toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const trendUp = last.probUp >= first.probUp;
  const midY = pad + 0.5 * (height - pad * 2);

  return (
    <div className="price-chart">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1={pad} y1={midY} x2={width - pad} y2={midY} className="chart-mid" strokeDasharray="3 4" />
        <path d={path} className={`chart-line ${trendUp ? "up" : "down"}`} fill="none" strokeWidth={2} />
      </svg>
      <div className="chart-legend">
        <span className="muted">Implied chance of Up</span>
        <strong className={trendUp ? "up" : "down"}>{Math.round(last.probUp * 100)}%</strong>
      </div>
    </div>
  );
}
