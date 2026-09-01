import { useEffect, useMemo, useRef, useState } from "react";
import type { Claimable, JournalRow, MarketStatus, NetworkName, OpenPosition, Side, WindowMarket } from "./lib/types";
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
import {
  connectExchange,
  connectInjectedWallet,
  derivePositions,
  disconnectExchange,
  discoverOnchainPositions,
  getAccountAddress,
  getAuthorizedInjectedAddress,
  getMarketProbabilityHistory,
  getRecentLeaderboard,
  hasInjectedWallet,
  listWindows,
  maskKey,
  mergePositions,
  placeStake,
  redeemMarket,
  type LeaderboardEntry,
  type ProbabilityPoint,
} from "./lib/sdk";
import Landing from "./Landing";
import CountdownRing from "./CountdownRing";
import PriceChart from "./PriceChart";

type Tab = "markets" | "desk" | "leaderboard";
type HistoryFilter = "all" | "won" | "lost" | "collected";

const DEFAULT_STAKE = 10;
const APP_HASH = "#/app";
const KIND_LABEL: Record<JournalRow["kind"], string> = {
  trade: "Bet placed",
  redeem: "Claimed",
  roll: "Rolled",
  note: "Note",
};

// Windows this long or shorter render a countdown ring — a 1h+ window ticking
// down visually all session is just noise, not urgency.
const RING_MAX_SECONDS = 20 * 60;

function timeframeSeconds(timeframe: string): number {
  if (timeframe.endsWith("h")) return Number(timeframe.slice(0, -1)) * 3600;
  if (timeframe.endsWith("m")) return Number(timeframe.slice(0, -1)) * 60;
  return RING_MAX_SECONDS;
}

function slotLabel(index: number, status: MarketStatus): string {
  if (status === "trading") return "Live";
  return index === 0 ? "Next" : "Later";
}

