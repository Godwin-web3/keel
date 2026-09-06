import { useEffect, useState } from "react";
import { AssetAvatar, ChanceMeter } from "./Brand";
import { ExternalLinkIcon } from "./Icons";
import { LogoWordmark } from "./Logo";
import PriceChart from "./PriceChart";
import { formatCloseLabel, formatWindow } from "./lib/format";
import { getMarketProbabilityHistory, type ProbabilityPoint } from "./lib/sdk";
import type { WindowMarket } from "./lib/types";

const GITHUB = "https://github.com/Godwin-web3/keel";
const DREAMDEX_DOCS = "https://docs.dreamdex.io/developers/event-contracts";
const LIVE_URL = "https://keel-black-phi.vercel.app";
const KEEL_SEAL = "0xc77d38feA2d04eF1F1870b5FE1f0Dd5f7B70a1C9";
const KEEL_SEAL_EXPLORER = `https://shannon-explorer.somnia.network/address/${KEEL_SEAL}`;

const STEPS = [
  {
    n: "01",
    title: "Commit",
    body: "Hash market, side, size, and a salt. Post the commitment on-chain. Observers see a seal — not Up or Down.",
  },
  {
    n: "02",
    title: "Hold",
    body: "KeelSeal escrows your tUSDC. Deadline and replay checks are enforced by the contract, not trust.",
  },
  {
    n: "03",
    title: "Reveal",
    body: "Unseal yourself, or leave and Keel auto-reveals in the last ~45s so the trade still places on DreamDEX.",
  },
  {
    n: "04",
    title: "Refund · Claim",
    body: "Refund anytime before auto-reveal to cancel — side never shown. After settlement, redeem winners from Positions.",
  },
] as const;

const APP_SURFACES = [
  {
    title: "Markets",
    body: "Live Event Contract windows — BTC, ETH, and more — with chance meters and Up / Down.",
  },
  {
    title: "Seal both",
    body: "Two sealed legs in one flow. Like a parlay, but each side stays hidden until you reveal.",
  },
  {
    title: "Positions",
    body: "Sealed tickets, open trades, and claimable wins — tap any row for detail, reveal, refund, or claim.",
  },
  {
    title: "Run",
    body: "Chain windows into a streak. Committed tickets stay the default path.",
  },
  {
    title: "Leaders",
    body: "See who’s ahead on the board — PnL and rank, not a raw dump of addresses.",
  },
] as const;

