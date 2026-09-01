import { useEffect, useMemo, useState } from "react";
import type { JournalRow, NetworkName, Side, WindowMarket } from "./lib/types";
import {
  ASSET_ICON,
  detectAsset,
  formatCloseLabel,
  formatProb,
  formatUsd,
  plainLanguage,
  quoteTicket,
  shorten,
  STATUS_LABEL,
} from "./lib/format";
import { appendJournal, loadJournal } from "./lib/journal";
import { connectExchange, derivePositions, disconnectExchange, listWindows, maskKey, placeStake, redeemMarket } from "./lib/sdk";
import Landing from "./Landing";

type Tab = "markets" | "desk";

const DEFAULT_STAKE = 10;
const APP_HASH = "#/app";
const KIND_LABEL: Record<JournalRow["kind"], string> = {
  trade: "Bet placed",
  redeem: "Claimed",
  roll: "Rolled",
  note: "Note",
};

function isAppRoute(): boolean {
  return window.location.hash === APP_HASH;
}

export default function App() {
  const [entered, setEntered] = useState(isAppRoute);
  const [tab, setTab] = useState<Tab>("markets");
  const [network, setNetwork] = useState<NetworkName>("shannon");
  const [privateKey, setPrivateKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [markets, setMarkets] = useState<WindowMarket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [rollAfterRedeem, setRollAfterRedeem] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setJournal(loadJournal());
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function sync() {
      setEntered(isAppRoute());
    }
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  function enterApp() {
    history.pushState(null, "", APP_HASH);
    setEntered(true);
  }

  function exitToLanding() {
    history.pushState(null, "", window.location.pathname + window.location.search);
    setEntered(false);
  }

  const selected = markets.find((m) => m.marketId === selectedId) ?? markets[0] ?? null;
  const quote = selected ? quoteTicket("up", stake, selected.impliedUp) : null;
  const { open, claimable } = useMemo(() => derivePositions(markets, journal), [markets, journal]);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const rows = await listWindows();
      setMarkets(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].marketId);
      setMessage({ kind: "ok", text: `Found ${rows.length} window${rows.length === 1 ? "" : "s"} to bet on.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    setBusy(true);
    setMessage(null);
    try {
      await connectExchange({
        network,
        privateKey: privateKey.trim() || undefined,
      });
      setConnected(true);
      const rows = await listWindows();
      setMarkets(rows);
      if (rows[0]) setSelectedId(rows[0].marketId);
      setMessage({ kind: "ok", text: `Loaded ${rows.length} Event Contract window${rows.length === 1 ? "" : "s"}.` });
    } catch (err) {
      setConnected(false);
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  function onDisconnect() {
    disconnectExchange();
    setConnected(false);
    setMarkets([]);
    setMessage({ kind: "ok", text: "Disconnected. Your wallet key was never saved anywhere." });
  }

  async function onTrade(side: Side) {
    if (!selected) return;
    const q = quoteTicket(side, stake, selected.impliedUp);
    setBusy(true);
    setMessage(null);
    try {
      const result = await placeStake({ market: selected, side, stake });
      const rows = appendJournal({
        kind: "trade",
        marketId: selected.marketId,
        symbol: selected.symbol,
        side,
        stake,
        entryProb: q.entryProb,
        result: "pending",
        hash: result.hash,
        note: plainLanguage(selected, stake, side),
      });
      setJournal(rows);
      setTab("desk");
      setMessage({ kind: "ok", text: `Bet placed${result.hash ? ` · ${shorten(result.hash)}` : ""}.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem(marketId: string, symbol: string, side: Side) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await redeemMarket(marketId, side);
      const note =
        result.result === "void"
          ? "Window cancelled - your bet was returned"
          : result.result === "win"
            ? "You won - claimed"
            : result.result === "loss"
              ? "You lost this one - claimed"
              : "Claimed - outcome unconfirmed";
      appendJournal({
        kind: "redeem",
        marketId,
        symbol,
        result: result.result,
        hash: result.hash,
        note,
      });

      if (rollAfterRedeem) {
        const next = markets.find((m) => m.status === "trading" && m.marketId !== marketId);
        if (next) {
          appendJournal({
            kind: "roll",
            marketId: next.marketId,
            symbol: next.symbol,
            note: `Lined up ${next.asset} ${next.timeframe}`,
          });
          setSelectedId(next.marketId);
          setTab("markets");
          setJournal(loadJournal());
          setMessage({
            kind: "ok",
            text: `Claimed. Picked your next window: ${next.asset} ${next.timeframe} — place it on Markets.`,
          });
          setBusy(false);
          return;
        }
      }

      setJournal(loadJournal());
      setMessage({ kind: "ok", text: `Claimed${result.hash ? ` · ${shorten(result.hash)}` : ""}.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!entered) {
    return <Landing onLaunch={enterApp} />;
  }

  return (
    <div className="app">
      <nav className="app-nav">
        <button className="wordmark" onClick={exitToLanding}>
          <span className="mark">K</span>
          Keel
        </button>
        <a className="repo-link" href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
          View source
        </a>
      </nav>
      <header className="top">
        <div className="brand">
          <h1>Keel</h1>
          <p>
            Bet on whether Bitcoin or Ethereum goes up or down in the next few minutes. Come back
            after it settles to collect what you won.
          </p>
        </div>
        <div className="session">
          <label>Network</label>
          <div className="row">
            <select value={network} onChange={(e) => setNetwork(e.target.value as NetworkName)} disabled={connected}>
              <option value="shannon">Test network (practice money)</option>
              <option value="mainnet">Somnia mainnet (real money)</option>
            </select>
          </div>
          <label>Wallet key (only needed to bet — browsing is free)</label>
          <div className="row">
            <input
              type="password"
              placeholder="0x... a spending key, never your main wallet"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              disabled={connected}
              autoComplete="off"
            />
          </div>
          <div className="row">
            {connected ? (
              <>
                <button className="ghost" onClick={() => void refresh()} disabled={busy}>
                  Refresh
                </button>
                <button className="ghost" onClick={onDisconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button onClick={() => void onConnect()} disabled={busy}>
                {busy ? "Connecting..." : "Connect"}
              </button>
            )}
          </div>
          <div className="muted">
            {connected
              ? `Connected${privateKey ? ` · ${maskKey(privateKey)}` : " · just browsing"}`
              : "You can look around for free. Betting needs a wallet key."}
          </div>
        </div>
      </header>

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <div className="tabs">
        <button className={tab === "markets" ? "active" : ""} onClick={() => setTab("markets")}>
          Markets
        </button>
        <button className={tab === "desk" ? "active" : ""} onClick={() => setTab("desk")}>
          My bets{claimable.length > 0 ? ` · ${claimable.length} to claim` : ""}
        </button>
      </div>

      {tab === "markets" && (
        <div className="grid">
          <section className="card">
            <h2>Will it go up or down?</h2>
            {!connected && <p className="muted">Connect to see live BTC and ETH windows.</p>}
            {connected && markets.length === 0 && (
              <p className="muted">No windows returned right now. Try refreshing in a moment.</p>
            )}
            {markets.map((m) => {
              const upPct = m.impliedUp === null ? null : Math.round(m.impliedUp * 100);
              const secondsLeft = m.expirySec ? m.expirySec - nowMs / 1000 : m.secondsLeft;
              return (
                <article
                  key={m.marketId}
                  className={`market ${selected?.marketId === m.marketId ? "selected" : ""}`}
                  onClick={() => setSelectedId(m.marketId)}
                >
                  <div className="market-top">
                    <strong className="market-name">
                      <span className="asset-icon">{ASSET_ICON[m.asset]}</span>
                      {m.asset} <span className="muted">· {m.timeframe}</span>
                    </strong>
                    <span className={`badge ${m.status}`}>{STATUS_LABEL[m.status]}</span>
                  </div>
                  <div className="odds-bar">
                    <div className="odds-bar-up" style={{ width: `${upPct ?? 50}%` }} />
                    <div className="odds-bar-down" style={{ width: `${100 - (upPct ?? 50)}%` }} />
                  </div>
                  <div className="odds-labels">
                    <span className="odds-up">Up {upPct === null ? "—" : `${upPct}%`}</span>
                    <span className="odds-down">Down {upPct === null ? "—" : `${100 - upPct}%`}</span>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>
                    {formatCloseLabel(m.expirySec, secondsLeft)}
                  </div>
                </article>
              );
            })}
          </section>

          <section className="card">
            <h2>Place your bet</h2>
            {!selected && <p className="muted">Pick a window on the left.</p>}
            {selected && quote && (
              <>
                <p className="plain">{plainLanguage(selected, stake, "up")}</p>
                <label className="stake-label">
                  How much do you want to bet?
                  <div className="stake-input">
                    <span>$</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={stake}
                      onChange={(e) => setStake(Number(e.target.value))}
                    />
                  </div>
                </label>
                <div className="ticket-math">
                  <div>
                    <span>You win if Up</span>
                    {formatUsd(quoteTicket("up", stake, selected.impliedUp).redeemIfWin)}
                  </div>
                  <div>
                    <span>You win if Down</span>
                    {formatUsd(quoteTicket("down", stake, selected.impliedUp).redeemIfWin)}
                  </div>
                  <div>
                    <span>Most you can lose</span>
                    {formatUsd(stake)}
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="up"
                    disabled={busy || !privateKey || selected.status !== "trading"}
                    onClick={() => void onTrade("up")}
                  >
                    Bet Up
                  </button>
                  <button
                    className="down"
                    disabled={busy || !privateKey || selected.status !== "trading"}
                    onClick={() => void onTrade("down")}
                  >
                    Bet Down
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  {selected.status !== "trading"
                    ? "This window isn't open for new bets right now."
                    : !privateKey
                      ? "Add a session key above to place a bet."
                      : "You can only lose what you bet — never more."}
                </p>
              </>
            )}
          </section>
        </div>
      )}

      {tab === "desk" && (
        <div className="grid">
          <section className="card">
            <h2>Your bets</h2>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input type="checkbox" checked={rollAfterRedeem} onChange={(e) => setRollAfterRedeem(e.target.checked)} />
              After I claim, line up the next window automatically
            </label>
            <div className="actions" style={{ marginBottom: 14 }}>
              <button
                disabled={busy || claimable.length === 0 || !privateKey}
                onClick={() => {
                  void (async () => {
                    for (const item of claimable) {
                      await onRedeem(item.marketId, item.symbol, item.side);
                    }
                  })();
                }}
              >
                Claim all winnings
              </button>
            </div>
            <h3 className="muted">Still running</h3>
            {open.length === 0 && <p className="muted">No bets in progress yet.</p>}
            {open.map((p) => (
              <div key={p.marketId + p.side} className="market">
                <div className="market-top">
                  <strong className="market-name">
                    <span className="asset-icon">{ASSET_ICON[p.asset]}</span>
                    {p.asset} <span className="muted">· {p.timeframe}</span>
                  </strong>
                  <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </div>
                <div className="muted">
                  You bet {formatUsd(p.stake)} on <strong className={p.side}>{p.side === "up" ? "Up" : "Down"}</strong> at {formatProb(p.entryProb)} odds
                </div>
              </div>
            ))}
            <h3 className="muted">Ready to claim</h3>
            {claimable.length === 0 && (
              <p className="muted">Nothing to claim yet. Settled bets show up here.</p>
            )}
            {claimable.map((c) => (
              <div key={c.marketId} className="market">
                <div className="market-top">
                  <strong className="market-name">
                    <span className="asset-icon">{ASSET_ICON[c.asset]}</span>
                    {c.asset} <span className="muted">· {c.timeframe} · {c.side === "up" ? "Up" : "Down"}</span>
                  </strong>
                  <button disabled={busy || !privateKey} onClick={() => void onRedeem(c.marketId, c.symbol, c.side)}>
                    Claim {formatUsd(c.estimatedPayout)}
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Activity</h2>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Market</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {journal.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nothing yet. Your bets, claims, and rolls show up here, saved only on this device.
                    </td>
                  </tr>
                )}
                {journal.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.at).toLocaleString()}</td>
                    <td>{KIND_LABEL[row.kind]}</td>
                    <td>
                      <span className="asset-icon">{ASSET_ICON[detectAsset(row.symbol || row.marketId)]}</span>
                      {detectAsset(row.symbol || row.marketId)}
                    </td>
                    <td>
                      {row.side ? (row.side === "up" ? "Up" : "Down") + " · " : ""}
                      {row.stake !== undefined ? `$${formatUsd(row.stake)} · ` : ""}
                      {row.hash ? shorten(row.hash) : row.note || row.result || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
