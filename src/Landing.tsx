import CountdownRing from "./CountdownRing";
import PriceChart from "./PriceChart";
import type { ProbabilityPoint } from "./lib/sdk";

const DEMO_CHART: ProbabilityPoint[] = [0.5, 0.53, 0.58, 0.55, 0.6, 0.64, 0.61, 0.66, 0.69, 0.65].map((p, i) => ({
  t: Date.now() - (10 - i) * 60_000,
  probUp: p,
}));

const BENEFITS = [
  {
    title: "Parlay two windows the venue cannot list",
    body: "BTC Up and ETH Down in the same minute. Combined payout. DreamDEX sells atoms. Keel sells the molecule.",
  },
  {
    title: "A run with rails, not a checkbox",
    body: "Start with $10. Cash out at $18. Stop at $5. Max five windows. Keel claims, restakes the successor, and halts itself.",
  },
  {
    title: "Settlement that pays you",
    body: "Event Contracts never send winnings. Keel watches MarketFinalized on your open windows and pulls the USDso — no Claim tap.",
  },
];

const STEPS = [
  { title: "Call one side — or parlay both assets", body: "One window, or BTC × ETH in the same breath." },
  { title: "Start a run", body: "Set cash-out, stop-loss, max rounds. Keel rides successors until a rail hits." },
  { title: "Get paid", body: "Winners redeem as they settle. Losers are skipped. Voids return both sides." },
];

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing">
      <nav className="app-nav">
        <span className="wordmark">
          <span className="mark">K</span>
          Keel
        </span>
        <div className="row" style={{ margin: 0 }}>
          <a className="repo-link" href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
            View source
          </a>
          <button className="cta" onClick={onLaunch}>
            Launch app
          </button>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <span className="kicker">Live on Somnia</span>
          <h1>
            Not a market. <span className="accent">A session.</span>
          </h1>
          <p>
            Parlay BTC × ETH in one ticket. Ride a run that stops itself. Get paid when the window settles — the venue
            will not send it.
          </p>
          <div className="hero-actions">
            <button onClick={onLaunch}>Launch app — free to browse</button>
          </div>
          <p className="hero-note">No sign-up · connect a wallet only when you're ready to bet</p>
        </div>

        <div className="card demo-ticket">
          <h2>Parlay</h2>
          <p className="plain">BTC Up × ETH Down · same window</p>
          <PriceChart points={DEMO_CHART} />
          <div className="market-top" style={{ margin: "14px 0" }}>
            <span className="round-slot" style={{ color: "var(--up)" }}>
              Live
            </span>
            <CountdownRing secondsLeft={134} totalSeconds={300} size={26} />
          </div>
          <div className="ticket-math">
            <div>
              <span>Both hit</span>
              34.20
            </div>
            <div>
              <span>Combined</span>
              29%
            </div>
            <div>
              <span>Most you can lose</span>
              10.00
            </div>
          </div>
          <div className="actions">
            <button className="up" tabIndex={-1}>
              Up × Down
            </button>
            <button className="down" tabIndex={-1}>
              Down × Up
            </button>
          </div>
        </div>
      </header>

      <p className="section-label">Why it feels different</p>
      <div className="benefit-list">
        {BENEFITS.map((f, i) => (
          <div className="benefit-row" key={f.title}>
            <div className="num">0{i + 1}</div>
            <div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="section-label">How it works</p>
      <div className="step-flow">
        {STEPS.map((s, i) => (
          <div className="step" key={s.title}>
            <div className="num">0{i + 1}</div>
            <h4>{s.title}</h4>
            <p>{s.body}</p>
          </div>
        ))}
      </div>

      <footer className="landing-footer">
        <span>Built for the Somnia × DreamDEX hackathon</span>
        <div className="links">
          <a href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://docs.dreamdex.io/developers/event-contracts" target="_blank" rel="noreferrer">
            Event Contracts docs
          </a>
        </div>
      </footer>
    </div>
  );
}