export default function Landing({
  onLaunch,
  markets,
  nowMs,
}: {
  onLaunch: (marketId?: string, side?: "up" | "down") => void;
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
  const secondsLeft = featured
    ? featured.expirySec
      ? featured.expirySec - nowMs / 1000
      : featured.secondsLeft
    : 0;

  return (
    <div className="landing">
      <nav className="land-nav">
        <LogoWordmark />
        <div className="land-nav-actions">
          <a className="land-nav-link" href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button type="button" className="connect-cta" onClick={() => onLaunch()}>
            Launch app
          </button>
        </div>
      </nav>

      <header className="land-hero">
        <p className="land-kicker">
          <span className="live-pip" />
          Somnia × DreamDEX · Event Contracts
        </p>
        <h1>
          Seal the side.
          <br />
          Reveal when you&apos;re ready.
        </h1>
        <p className="land-lede">
          Keel is a commit–reveal layer for DreamDEX Event Contracts. Seal hides your side on-chain until
          reveal. Leave and Keel auto-reveals in the last ~45s so the trade still executes; refund before
          then to cancel — side never shown. Seal is the default.
        </p>
        <div className="hero-actions">
          <button type="button" onClick={() => onLaunch()}>
            Launch app
          </button>
          <button type="button" className="ghost" onClick={() => window.open(GITHUB, "_blank")}>
            View source
          </button>
          <a className="land-text-link" href={DREAMDEX_DOCS} target="_blank" rel="noreferrer">
            DreamDEX docs <ExternalLinkIcon size={14} />
          </a>
        </div>
      </header>

      <section className="land-section" aria-labelledby="land-problem">
        <div className="land-section-head">
          <p className="land-eyebrow">Problem</p>
          <h2 id="land-problem">Public books telegraph intent</h2>
        </div>
        <div className="land-problem-grid">
          <p className="land-section-lede">
            DreamDEX Event Contracts are open by design: side, size, and wallet hit the book
            immediately. On short windows that&apos;s a gift to copy-traders and anyone watching for
            front-running.
          </p>
          <ul className="land-pain-list">
            <li>
              <strong>Side visible</strong>
              <span>Up or Down is public the moment you place.</span>
            </li>
            <li>
              <strong>Size + wallet</strong>
              <span>Stake and address sit on the feed for anyone to mirror.</span>
            </li>
            <li>
              <strong>Short clocks</strong>
              <span>Minutes-long windows leave no cover once intent is telegraphed.</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="land-section" aria-labelledby="land-product">
        <div className="land-section-head">
          <p className="land-eyebrow">Product</p>
          <h2 id="land-product">KeelSeal sits in front of DreamDEX</h2>
        </div>
        <p className="land-section-lede">
          Seal commits collateral with a cryptographic commitment. The chain sees a hash — not the
          side. Reveal unlocks placement; leave and auto-reveal fires in the last ~45s. Refund before
          then to cancel — the outcome was never shown.
        </p>
        <div className="land-product-grid">
          <article className="land-product-card land-product-card--accent">
            <p className="land-card-kicker">Default</p>
            <h3>Seal</h3>
            <p>
              Commit → escrow → reveal (or auto in the last ~45s) → DreamDEX place. Sealed-by-default
              on every market that can still clear before close.
            </p>
          </article>
          <article className="land-product-card">
            <p className="land-card-kicker">Double</p>
            <h3>Sealed both</h3>
            <p>
              Two legs, one flow — like a parlay, but each side stays opaque until you unseal on
              Positions.
            </p>
          </article>
          <article className="land-product-card">
            <p className="land-card-kicker">Safety</p>
            <h3>Refund before reveal</h3>
            <p>
              Cancel anytime before auto-reveal and get your stake back. Side stays hidden — never
              shown on-chain.
            </p>
          </article>
          <article className="land-product-card">
            <p className="land-card-kicker">After</p>
            <h3>Claim · Positions · Run</h3>
            <p>
              Track sealed and open tickets, redeem winners, and run streaks — supporting surfaces
              around Seal.
            </p>
          </article>
        </div>
      </section>

      <section className="land-section" aria-labelledby="land-how">
        <div className="land-section-head">
          <p className="land-eyebrow">How it works</p>
          <h2 id="land-how">Four steps. Side stays dark until reveal — or auto-reveal.</h2>
        </div>
        <ol className="land-steps">
          {STEPS.map((step) => (
            <li key={step.n} className="land-step">
              <span className="land-step-n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="land-section" aria-labelledby="land-live">
        <div className="land-section-head">
          <p className="land-eyebrow">Live market</p>
          <h2 id="land-live">Trade from the landing — or seal inside the app</h2>
        </div>
        {featured ? (
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
            <PriceChart points={points} height={140} liveUp={featured.impliedUp} />
            <div className="pm-actions">
              <button
                type="button"
                className="pm-up"
                disabled={upPct === null}
                onClick={() => onLaunch(featured.marketId, "up")}
              >
                {upPct === null ? "Loading…" : `Up ${upPct}%`}
              </button>
              <button
                type="button"
                className="pm-down"
                disabled={upPct === null}
                onClick={() => onLaunch(featured.marketId, "down")}
              >
                {upPct === null ? "Loading…" : `Down ${100 - upPct}%`}
              </button>
            </div>
            <p className="pm-meta">{formatCloseLabel(featured.expirySec, secondsLeft)}</p>
          </article>
        ) : (
          <div className="land-empty-market">
            <p className="land-empty-title">Markets loading</p>
            <p>
              The DreamDEX indexer is catching up. Open the app to browse windows, or refresh in a
              moment.
            </p>
            <button type="button" onClick={() => onLaunch()}>
              Open app
            </button>
          </div>
        )}
      </section>

      <section className="land-section" aria-labelledby="land-app">
        <div className="land-section-head">
          <p className="land-eyebrow">What&apos;s in the app</p>
          <h2 id="land-app">Everything around Seal</h2>
        </div>
        <div className="land-app-grid">
          {APP_SURFACES.map((item) => (
            <article key={item.title} className="land-app-card">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="land-section land-trust" aria-labelledby="land-network">
        <div className="land-section-head">
          <p className="land-eyebrow">Network · Trust</p>
          <h2 id="land-network">Shannon testnet. Canonical KeelSeal.</h2>
        </div>
        <div className="land-trust-grid">
          <div className="land-trust-card">
            <p className="land-card-kicker">Chain</p>
            <p className="land-trust-value">Shannon · 50312</p>
            <p className="land-trust-note">tUSDC collateral. Somnia mainnet selectable in the wallet sheet.</p>
          </div>
          <div className="land-trust-card">
            <p className="land-card-kicker">KeelSeal</p>
            <a
              className="land-trust-addr"
              href={KEEL_SEAL_EXPLORER}
              target="_blank"
              rel="noreferrer"
            >
              {KEEL_SEAL.slice(0, 10)}…{KEEL_SEAL.slice(-8)}
              <ExternalLinkIcon size={14} />
            </a>
            <p className="land-trust-note">Canonical escrow on Shannon — no per-wallet deploy on first commit.</p>
          </div>
          <div className="land-trust-card">
            <p className="land-card-kicker">Live</p>
            <a className="land-trust-value land-trust-link" href={LIVE_URL} target="_blank" rel="noreferrer">
              keel-black-phi.vercel.app
              <ExternalLinkIcon size={14} />
            </a>
            <p className="land-trust-note">Wallet connect only. Browse markets without connecting.</p>
          </div>
        </div>
      </section>

      <section className="land-close">
        <h2>Ready to seal a window?</h2>
        <p>Open the app, pick a live market, and seal with the side hidden — reveal yourself or let auto-reveal place it.</p>
        <div className="hero-actions">
          <button type="button" onClick={() => onLaunch()}>
            Launch app
          </button>
          <button type="button" className="ghost" onClick={() => window.open(GITHUB, "_blank")}>
            View source
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <span>Keel · Somnia × DreamDEX</span>
        <div className="links">
          <a href={GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={DREAMDEX_DOCS} target="_blank" rel="noreferrer">
            DreamDEX docs
          </a>
          <a href={LIVE_URL} target="_blank" rel="noreferrer">
            Live
          </a>
          <a href={KEEL_SEAL_EXPLORER} target="_blank" rel="noreferrer">
            KeelSeal
          </a>
        </div>
      </footer>
    </div>
  );
}
