import { useEffect, useMemo, useRef, useState } from "react";
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
  const [signedIn, setSignedIn] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const ticketRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [markets, setMarkets] = useState<WindowMarket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [rollAfterRedeem, setRollAfterRedeem] = useState(true);
  const [autoClaim, setAutoClaim] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const refreshingRef = useRef(false);
  const autoClaimingRef = useRef<Set<string>>(new Set());

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

  function selectMarket(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => {
        ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  const selected = markets.find((m) => m.marketId === selectedId) ?? markets[0] ?? null;
  const quote = selected ? quoteTicket("up", stake, selected.impliedUp) : null;
  const { open, claimable } = useMemo(() => derivePositions(markets, journal), [markets, journal]);
  const totalUnclaimed = useMemo(() => claimable.reduce((sum, c) => sum + c.estimatedPayout, 0), [claimable]);
  const stats = useMemo(() => {
    let wagered = 0;
    let won = 0;
    let wins = 0;
    let settled = 0;
    for (const row of journal) {
      if (row.kind === "trade" && row.stake !== undefined) wagered += row.stake;
      if (row.kind === "redeem" && (row.result === "win" || row.result === "loss")) {
        settled += 1;
        if (row.result === "win") {
          wins += 1;
          won += row.payout ?? 0;
        }
      }
    }
    return { wagered, won, winRate: settled > 0 ? Math.round((wins / settled) * 100) : null };
  }, [journal]);

  async function refresh(silent = false) {
    if (silent) {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
    } else {
      setBusy(true);
      setMessage(null);
    }
    try {
      const rows = await listWindows();
      setMarkets(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].marketId);
      if (!silent) setMessage({ kind: "ok", text: `Found ${rows.length} window${rows.length === 1 ? "" : "s"} to bet on.` });
    } catch (err) {
      if (!silent) setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (silent) refreshingRef.current = false;
      else setBusy(false);
    }
  }

  // Keep market status/odds live in the background — windows can be as short
  // as a minute, so a stale "Open" badge or a missed settlement is common
  // without this. Also what makes auto-claim below actually notice a win.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => void refresh(true), 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  async function connectAndLoad(net: NetworkName, key?: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await connectExchange({ network: net, privateKey: key });
      setConnected(true);
      setSignedIn(Boolean(key));
      const rows = await listWindows();
      setMarkets(rows);
      setSelectedId((prev) => prev ?? rows[0]?.marketId ?? null);
      setMessage({ kind: "ok", text: `Found ${rows.length} window${rows.length === 1 ? "" : "s"} to bet on.` });
      return true;
    } catch (err) {
      setConnected(false);
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Browsing is free, like Polymarket — load markets read-only as soon as the
  // app opens instead of waiting on a manual "Connect" click.
  useEffect(() => {
    if (entered && !connected && !busy) {
      void connectAndLoad(network);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered]);

  function onNetworkChange(next: NetworkName) {
    setNetwork(next);
    disconnectExchange();
    setConnected(false);
    setSignedIn(false);
    setMarkets([]);
    setSelectedId(null);
    void connectAndLoad(next);
  }

  function onDisconnect() {
    disconnectExchange();
    setConnected(false);
    setSignedIn(false);
    setPrivateKey("");
    setMarkets([]);
    setMessage({ kind: "ok", text: "Disconnected. Your wallet key was never saved anywhere." });
    void connectAndLoad(network);
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
        asset: selected.asset,
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

  async function onRedeem(
    marketId: string,
    symbol: string,
    side: Side,
    asset: WindowMarket["asset"],
    payout?: number,
    auto = false,
  ) {
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
        asset,
        side,
        result: result.result,
        payout: result.result === "win" ? payout : undefined,
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
            asset: next.asset,
            note: `Lined up ${next.asset} ${next.timeframe}`,
          });
          setSelectedId(next.marketId);
          if (!auto) setTab("markets");
          setJournal(loadJournal());
          setMessage({
            kind: "ok",
            text: auto
              ? `Auto-claimed. Next window lined up: ${next.asset} ${next.timeframe}.`
              : `Claimed. Picked your next window: ${next.asset} ${next.timeframe} — place it on Markets.`,
          });
          setBusy(false);
          return;
        }
      }

      setJournal(loadJournal());
      setMessage({
        kind: "ok",
        text: `${auto ? "Auto-claimed" : "Claimed"}${result.hash ? ` · ${shorten(result.hash)}` : ""}.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // Auto-claim: as soon as the periodic refresh above notices a settled bet,
  // redeem it without waiting for the user to come back and tap Claim.
  useEffect(() => {
    if (!autoClaim || !signedIn) return;
    for (const c of claimable) {
      const key = `${c.marketId}:${c.side}`;
      if (autoClaimingRef.current.has(key)) continue;
      autoClaimingRef.current.add(key);
      void onRedeem(c.marketId, c.symbol, c.side, c.asset, c.estimatedPayout, true).finally(() => {
        autoClaimingRef.current.delete(key);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimable, autoClaim, signedIn]);

  function shareWin(row: JournalRow) {
    const asset = row.asset ?? detectAsset(row.symbol || row.marketId);
    const sideWord = row.side === "up" ? "Up" : row.side === "down" ? "Down" : "";
    const amount = row.payout !== undefined ? formatUsd(row.payout) : null;
    const text = amount
      ? `I called ${asset} ${sideWord} on Keel and won $${amount}! Bet on Somnia Event Contracts:`
      : `I just won a bet on Keel! Bet on Somnia Event Contracts:`;
    const url = `${window.location.origin}${window.location.pathname}#/app`;
    const nav = navigator as Navigator & { share?: (data: { text: string; url: string }) => Promise<void> };
    try {
      const result = nav.share?.({ text, url });
      if (result && typeof result.catch === "function") {
        result.catch(() => openTweetIntent(text, url));
        return;
      }
    } catch {
      /* fall through to the tweet-intent link below */
    }
    openTweetIntent(text, url);
  }

  function openTweetIntent(text: string, url: string) {
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
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
        <div className="nav-actions">
          {totalUnclaimed > 0 && (
            <button className="unclaimed-pill" onClick={() => setTab("desk")}>
              💰 ${formatUsd(totalUnclaimed)} to claim
            </button>
          )}
          <button className={`wallet-trigger ${signedIn ? "signed-in" : ""}`} onClick={() => setWalletOpen(true)}>
            {signedIn ? maskKey(privateKey) : "Connect Wallet"}
          </button>
          <a className="repo-link" href="https://github.com/Godwin-web3/keel" target="_blank" rel="noreferrer">
            View source
          </a>
        </div>
      </nav>
      <header className="top">
        <div className="brand">
          <h1>Keel</h1>
          <p>
            Bet on whether Bitcoin or Ethereum goes up or down in the next few minutes. Come back
            after it settles to collect what you won.
          </p>
        </div>
      </header>

      {walletOpen && (
        <div className="wallet-backdrop" onClick={() => setWalletOpen(false)}>
          <div className="wallet-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-sheet-head">
              <h2>Wallet</h2>
              <button className="ghost" onClick={() => setWalletOpen(false)}>
                Close
              </button>
            </div>
            <label>Network</label>
            <div className="row">
              <select
                value={network}
                onChange={(e) => onNetworkChange(e.target.value as NetworkName)}
                disabled={signedIn || busy}
              >
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
                disabled={signedIn}
                autoComplete="off"
              />
            </div>
            <div className="row">
              <button
                onClick={() => {
                  void (async () => {
                    const ok = await connectAndLoad(network, privateKey.trim() || undefined);
                    if (ok && privateKey.trim()) setWalletOpen(false);
                  })();
                }}
                disabled={busy || signedIn || !privateKey.trim()}
              >
                {busy ? "Connecting..." : signedIn ? "Connected" : "Connect wallet to bet"}
              </button>
              <button className="ghost" onClick={() => void refresh()} disabled={busy || !connected}>
                Refresh
              </button>
              {signedIn && (
                <button className="ghost" onClick={onDisconnect}>
                  Disconnect
                </button>
              )}
            </div>
            <div className="muted">
              {signedIn
                ? `Connected · ${maskKey(privateKey)}`
                : connected
                  ? "Just browsing — connect a wallet above to place bets."
                  : busy
                    ? "Loading markets..."
                    : "You can look around for free. Betting needs a wallet key."}
            </div>
          </div>
        </div>
      )}

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
            {!connected && !busy && <p className="muted">Couldn't load windows. Try refreshing.</p>}
            {!connected && busy && <p className="muted">Loading live BTC and ETH windows...</p>}
            {connected && markets.length === 0 && (
              <p className="muted">No windows returned right now. Try refreshing in a moment.</p>
            )}
            <div className="market-list">
              {markets.map((m) => {
                const upPct = m.impliedUp === null ? null : Math.round(m.impliedUp * 100);
                const secondsLeft = m.expirySec ? m.expirySec - nowMs / 1000 : m.secondsLeft;
                return (
                  <article
                    key={m.marketId}
                    className={`market ${selected?.marketId === m.marketId ? "selected" : ""}`}
                    onClick={() => selectMarket(m.marketId)}
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
            </div>
          </section>

          <section className="card ticket-panel" ref={ticketRef}>
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
                    disabled={busy || !signedIn || selected.status !== "trading"}
                    onClick={() => void onTrade("up")}
                  >
                    Bet Up
                  </button>
                  <button
                    className="down"
                    disabled={busy || !signedIn || selected.status !== "trading"}
                    onClick={() => void onTrade("down")}
                  >
                    Bet Down
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  {selected.status !== "trading"
                    ? "This window isn't open for new bets right now."
                    : !signedIn
                      ? "Connect a wallet above to place a bet."
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
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={autoClaim}
                onChange={(e) => setAutoClaim(e.target.checked)}
                disabled={!signedIn}
              />
              Auto-claim the instant a bet settles — no need to come back and tap Claim
            </label>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input type="checkbox" checked={rollAfterRedeem} onChange={(e) => setRollAfterRedeem(e.target.checked)} />
              After I claim, line up the next window automatically
            </label>
            <div className="actions" style={{ marginBottom: 14 }}>
              <button
                disabled={busy || claimable.length === 0 || !signedIn}
                onClick={() => {
                  void (async () => {
                    for (const item of claimable) {
                      await onRedeem(item.marketId, item.symbol, item.side, item.asset, item.estimatedPayout);
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
                  <button
                    disabled={busy || !signedIn}
                    onClick={() => void onRedeem(c.marketId, c.symbol, c.side, c.asset, c.estimatedPayout)}
                  >
                    Claim {formatUsd(c.estimatedPayout)}
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Activity</h2>
            <div className="stats-strip">
              <div className="stat-tile">
                <span>Total wagered</span>
                <strong>${formatUsd(stats.wagered)}</strong>
              </div>
              <div className="stat-tile">
                <span>Total won</span>
                <strong>${formatUsd(stats.won)}</strong>
              </div>
              <div className="stat-tile">
                <span>Win rate</span>
                <strong>{stats.winRate === null ? "—" : `${stats.winRate}%`}</strong>
              </div>
            </div>
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
                      <span className="asset-icon">{ASSET_ICON[row.asset ?? detectAsset(row.symbol || row.marketId)]}</span>
                      {row.asset ?? detectAsset(row.symbol || row.marketId)}
                    </td>
                    <td>
                      {row.side ? (row.side === "up" ? "Up" : "Down") + " · " : ""}
                      {row.stake !== undefined ? `$${formatUsd(row.stake)} · ` : ""}
                      {row.hash ? shorten(row.hash) : row.note || row.result || ""}
                      {row.kind === "redeem" && row.result === "win" && (
                        <button className="share-btn" onClick={() => shareWin(row)}>
                          Share
                        </button>
                      )}
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