type Theme = "light" | "dark";
const THEME_KEY = "keel.theme";

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

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
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [injectedAvailable, setInjectedAvailable] = useState(false);
  const [showKeyFallback, setShowKeyFallback] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [onchainPositions, setOnchainPositions] = useState<{ open: OpenPosition[]; claimable: Claimable[] }>({
    open: [],
    claimable: [],
  });
  const [betOpen, setBetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [markets, setMarkets] = useState<WindowMarket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [rollAfterRedeem, setRollAfterRedeem] = useState(true);
  const [autoClaim, setAutoClaim] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingBet, setPendingBet] = useState<Side | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [theme, setTheme] = useState<Theme | null>(() => getStoredTheme());
  const [moreOpen, setMoreOpen] = useState(false);
  const [chartPoints, setChartPoints] = useState<ProbabilityPoint[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
  const refreshingRef = useRef(false);
  const autoClaimingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setJournal(loadJournal());
  }, []);

  useEffect(() => {
    setInjectedAvailable(hasInjectedWallet());
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggleTheme() {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = theme ?? (systemDark ? "dark" : "light");
    const next: Theme = current === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private browsing or storage disabled — the toggle still works for this session */
    }
  }

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
    setBetOpen(true);
  }

  function closeBetSheet() {
    setBetOpen(false);
    setPendingBet(null);
  }

  const selected = markets.find((m) => m.marketId === selectedId) ?? null;

  // Group windows by asset+cadence and order soonest-first, so each group can
  // render as a Live/Next/Later round carousel instead of one flat list.
  const roundGroups = useMemo(() => {
    const byKey = new Map<string, WindowMarket[]>();
    for (const m of markets) {
      const key = `${m.asset}:${m.timeframe}`;
      const arr = byKey.get(key) ?? [];
      arr.push(m);
      byKey.set(key, arr);
    }
    return [...byKey.entries()]
      .map(([key, list]) => {
        const rounds = [...list].sort((a, b) => a.expirySec - b.expirySec);
        return { key, asset: rounds[0].asset, timeframe: rounds[0].timeframe, rounds };
      })
      .sort((a, b) => a.rounds[0].expirySec - b.rounds[0].expirySec);
  }, [markets]);

  // Best-effort probability chart for whichever window is selected — refetched
  // whenever the selection changes. Never blocks the ticket panel on failure.
  useEffect(() => {
    if (!selected) {
      setChartPoints([]);
      return;
    }
    let cancelled = false;
    void getMarketProbabilityHistory(selected).then((points) => {
      if (!cancelled) setChartPoints(points);
    });
    return () => {
      cancelled = true;
    };
  }, [selected?.marketId]);

  const filteredJournal = useMemo(() => {
    if (historyFilter === "all") return journal;
    if (historyFilter === "collected") return journal.filter((r) => r.kind === "redeem");
    const wantResult = historyFilter === "won" ? "win" : "loss";
    return journal.filter((r) => r.kind === "redeem" && r.result === wantResult);
  }, [journal, historyFilter]);

  async function loadLeaderboard() {
    setLeaderboardBusy(true);
    try {
      const rows = await getRecentLeaderboard();
      setLeaderboard(rows);
    } finally {
      setLeaderboardBusy(false);
    }
  }
  const { open, claimable } = useMemo(() => {
    const merged = mergePositions(derivePositions(markets, journal), onchainPositions);
    // derivePositions already excludes a journal-known trade whose market has
    // a matching redeem row, but an on-chain-discovered position was never a
    // trade row to begin with — without this it would sit in claimable until
    // the next 15s poll happens to notice the balance is now zero.
    const redeemedKeys = new Set(
      journal.filter((r) => r.kind === "redeem").map((r) => `${r.marketId}:${r.side ?? ""}`),
    );
    return {
      open: merged.open.filter((p) => !redeemedKeys.has(`${p.marketId}:${p.side}`)),
      claimable: merged.claimable.filter((p) => !redeemedKeys.has(`${p.marketId}:${p.side}`)),
    };
  }, [markets, journal, onchainPositions]);
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

  // Best-effort: scan the connected account's actual on-chain outcome-token
  // balances so Desk shows positions even if the local journal never saw them
  // (a fresh browser, cleared storage, a bet placed elsewhere). Never blocks
  // the rest of the UI on failure — journal-derived positions still work.
  async function discoverPositions(address: string) {
    try {
      const rows = await discoverOnchainPositions(address as `0x${string}`);
      setOnchainPositions(rows);
    } catch {
      /* on-chain discovery is a bonus, not a requirement */
    }
  }

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
      if (walletAddress) void discoverPositions(walletAddress);
      if (!silent) setMessage({ kind: "ok", text: `Found ${rows.length} window${rows.length === 1 ? "" : "s"} to bet on.` });
    } catch (err) {
      if (!silent) setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (silent) refreshingRef.current = false;
      else setBusy(false);
    }
  }

  // Keep market status/odds (and on-chain positions) live in the background —
  // windows can be as short as a minute, so a stale "Open" badge or a missed
  // settlement is common without this. Also what makes auto-claim notice a win.
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
      const address = getAccountAddress();
      setWalletAddress(address);
      const rows = await listWindows();
      setMarkets(rows);
      if (address) void discoverPositions(address);
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

  async function connectInjected(): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const address = await connectInjectedWallet(network);
      setConnected(true);
      setSignedIn(true);
      setWalletAddress(address);
      setShowKeyFallback(false);
      const rows = await listWindows();
      setMarkets(rows);
      void discoverPositions(address);
      setMessage({
        kind: "ok",
        text: `Wallet connected · ${maskKey(address)}. Found ${rows.length} window${rows.length === 1 ? "" : "s"} to bet on.`,
      });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Browsing is free, like Polymarket — load markets read-only as soon as the
  // app opens instead of waiting on a manual "Connect" click. If the browser
  // wallet already authorized this site (a past session), reconnect it
  // silently instead of falling back to read-only.
  useEffect(() => {
    if (!entered || connected || busy) return;
    void (async () => {
      const authorized = await getAuthorizedInjectedAddress();
      if (authorized) {
        const ok = await connectInjected();
        if (!ok) await connectAndLoad(network); // fall back to read-only rather than a blank app
      } else {
        await connectAndLoad(network);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered]);

  function onNetworkChange(next: NetworkName) {
    setNetwork(next);
    disconnectExchange();
    setConnected(false);
    setSignedIn(false);
    setWalletAddress(null);
    setOnchainPositions({ open: [], claimable: [] });
    setMarkets([]);
    setSelectedId(null);
    void connectAndLoad(next);
  }

  function onDisconnect() {
    disconnectExchange();
    setConnected(false);
    setSignedIn(false);
    setPrivateKey("");
    setWalletAddress(null);
    setOnchainPositions({ open: [], claimable: [] });
    setMarkets([]);
    setMessage({ kind: "ok", text: "Disconnected. Nothing you connected with was ever saved anywhere." });
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
      if (walletAddress) void discoverPositions(walletAddress);

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
            {signedIn && walletAddress ? maskKey(walletAddress) : "Connect Wallet"}
          </button>
          <button className="theme-trigger" aria-label="Toggle color theme" onClick={toggleTheme}>
            {(theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "☀" : "🌙"}
          </button>
          <button className="more-trigger" aria-label="More" onClick={() => setMoreOpen(true)}>
            ☰
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="wallet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="wallet-sheet more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-sheet-head">
              <h2>More</h2>
              <button className="ghost" onClick={() => setMoreOpen(false)}>
                Close
              </button>
            </div>
            <button
              className="more-item"
              onClick={() => {
                setTab("leaderboard");
                setMoreOpen(false);
                if (leaderboard === null && !leaderboardBusy) void loadLeaderboard();
              }}
            >
              🏆 Leaderboard
            </button>
            <a
              className="more-item"
              href="https://github.com/Godwin-web3/keel"
              target="_blank"
              rel="noreferrer"
              onClick={() => setMoreOpen(false)}
            >
              View source
            </a>
          </div>
        </div>
      )}

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

            {signedIn ? (
              <>
                <div className="muted" style={{ marginBottom: 12 }}>
                  Connected · {walletAddress ? maskKey(walletAddress) : "—"}
                </div>
                <div className="row">
                  <button className="ghost" onClick={() => void refresh()} disabled={busy}>
                    Refresh
                  </button>
                  <button className="ghost" onClick={onDisconnect}>
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <button onClick={() => void connectInjected()} disabled={busy || !injectedAvailable}>
                    {busy ? "Connecting..." : "Connect Wallet"}
                  </button>
                  <button className="ghost" onClick={() => void refresh()} disabled={busy || !connected}>
                    Refresh
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 4, marginBottom: 12 }}>
                  {injectedAvailable
                    ? "Detects MetaMask, Rabby, or whatever wallet you have installed — no key to paste."
                    : "No wallet extension found. Install MetaMask or Rabby, or use a private key below."}
                </p>

                {injectedAvailable && (
                  <button
                    className="advanced-toggle"
                    onClick={() => setShowKeyFallback((v) => !v)}
                    type="button"
                  >
                    {showKeyFallback ? "Hide" : "Use a private key instead (advanced)"}
                  </button>
                )}

                {(showKeyFallback || !injectedAvailable) && (
                  <div className="advanced-panel">
                    <label>Session private key</label>
                    <div className="row">
                      <input
                        type="password"
                        placeholder="0x... a spending key, never your main wallet"
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="row">
                      <button
                        className="ghost"
                        onClick={() => {
                          void (async () => {
                            const ok = await connectAndLoad(network, privateKey.trim() || undefined);
                            if (ok && privateKey.trim()) setWalletOpen(false);
                          })();
                        }}
                        disabled={busy || !privateKey.trim()}
                      >
                        {busy ? "Connecting..." : "Connect with key"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="muted" style={{ marginTop: 12 }}>
              {!signedIn &&
                (connected
                  ? "Just browsing — connect a wallet to place bets."
                  : busy
                    ? "Loading markets..."
                    : "You can look around for free.")}
            </div>
          </div>
        </div>
      )}

      {betOpen && selected && (
        <div className="confirm-backdrop" onClick={closeBetSheet}>
          <div className="confirm-card bet-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-sheet-head">
              <h2>{pendingBet ? "Confirm your bet" : "Place your bet"}</h2>
              <button className="ghost" onClick={closeBetSheet}>
                Close
              </button>
            </div>

            {!pendingBet && (
              <>
                <p className="plain">
                  {selected.asset === "OTHER" ? "This market" : selected.asset} · Up or Down in {selected.timeframe}
                </p>
                <PriceChart points={chartPoints} />
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
                    onClick={() => setPendingBet("up")}
                  >
                    Bet Up
                  </button>
                  <button
                    className="down"
                    disabled={busy || !signedIn || selected.status !== "trading"}
                    onClick={() => setPendingBet("down")}
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

            {pendingBet && (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  {selected.asset} {selected.timeframe} ·{" "}
                  <span className={`confirm-side ${pendingBet}`}>{pendingBet === "up" ? "Up" : "Down"}</span>
                </p>
                <div className="ticket-math">
                  <div>
                    <span>You're staking</span>
                    {formatUsd(stake)}
                  </div>
                  <div>
                    <span>You get back if right</span>
                    {formatUsd(quoteTicket(pendingBet, stake, selected.impliedUp).redeemIfWin)}
                  </div>
                  <div>
                    <span>Most you can lose</span>
                    {formatUsd(stake)}
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    className={pendingBet}
                    disabled={busy}
                    onClick={() => {
                      const side = pendingBet;
                      closeBetSheet();
                      void onTrade(side);
                    }}
                  >
                    Confirm {pendingBet === "up" ? "Up" : "Down"}
                  </button>
                  <button className="ghost" onClick={() => setPendingBet(null)}>
                    Back
                  </button>
                </div>
              </>
            )}
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
        <section className="card markets-full">
          <h2>Will it go up or down?</h2>
          {!connected && !busy && <p className="muted">Couldn't load windows. Try refreshing.</p>}
          {!connected && busy && <p className="muted">Loading live BTC and ETH windows...</p>}
          {connected && markets.length === 0 && (
            <p className="muted">No windows returned right now. Try refreshing in a moment.</p>
          )}
          <div className="market-list">
            {roundGroups.map((group) => (
              <div key={group.key} className="round-group">
                <div className="round-group-head">
                  <span className="asset-icon">{ASSET_ICON[group.asset]}</span>
                  {group.asset} · {group.timeframe}
                </div>
                <div className="round-track">
                  {group.rounds.slice(0, 4).map((m, idx) => {
                    const upPct = m.impliedUp === null ? null : Math.round(m.impliedUp * 100);
                    const secondsLeft = m.expirySec ? m.expirySec - nowMs / 1000 : m.secondsLeft;
                    const slot = slotLabel(idx, m.status);
                    const totalSeconds = timeframeSeconds(m.timeframe);
                    return (
                      <article
                        key={m.marketId}
                        className={`round-card ${slot === "Live" ? "live" : ""} ${selected?.marketId === m.marketId ? "selected" : ""}`}
                        onClick={() => selectMarket(m.marketId)}
                      >
                        <div className="market-top">
                          <span className="round-slot">{slot}</span>
                          {secondsLeft > 0 && secondsLeft <= totalSeconds && (
                            <CountdownRing secondsLeft={secondsLeft} totalSeconds={totalSeconds} size={26} />
                          )}
                        </div>
                        <div className="odds-bar">
                          <div className="odds-bar-up" style={{ width: `${upPct ?? 50}%` }} />
                          <div className="odds-bar-down" style={{ width: `${100 - (upPct ?? 50)}%` }} />
                        </div>
                        <div className="odds-labels">
                          <span className="odds-up">Up {upPct === null ? "—" : `${upPct}%`}</span>
                          <span className="odds-down">Down {upPct === null ? "—" : `${100 - upPct}%`}</span>
                        </div>
                        <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                          {formatCloseLabel(m.expirySec, secondsLeft)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
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
                  {p.stake !== null ? (
                    <>
                      You bet {formatUsd(p.stake)} on <strong className={p.side}>{p.side === "up" ? "Up" : "Down"}</strong> at{" "}
                      {formatProb(p.entryProb)} odds
                    </>
                  ) : (
                    <>
                      You have {formatUsd(p.contracts, 3)} contracts on{" "}
                      <strong className={p.side}>{p.side === "up" ? "Up" : "Down"}</strong>
                      {p.fromChain ? " (found on-chain)" : ""}
                    </>
                  )}
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
                    {c.fromChain && <span className="muted"> · found on-chain</span>}
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
            <div className="filter-chips">
              {(["all", "won", "lost", "collected"] as HistoryFilter[]).map((f) => (
                <button key={f} className={historyFilter === f ? "active" : ""} onClick={() => setHistoryFilter(f)}>
                  {f === "all" ? "All" : f === "won" ? "Won" : f === "lost" ? "Lost" : "Collected"}
                </button>
              ))}
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
                {filteredJournal.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {journal.length === 0
                        ? "Nothing yet. Your bets, claims, and rolls show up here, saved only on this device."
                        : "Nothing matches this filter."}
                    </td>
                  </tr>
                )}
                {filteredJournal.map((row) => (
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

      {tab === "leaderboard" && (
        <div className="grid single">
          <section className="card">
            <h2>Recent winning stakes</h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              Built from real fills on the last few settled windows — the wallets who bought onto the side that ended
              up winning. Not a full profit ranking (losing windows aren't netted out), just recent activity.
            </p>
            {leaderboardBusy && <p className="muted">Reading recent settled windows...</p>}
            {!leaderboardBusy && leaderboard !== null && leaderboard.length === 0 && (
              <p className="muted">No winning fills found in the recent settled windows.</p>
            )}
            {!leaderboardBusy &&
              leaderboard !== null &&
              leaderboard.map((entry, i) => (
                <div key={entry.address} className="leaderboard-row">
                  <span className="leaderboard-rank">#{i + 1}</span>
                  <span className="leaderboard-addr">{maskKey(entry.address)}</span>
                  <span className="muted">{entry.wins} win{entry.wins === 1 ? "" : "s"}</span>
                  <span className="leaderboard-amount">${formatUsd(entry.volumeWon)}</span>
                </div>
              ))}
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="ghost" disabled={leaderboardBusy} onClick={() => void loadLeaderboard()}>
                Refresh
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
