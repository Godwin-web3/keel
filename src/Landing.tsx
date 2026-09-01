const FEATURES = [
  {
    title: "Markets",
    body: "Live BTC and ETH 15-minute and 1-hour windows, each reduced to a one-sentence ticket: chance, stake, redeem-if-win, max loss.",
  },
  {
    title: "Desk",
    body: "Every open position from your local journal in one place. Redeem all on settled windows, or select the next live window to roll.",
  },
  {
    title: "Journal",
    body: "Trades, redeems, and rolls stored in the browser, with transaction hashes when the SDK returns them. Nothing leaves your tab.",
  },
];

const STEPS = [
  { title: "Connect", body: "Read-only by default. Load live windows from the Somnia indexer without a key." },
  { title: "Read the ticket", body: "Chance to win, stake, redeem-if-win, and max loss, in one sentence." },
  { title: "Stake", body: "Paste a session key that cannot withdraw. Writes are refused unless the market is in Trading." },
  { title: "Redeem & roll", body: "Claim settled windows from the Desk, then roll straight into the next live window." },
];

const STACK = ["Vite", "React", "TypeScript", "@somnia-chain/markets-sdk", "viem", "Shannon testnet"];

const NETWORKS = [
  { label: "Chain ID", shannon: "50312", mainnet: "5031" },
  { label: "Collateral", shannon: "tUSDC (6 decimals)", mainnet: "USDso" },
  { label: "Indexer", shannon: "dev.smk.somnia.host", mainnet: "prd.smk.somnia.host" },
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
        <span className="eyebrow">Somnia × DreamDEX Event Contracts Hackathon</span>
        <h1>
          Event Contracts, <span className="accent">redeemed and rolled.</span>
        </h1>
        <p>
          Event Contract prices are Up probabilities between 0 and 1. Windows expire and respawn. Winnings do not
          arrive in the wallet until someone redeems them. Keel is the missing layer: a fixed-line ticket for every
          window, a desk that redeems what settled, and a journal that remembers what you did.
        </p>
        <div className="hero-actions">
          <button onClick={onLaunch}>Launch app</button>
          <button className="ghost" onClick={onLaunch}>
            View live windows, no key needed
          </button>
        </div>
        <p className="hero-note">Shannon testnet by default · session keys only · nothing uploaded</p>
      </header>

      <p className="section-label">What it does</p>
      <div className="feature-grid">
        {FEATURES.map((f, i) => (
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

      <div className="stack-strip">
        {STACK.map((s) => (
          <span className="pill" key={s}>
            {s}
          </span>
        ))}
      </div>

      <p className="section-label">Networks</p>
      <div className="network-card">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Shannon testnet</th>
              <th>Mainnet</th>
            </tr>
          </thead>
          <tbody>
            {NETWORKS.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>{row.shannon}</td>
                <td>{row.mainnet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="limits">
        <h3>Known limits</h3>
        <ul>
          <li>Position discovery for unjournaled historical holdings needs ERC-6909 balance reads; this MVP tracks fills through the local journal plus live market status.</li>
          <li>Indexer lag is real — status is re-read on-chain before every write.</li>
          <li>Use a session key that cannot withdraw. It stays in this browser tab and is never uploaded.</li>
        </ul>
      </div>

      <footer className="landing-footer">
        <span>Built for DoraHacks · deadline 8 September 2026</span>
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
