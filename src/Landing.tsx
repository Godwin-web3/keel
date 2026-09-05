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
        <h1>Commit first.<br/>Reveal later.</h1>
        <p>
          A cryptographic commit–reveal layer for Somnia Event Contracts.
          Keel lets an intent be committed on-chain without immediately exposing its outcome.
        </p>
        <div className="hero-actions">
          <button onClick={() => onLaunch()}>Launch app</button>
          <button className="ghost" onClick={() => window.open('https://github.com/Godwin-web3/keel', '_blank')}>View source</button>
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
          <strong>1. Commit</strong>
          <span>A commitment binding the market, side, amount, and a salt is secured on-chain. The specific outcome is kept opaque.</span>
        </li>
        <li>
          <strong>2. Verify & Hold</strong>
          <span>KeelSeal escrows the collateral. The network enforces authorization, valid deadlines, and replay resistance.</span>
        </li>
        <li>
          <strong>3. Reveal</strong>
          <span>The user unseals the original parameters. Keel verifies the commitment hash on-chain before passing execution to DreamDEX. If the deadline passes without a reveal, funds can be cleanly refunded.</span>
        </li>
      </ul>

      <div className="chapter">
        <div className="chapter-index">ARCH</div>
        <div>
          <h2>Event Contracts, Composability</h2>
          <p className="chapter-line">
            Keel acts as an application-specific protocol layer extending DreamDEX.
          </p>
          <p>
            It provides a composable boundary around Event Contract execution.
            While DreamDEX natively handles public event lifecycle execution, KeelSeal provides an upstream escrow state machine explicitly for commit-reveal sequences.
            Currently active on the Shannon Testnet.
          </p>
        </div>
      </div>

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
