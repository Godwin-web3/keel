import { useEffect, useState } from "react";
import { AssetAvatar, ChanceMeter } from "./Brand";
import { LogoWordmark } from "./Logo";
import PriceChart from "./PriceChart";
import { formatCloseLabel, formatWindow } from "./lib/format";
import { getMarketProbabilityHistory, type ProbabilityPoint } from "./lib/sdk";
import type { WindowMarket } from "./lib/types";

export default function Landing({
  onLaunch,
  markets,
  nowMs,
}: {
  onLaunch: (marketId?: string) => void;
  markets: WindowMarket[];
  nowMs: number;
}) {
  const featured = markets.find((m) => m.status === "trading") ?? markets[0] ?? null;
  const [points, setPoints] = useState<ProbabilityPoint[]>([]);

  useEffect(() => {
    if (!featured) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    void getMarketProbabilityHistory(featured).then((pts) => {
      if (!cancelled) setPoints(pts);
    });
    return () => {
      cancelled = true;
    };
  }, [featured?.marketId]);

  const upPct = featured?.impliedUp == null ? null : Math.round(featured.impliedUp * 100);
  const secondsLeft = featured ? (featured.expirySec ? featured.expirySec - nowMs / 1000 : featured.secondsLeft) : 0;

  return (
    <div className="landing">
      <nav className="app-nav">
        <LogoWordmark />
        <button className="connect-cta" onClick={() => onLaunch()}>
          Open app
        </button>
      </nav>

      <header className="land-hero">
        <h1>Bet if Bitcoin or Ethereum goes up or down.</h1>
        <p>
          Pick a side. Combine two coins. Or keep going until you hit a limit. You get paid in USDso when the round
          ends.
        </p>
        <div className="hero-actions">
          <button onClick={() => onLaunch()}>Start betting</button>
        </div>
      </header>

      {featured && (
        <article className="pm-card land-feature">
          <div className="pm-top">
            <AssetAvatar asset={featured.asset} size={42} />
            <div className="pm-copy">
              <p className="pm-kicker">
                {featured.status === "trading" && <span className="live-pip" />}
                Live · {featured.asset} · {formatWindow(featured.timeframe)}
              </p>
              <h3>
                Will {featured.asset} go up in the next {formatWindow(featured.timeframe)}?
              </h3>
            </div>
            {upPct !== null && <ChanceMeter pct={upPct} />}
          </div>
          <PriceChart points={points} height={140} />
          <div className="pm-actions">
            <button className="pm-up" onClick={() => onLaunch(featured.marketId)}>
              Up {upPct === null ? "" : `${upPct}%`}
            </button>
            <button className="pm-down" onClick={() => onLaunch(featured.marketId)}>
              Down {upPct === null ? "" : `${100 - upPct}%`}
            </button>
          </div>
          <p className="pm-meta">{formatCloseLabel(featured.expirySec, secondsLeft)}</p>
        </article>
      )}

      <ul className="land-points">
        <li>
          <strong>Two coins, one bet.</strong>
          <span>BTC and ETH in the same round. You only get paid if both are right.</span>
        </li>
        <li>
          <strong>A run that stops itself.</strong>
          <span>Set cash out, stop loss, and max rounds. Keel keeps going until a limit hits.</span>
        </li>
        <li>
          <strong>Paid when it ends.</strong>
          <span>Winnings don't show up by themselves. Keel collects them for you.</span>
        </li>
      </ul>

      <footer className="landing-footer">
        <span>Keel</span>
        <div className="links">
          <a href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://docs.dreamdex.io/developers/event-contracts" target="_blank" rel="noreferrer">
            How it works
          </a>
        </div>
      </footer>
    </div>
  );
}
