import CountdownRing from "./CountdownRing";
import { KeelMark } from "./Icons";

const INSTRUMENTS = [
  {
    kicker: "01",
    name: "Parlay",
    line: "Two windows. One stake.",
    body: "BTC and ETH in the same minute. Combined odds. The book cannot quote this — it only lists atoms.",
  },
  {
    kicker: "02",
    name: "Run",
    line: "N windows. Hard rails.",
    body: "Cash-out, stop-loss, max rounds. Keel claims, restakes the successor, and stops itself.",
  },
  {
    kicker: "03",
    name: "Claim",
    line: "Settlement that pays.",
    body: "Event Contracts never send winnings. Keel watches your open windows and pulls USDso when they finalize.",
  },
];

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing">
      <nav className="app-nav">
        <span className="wordmark">
          <span className="mark" aria-hidden>
            <KeelMark />
          </span>
          Keel
        </span>
        <div className="row" style={{ margin: 0 }}>
          <a className="repo-link" href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
            Source
          </a>
          <button className="cta" onClick={onLaunch}>
            Open the desk
          </button>
        </div>
      </nav>

      <header className="hero">
        <p className="kicker">Somnia · Event Contracts</p>
        <h1>
          The venue sells a window.
          <em> Keel sells the session.</em>
        </h1>
        <p className="hero-lede">
          Parlay two assets. Ride a run that halts on rails. Get paid when the window settles — because the protocol
          will not send it to you.
        </p>
        <div className="hero-actions">
          <button onClick={onLaunch}>Browse live windows</button>
          <button className="ghost" onClick={onLaunch}>
            Start a run
          </button>
        </div>
      </header>

      <div className="instrument-grid">
        <article className="instrument-card">
          <header>
            <span>Parlay</span>
            <CountdownRing secondsLeft={134} totalSeconds={300} size={22} />
          </header>
          <p className="instrument-pair">
            BTC <b className="up">Up</b>
            <i>×</i>
            ETH <b className="down">Down</b>
          </p>
          <div className="ticket-math">
            <div>
              <span>Stake</span>
              10.00
            </div>
            <div>
              <span>Both hit</span>
              34.20
            </div>
            <div>
              <span>Combined</span>
              29%
            </div>
          </div>
          <p className="muted">One ticket. Two independent Event Contracts. Both must hit.</p>
        </article>

        <article className="instrument-card">
          <header>
            <span>Run</span>
            <em className="live-dot">Riding</em>
          </header>
          <ol className="run-preview">
            <li>
              <span>Hop 1</span> 10.00 <b className="up">win</b>
            </li>
            <li>
              <span>Hop 2</span> 15.40 <b className="up">win</b>
            </li>
            <li className="now">
              <span>Hop 3</span> 18.00 <b>cash-out</b>
            </li>
          </ol>
          <p className="muted">Rails: cash 18 · stop 5 · max 5. The venue cannot halt this.</p>
        </article>

        <article className="instrument-card">
          <header>
            <span>Claim</span>
            <em className="live-dot watching">Watching</em>
          </header>
          <p className="claim-copy">
            MarketFinalized
            <br />
            <strong>redeem → wallet</strong>
          </p>
          <p className="muted">Winners pull. Losers skip (they pay 0). Voids redeem both sides at 0.5.</p>
        </article>
      </div>

      <div className="waterline" aria-hidden />

      {INSTRUMENTS.map((item) => (
        <section className="chapter" key={item.name}>
          <div className="chapter-index">{item.kicker}</div>
          <div>
            <h2>{item.name}</h2>
            <p className="chapter-line">{item.line}</p>
            <p>{item.body}</p>
          </div>
        </section>
      ))}

      <section className="close-band">
        <h2>A session, not a feed.</h2>
        <p>
          Polymarket is a catalog of questions. Keel is a clock: five-minute windows, composed, ridden, and paid.
          Connect a wallet only when you are ready to write.
        </p>
        <button onClick={onLaunch}>Open the desk</button>
      </section>

      <footer className="landing-footer">
        <span>Somnia × DreamDEX</span>
        <div className="links">
          <a href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://docs.dreamdex.io/developers/event-contracts" target="_blank" rel="noreferrer">
            Event Contracts
          </a>
        </div>
      </footer>
    </div>
  );
}

