import CountdownRing from "./CountdownRing";
import PriceChart from "./PriceChart";
import type { ProbabilityPoint } from "./lib/sdk";

const DEMO_CHART: ProbabilityPoint[] = [0.5, 0.53, 0.58, 0.55, 0.6, 0.64, 0.61, 0.66, 0.69, 0.65].map((p, i) => ({
  t: Date.now() - (10 - i) * 60_000,
  probUp: p,
}));

const BENEFITS = [
  {
    title: "Windows that settle fast",
    body: "BTC and ETH windows close in as little as 5 minutes. Call it, and find out before your coffee's cold.",
  },
  {
    title: "Know your numbers upfront",
    body: "Every bet shows exactly what you win and exactly what you can lose, before you tap anything. No surprises.",
  },
  {
    title: "Browse for free",
    body: "Watch live odds and countdowns without connecting a thing. Connect only when you're ready to bet.",
  },
];

const STEPS = [
  { title: "Pick a side", body: "Tap Up or Down on any live BTC or ETH window." },
  { title: "Watch it move", body: "The odds shift live as the window counts down to close." },
  { title: "Collect your winnings", body: "Auto-claim it, or come back and tap once. Either way, it's yours." },
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
        <span className="eyebrow">Live on Somnia</span>
        <h1>
          Call it. <span className="accent">Up or Down.</span>
        </h1>
        <p>
          Bitcoin and Ethereum price windows that settle in minutes. Pick a side, watch it move, collect if you're
          right.
        </p>
        <div className="hero-actions">
          <button onClick={onLaunch}>Launch app — free to browse</button>
        </div>
        <p className="hero-note">No sign-up · connect a wallet only when you're ready to bet</p>
      </header>

      <p className="section-label">What it looks like</p>
      <div className="demo-grid">
        <div className="card demo-market">
          <div className="round-group-head">
            <span className="asset-icon">₿</span>
            BTC · 5m
          </div>
          <article className="round-card live demo-card">
            <div className="market-top">
              <span className="round-slot">Live</span>
              <CountdownRing secondsLeft={134} totalSeconds={300} size={30} />
            </div>
            <div className="odds-bar">
              <div className="odds-bar-up" style={{ width: "65%" }} />
              <div className="odds-bar-down" style={{ width: "35%" }} />
            </div>
            <div className="odds-labels">
              <span className="odds-up">Up 65%</span>
              <span className="odds-down">Down 35%</span>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
              Closes 2m 14s · 4:12 PM
            </div>
          </article>
        </div>

        <div className="card demo-ticket">
          <h2>Place your bet</h2>
          <p className="plain">BTC · Up or Down in 5m</p>
          <PriceChart points={DEMO_CHART} />
          <div className="ticket-math">
            <div>
              <span>You win if Up</span>
              15.38
            </div>
            <div>
              <span>You win if Down</span>
              28.57
            </div>
            <div>
              <span>Most you can lose</span>
              10.00
            </div>
          </div>
          <div className="actions">
            <button className="up" tabIndex={-1}>
              Bet Up
            </button>
            <button className="down" tabIndex={-1}>
              Bet Down
            </button>
          </div>
        </div>
      </div>

      <p className="section-label">Why it feels different</p>
      <div className="feature-grid">
        {BENEFITS.map((f, i) => (
          <div className="feature-card" key={f.title}>
            <div className="num">0{i + 1}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>

      <p className="section-label">How it works</p>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div className="step" key={s.title}>
            <div className="num">{i + 1}</div>
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
