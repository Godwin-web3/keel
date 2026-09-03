import { useEffect, useMemo, useRef, useState } from "react";
import type { Claimable, JournalRow, MarketStatus, NetworkName, OpenPosition, RunState, Side, WindowMarket } from "./lib/types";
import {
  ASSET_ICON,
  detectAsset,
  formatCloseLabel,
  formatEdge,
  formatProb,
  formatUsd,
  plainLanguage,
  quoteTicket,
  shorten,
  spotMovePct,
  STATUS_LABEL,
} from "./lib/format";
import { appendJournal, loadJournal } from "./lib/journal";
import {
  applyHopResult,
  appendPendingHop,
  endRun,
  findLiveWindow,
  findParlayPartner,
  findSuccessor,
  loadRun,
  newRun,
  quoteParlay,
  saveRun,
} from "./lib/instruments";
import {
  connectExchange,
  connectInjectedWallet,
  derivePositions,
  disconnectExchange,
  discoverOnchainPositions,
  fetchBook,
  fetchSpotPrice,
  getAccountAddress,
  getAuthorizedInjectedAddress,
  getMarketProbabilityHistory,
  getRecentLeaderboard,
  hasInjectedWallet,
  listWindows,
  maskKey,
  mergePositions,
  onLiveUpdate,
  peekStatuses,
  placeParlay,
  placeStake,
  redeemMarket,
  watchPools,
  type LeaderboardEntry,
  type ProbabilityPoint,
} from "./lib/sdk";
import Landing from "./Landing";
import CountdownRing from "./CountdownRing";
import PriceChart from "./PriceChart";
import RunCard from "./RunCard";
import { ExternalLinkIcon, KeelMark, MenuIcon, MoonIcon, SpinnerIcon, SunIcon, TrophyIcon } from "./Icons";

type Tab = "markets" | "run" | "desk" | "leaderboard";
type HistoryFilter = "all" | "won" | "lost" | "collected";
type PendingBet = { kind: "single"; side: Side } | { kind: "parlay"; a: Side; b: Side } | null;

const DEFAULT_STAKE = 10;
const APP_HASH = "#/app";
const KIND_LABEL: Record<JournalRow["kind"], string> = {
  trade: "Bet placed",
  redeem: "Claimed",
  roll: "Rolled",
  note: "Note",
  parlay: "Parlay",
  run: "Run",
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
  document.documentElement.dataset.theme = theme ?? "dark";
}

function isAppRoute(): boolean {
  return window.location.hash === APP_HASH;
}

export default function App() {
  const [entered, setEntered] = useState(isAppRoute);
  const [tab, setTab] = useState<Tab>("markets");
  const [network, setNetwork] = useState<NetworkName>("shannon");
  const [connected, setConnected] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [injectedAvailable, setInjectedAvailable] = useState(false);
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
  const [autoClaim, setAutoClaim] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingBet, setPendingBet] = useState<PendingBet>(null);
  const [parlayOn, setParlayOn] = useState(false);
  const [parlaySideB, setParlaySideB] = useState<Side>("down");
  const [run, setRun] = useState<RunState | null>(null);
  const [runStake, setRunStake] = useState(10);
  const [runCashOut, setRunCashOut] = useState(18);
  const [runStop, setRunStop] = useState(5);
  const [runMax, setRunMax] = useState(5);
  const [runSameSide, setRunSameSide] = useState(true);
  const [runAsset, setRunAsset] = useState<"BTC" | "ETH">("BTC");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [theme, setTheme] = useState<Theme | null>(() => getStoredTheme());
  const [moreOpen, setMoreOpen] = useState(false);
  const [chartPoints, setChartPoints] = useState<ProbabilityPoint[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const refreshingRef = useRef(false);
  const autoClaimingRef = useRef<Set<string>>(new Set());
  const runRef = useRef<RunState | null>(null);
  runRef.current = run;
  const restakingRef = useRef(false);

  useEffect(() => {
    setJournal(loadJournal());
    setRun(loadRun());
  }, []);

  useEffect(() => {
    saveRun(run);
  }, [run]);

  useEffect(() => {
    setInjectedAvailable(hasInjectedWallet());
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggleTheme() {
    const current = theme ?? "dark";
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
  const parlayPartner = useMemo(
    () => (selected ? findParlayPartner(selected, markets) : null),
    [selected, markets],
  );

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

  // Live book for the open ticket only — not a full 50-market rescan.
  useEffect(() => {
    if (!selected || !connected) return;
    let cancelled = false;
    async function tick() {
      if (!selected) return;
      const book = await fetchBook(selected.upSymbol);
      if (cancelled || !book.mid) return;
      setMarkets((prev) =>
        prev.map((m) =>
          m.marketId === selected.marketId
            ? { ...m, impliedUp: book.mid, bestBid: book.bid, bestAsk: book.ask }
            : m,
        ),
      );
    }
    void tick();
    const id = setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selected?.marketId, selected?.upSymbol, connected]);

  useEffect(() => {
    if (!selected || selected.asset === "OTHER") {
      setSpotPrice(null);
      return;
    }
    let cancelled = false;
    void fetchSpotPrice(selected.asset).then((p) => {
      if (!cancelled) setSpotPrice(p);
    });
    const id = setInterval(() => {
      void fetchSpotPrice(selected.asset).then((p) => {
        if (!cancelled) setSpotPrice(p);
      });
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selected?.marketId, selected?.asset]);

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
    return { wagered, won, wins, settled, winRate: settled > 0 ? Math.round((wins / settled) * 100) : null };
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
    const id = setInterval(() => void refresh(true), 45000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    if (!signedIn || !walletAddress) return;
    const id = setInterval(() => void discoverPositions(walletAddress), 15000);
    return () => clearInterval(id);
  }, [signedIn, walletAddress]);

  useEffect(() => {
    if (!signedIn) return;
    return onLiveUpdate(() => {
      if (walletAddress) void discoverPositions(walletAddress);
    });
  }, [signedIn, walletAddress]);

  useEffect(() => {
    const pools = [
      ...new Set(
        open
          .map((p) => markets.find((m) => m.marketId === p.marketId)?.poolAddress)
          .filter((p): p is string => Boolean(p)),
      ),
    ];
    if (pools.length === 0) return;
    let stop: (() => void) | undefined;
    void watchPools(pools).then((s) => {
      stop = s;
    });
    return () => stop?.();
  }, [open, markets]);

  useEffect(() => {
    if (!signedIn || open.length === 0) return;
    let cancelled = false;
    async function tick() {
      const ids = [...new Set(open.map((p) => p.marketId))];
      const map = await peekStatuses(ids);
      if (cancelled || map.size === 0) return;
      setMarkets((prev) =>
        prev.map((m) => {
          const hit = map.get(m.marketId);
          if (!hit) return m;
          const status: MarketStatus = hit.isVoided
            ? "voided"
            : hit.isResolved
              ? "resolved"
              : hit.status === 1
                ? "trading"
                : hit.status === 2
                  ? "locked"
                  : hit.status === 3
                    ? "settling"
                    : m.status;
          return { ...m, status, isResolved: hit.isResolved, isVoided: hit.isVoided, statusCode: hit.status };
        }),
      );
      if (walletAddress) void discoverPositions(walletAddress);
    }
    void tick();
    const id = setInterval(() => void tick(), 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [signedIn, open, walletAddress]);

  async function connectAndLoad(net: NetworkName): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await connectExchange({ network: net });
      setConnected(true);
      setSignedIn(false);
      setWalletAddress(null);
      const rows = await listWindows();
      setMarkets(rows);
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
      setWalletOpen(false);
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
    setWalletAddress(null);
    setOnchainPositions({ open: [], claimable: [] });
    setMarkets([]);
    setMessage({ kind: "ok", text: "Disconnected. Nothing you connected with was ever saved anywhere." });
    void connectAndLoad(network);
  }

  async function onTrade(side: Side, market = selected, amount = stake, runId?: string) {
    if (!market) return;
    const q = quoteTicket(side, amount, market.impliedUp);
    setBusy(true);
    setMessage(null);
    try {
      const result = await placeStake({ market, side, stake: amount });
      const rows = appendJournal({
        kind: "trade",
        marketId: market.marketId,
        symbol: market.symbol,
        asset: market.asset,
        side,
        stake: amount,
        entryProb: q.entryProb,
        result: "pending",
        hash: result.hash,
        runId,
        note: plainLanguage(market, amount, side),
      });
      setJournal(rows);
      if (!runId) setTab("desk");
      setMessage({ kind: "ok", text: `Bet placed${result.hash ? ` · ${shorten(result.hash)}` : ""}.` });
      return { hash: result.hash, quote: q };
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onParlay(aSide: Side, bSide: Side) {
    if (!selected || !parlayPartner) return;
    const q = quoteParlay(selected, aSide, parlayPartner, bSide, stake);
    setBusy(true);
    setMessage(null);
    const parlayId = crypto.randomUUID();
    try {
      const placed = await placeParlay({
        legs: [
          { market: selected, side: aSide, stake: q.legs[0].stake },
          { market: parlayPartner, side: bSide, stake: q.legs[1].stake },
        ],
      });
      appendJournal({
        kind: "parlay",
        marketId: selected.marketId,
        symbol: `${selected.asset}×${parlayPartner.asset}`,
        asset: selected.asset,
        stake,
        parlayId,
        note: `${selected.asset} ${aSide === "up" ? "Up" : "Down"} × ${parlayPartner.asset} ${bSide === "up" ? "Up" : "Down"} · both must hit · ~${q.redeemIfWin.toFixed(2)} back`,
      });
      for (const [i, leg] of placed.legs.entries()) {
        const m = i === 0 ? selected : parlayPartner;
        const side = i === 0 ? aSide : bSide;
        appendJournal({
          kind: "trade",
          marketId: m.marketId,
          symbol: m.symbol,
          asset: m.asset,
          side,
          stake: q.legs[i].stake,
          entryProb: q.legs[i].entryProb,
          result: leg.error ? "pending" : "pending",
          hash: leg.hash,
          parlayId,
          note: leg.error ?? plainLanguage(m, q.legs[i].stake, side),
        });
      }
      setJournal(loadJournal());
      setTab("desk");
      const failed = placed.legs.filter((l) => l.error);
      setMessage({
        kind: failed.length === placed.legs.length ? "error" : "ok",
        text:
          failed.length === 0
            ? `Parlay filled · ${selected.asset} × ${parlayPartner.asset}. Both must hit.`
            : `Parlay partial: ${failed.map((f) => f.error).join(" · ")}`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function restakeRun(current: RunState, fromMarket: WindowMarket, lastSide: Side, nextStake: number) {
    if (restakingRef.current) return;
    restakingRef.current = true;
    try {
      const next = findSuccessor(fromMarket, markets) ?? findLiveWindow(markets, current.asset, current.timeframe);
      if (!next) {
        const stopped = endRun(current, "stopped", nextStake, "No successor window to ride.");
        setRun(stopped);
        setMessage({ kind: "ok", text: "Run paused — no live successor window." });
        return;
      }
      const side: Side = current.sameSide ? lastSide : (next.impliedUp ?? 0.5) >= 0.5 ? "up" : "down";
      const placed = await onTrade(side, next, nextStake, current.id);
      if (!placed) return;
      const hopped = appendPendingHop(current, {
        marketId: next.marketId,
        symbol: next.symbol,
        asset: next.asset,
        timeframe: next.timeframe,
        side,
        stake: nextStake,
        at: new Date().toISOString(),
        result: "pending",
        hash: placed.hash,
      });
      setRun(hopped);
      appendJournal({
        kind: "roll",
        marketId: next.marketId,
        symbol: next.symbol,
        asset: next.asset,
        side,
        stake: nextStake,
        runId: current.id,
        note: `Run hop ${hopped.hops.length}/${hopped.maxRounds} · ${next.asset} ${next.timeframe}`,
      });
      setJournal(loadJournal());
      setMessage({ kind: "ok", text: `Run riding ${next.asset} ${next.timeframe} with ${nextStake.toFixed(2)}.` });
    } finally {
      restakingRef.current = false;
    }
  }

  async function onStartRun() {
    const live = findLiveWindow(markets, runAsset);
    if (!live) {
      setMessage({ kind: "error", text: `No live ${runAsset} window to start a run.` });
      return;
    }
    const created = newRun({
      stake: runStake,
      cashOutAt: runCashOut,
      stopAt: runStop,
      maxRounds: runMax,
      sameSide: runSameSide,
      asset: runAsset,
      timeframe: live.timeframe,
    });
    const side: Side = (live.impliedUp ?? 0.5) >= 0.5 ? "up" : "down";
    const placed = await onTrade(side, live, runStake, created.id);
    if (!placed) return;
    const started = appendPendingHop(created, {
      marketId: live.marketId,
      symbol: live.symbol,
      asset: live.asset,
      timeframe: live.timeframe,
      side,
      stake: runStake,
      at: new Date().toISOString(),
      result: "pending",
      hash: placed.hash,
    });
    setRun(started);
    setAutoClaim(true);
    setTab("run");
    appendJournal({
      kind: "run",
      marketId: live.marketId,
      symbol: live.symbol,
      asset: live.asset,
      side,
      stake: runStake,
      runId: started.id,
      note: `Run started · cash out ${runCashOut} · stop ${runStop} · max ${runMax} rounds`,
    });
    setJournal(loadJournal());
  }

  function onStopRun() {
    const current = runRef.current;
    if (!current || current.status !== "running") return;
    const stopped = endRun(current, "stopped", current.bankrollNow, "Stopped by you.");
    setRun(stopped);
    setMessage({ kind: "ok", text: "Run stopped. Claim anything still sitting on-chain from Desk." });
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
        note: result.result === "loss" && !result.hash ? "Settled as a loss — nothing to claim (skipped a 0-payout redeem)" : note,
      });
      if (walletAddress) void discoverPositions(walletAddress);

      const currentRun = runRef.current;
      const hop = currentRun?.hops.find((h) => h.marketId === marketId && (h.result === "pending" || !h.result));
      if (currentRun && currentRun.status === "running" && hop && result.result !== "pending") {
        const updated = applyHopResult(currentRun, marketId, result.result, result.result === "win" ? payout : result.result === "void" ? hop.stake : 0, result.hash);
        setRun(updated);
        setJournal(loadJournal());
        if (updated.status === "running" && updated.bankrollNow > 0) {
          const from = markets.find((m) => m.marketId === marketId);
          if (from) void restakeRun(updated, from, hop.side, updated.bankrollNow);
          setBusy(false);
          return;
        }
        setMessage({ kind: "ok", text: updated.stopReason ?? `Run ${updated.status}.` });
        setBusy(false);
        return;
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
      if (c.estimatedPayout <= 0) continue;
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
          <span className="mark" aria-hidden>
            <KeelMark />
          </span>
          Keel
        </button>
        <div className="nav-actions">
          {totalUnclaimed > 0 && (
            <button className="unclaimed-pill" onClick={() => setTab("desk")}>
              ${formatUsd(totalUnclaimed)} to claim
            </button>
          )}
          <button className={`wallet-trigger ${signedIn ? "signed-in" : ""}`} onClick={() => setWalletOpen(true)}>
            {signedIn && walletAddress ? maskKey(walletAddress) : "Connect Wallet"}
          </button>
          <button className="theme-trigger" aria-label="Toggle color theme" onClick={toggleTheme}>
            {(theme ?? "dark") === "dark" ? (
              <SunIcon />
            ) : (
              <MoonIcon />
            )}
          </button>
          <div className="more-menu-wrap">
            <button
              className={`more-trigger ${moreOpen ? "active" : ""}`}
              aria-label="More"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MenuIcon />
            </button>
            {moreOpen && (
              <>
                <div className="menu-catcher" onClick={() => setMoreOpen(false)} />
                <div className="dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setTab("leaderboard");
                      setMoreOpen(false);
                      if (leaderboard === null && !leaderboardBusy) void loadLeaderboard();
                    }}
                  >
                    <TrophyIcon />
                    Leaderboard
                  </button>
                  <div className="dropdown-divider" />
                  <a
                    className="dropdown-item"
                    href="https://github.com/Godwin-web3/keel"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMoreOpen(false)}
                  >
                    <ExternalLinkIcon />
                    View source
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

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
                    {busy ? (
                      <>
                        <SpinnerIcon /> Connecting...
                      </>
                    ) : (
                      "Connect Wallet"
                    )}
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  {injectedAvailable
                    ? "MetaMask, Rabby, or any injected wallet. Browse is free until you connect."
                    : "No wallet found. Install MetaMask or Rabby, then refresh."}
                </p>
                {!injectedAvailable && (
                  <a className="repo-link" href="https://metamask.io/download" target="_blank" rel="noreferrer">
                    Get MetaMask
                  </a>
                )}
              </>
            )}

            <div className="muted" style={{ marginTop: 12 }}>
              {!signedIn &&
                (connected
                  ? "Browsing live windows — connect to parlay, run, or claim."
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
              <h2>{pendingBet ? (pendingBet.kind === "parlay" ? "Confirm parlay" : "Confirm your bet") : "Place your bet"}</h2>
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
                <p className="ticket-edge">{formatEdge(selected.impliedUp, spotMovePct(spotPrice, selected.strike))}</p>
                {parlayPartner && (
                  <label className="parlay-toggle">
                    <input
                      type="checkbox"
                      checked={parlayOn}
                      onChange={(e) => setParlayOn(e.target.checked)}
                    />
                    Parlay with {parlayPartner.asset} {parlayPartner.timeframe} — both must hit. Venue does not list this.
                  </label>
                )}
                {parlayOn && parlayPartner && (
                  <div className="parlay-sides">
                    <span className="muted">{parlayPartner.asset} side</span>
                    <button type="button" className={parlaySideB === "up" ? "up" : "ghost"} onClick={() => setParlaySideB("up")}>
                      Up
                    </button>
                    <button type="button" className={parlaySideB === "down" ? "down" : "ghost"} onClick={() => setParlaySideB("down")}>
                      Down
                    </button>
                  </div>
                )}
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
                  {parlayOn && parlayPartner ? (
                    <>
                      <div>
                        <span>Both hit</span>
                        {formatUsd(quoteParlay(selected, "up", parlayPartner, parlaySideB, stake).redeemIfWin)}
                      </div>
                      <div>
                        <span>Combined odds</span>
                        {Math.round(quoteParlay(selected, "up", parlayPartner, parlaySideB, stake).implied * 100)}%
                      </div>
                      <div>
                        <span>Most you can lose</span>
                        {formatUsd(stake)}
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
                <div className="actions">
                  <button
                    className="up"
                    disabled={busy || !signedIn || selected.status !== "trading"}
                    onClick={() =>
                      parlayOn && parlayPartner
                        ? setPendingBet({ kind: "parlay", a: "up", b: parlaySideB })
                        : setPendingBet({ kind: "single", side: "up" })
                    }
                  >
                    {parlayOn ? `Up × ${parlayPartner?.asset} ${parlaySideB === "up" ? "Up" : "Down"}` : "Bet Up"}
                  </button>
                  <button
                    className="down"
                    disabled={busy || !signedIn || selected.status !== "trading"}
                    onClick={() =>
                      parlayOn && parlayPartner
                        ? setPendingBet({ kind: "parlay", a: "down", b: parlaySideB })
                        : setPendingBet({ kind: "single", side: "down" })
                    }
                  >
                    {parlayOn ? `Down × ${parlayPartner?.asset} ${parlaySideB === "up" ? "Up" : "Down"}` : "Bet Down"}
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  {selected.status !== "trading"
                    ? "This window isn't open for new bets right now."
                    : !signedIn
                      ? "Connect a wallet above to place a bet."
                      : parlayOn
                        ? "Stake splits across both windows. You only get paid if both sides hit."
                        : "You can only lose what you bet — never more."}
                </p>
              </>
            )}

            {pendingBet && pendingBet.kind === "single" && (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  {selected.asset} {selected.timeframe} ·{" "}
                  <span className={`confirm-side ${pendingBet.side}`}>{pendingBet.side === "up" ? "Up" : "Down"}</span>
                </p>
                <div className="ticket-math">
                  <div>
                    <span>You're staking</span>
                    {formatUsd(stake)}
                  </div>
                  <div>
                    <span>You get back if right</span>
                    {formatUsd(quoteTicket(pendingBet.side, stake, selected.impliedUp).redeemIfWin)}
                  </div>
                  <div>
                    <span>Most you can lose</span>
                    {formatUsd(stake)}
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    className={pendingBet.side}
                    disabled={busy}
                    onClick={() => {
                      const side = pendingBet.side;
                      closeBetSheet();
                      void onTrade(side);
                    }}
                  >
                    Confirm {pendingBet.side === "up" ? "Up" : "Down"}
                  </button>
                  <button className="ghost" onClick={() => setPendingBet(null)}>
                    Back
                  </button>
                </div>
              </>
            )}

            {pendingBet && pendingBet.kind === "parlay" && parlayPartner && (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  {selected.asset}{" "}
                  <span className={`confirm-side ${pendingBet.a}`}>{pendingBet.a === "up" ? "Up" : "Down"}</span>
                  {" × "}
                  {parlayPartner.asset}{" "}
                  <span className={`confirm-side ${pendingBet.b}`}>{pendingBet.b === "up" ? "Up" : "Down"}</span>
                </p>
                <div className="ticket-math">
                  <div>
                    <span>Total stake</span>
                    {formatUsd(stake)}
                  </div>
                  <div>
                    <span>Both hit</span>
                    {formatUsd(quoteParlay(selected, pendingBet.a, parlayPartner, pendingBet.b, stake).redeemIfWin)}
                  </div>
                  <div>
                    <span>Combined</span>
                    {Math.round(quoteParlay(selected, pendingBet.a, parlayPartner, pendingBet.b, stake).implied * 100)}%
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const a = pendingBet.a;
                      const b = pendingBet.b;
                      closeBetSheet();
                      void onParlay(a, b);
                    }}
                  >
                    Confirm parlay
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
        <button className={tab === "run" ? "active" : ""} onClick={() => setTab("run")}>
          Run{run?.status === "running" ? " · live" : ""}
        </button>
        <button className={tab === "desk" ? "active" : ""} onClick={() => setTab("desk")}>
          My bets{claimable.length > 0 ? ` · ${claimable.length} to claim` : ""}
        </button>
      </div>

      {tab === "run" && (
        <div className="grid single tab-enter">
          <RunCard
            markets={markets}
            signedIn={signedIn}
            busy={busy}
            run={run}
            stake={runStake}
            onStake={setRunStake}
            cashOutAt={runCashOut}
            onCashOutAt={setRunCashOut}
            stopAt={runStop}
            onStopAt={setRunStop}
            maxRounds={runMax}
            onMaxRounds={setRunMax}
            sameSide={runSameSide}
            onSameSide={setRunSameSide}
            asset={runAsset}
            onAsset={setRunAsset}
            onStart={() => void onStartRun()}
            onStop={onStopRun}
          />
        </div>
      )}

      {tab === "markets" && (
        <section className="card markets-full">
          <h2>Live windows</h2>
          {!busy && !connected && <p className="muted">Couldn't load windows. Try refreshing.</p>}
          {busy && markets.length === 0 && (
            <div className="market-list">
              {[0, 1].map((i) => (
                <div key={i} className="round-group">
                  <div className="skeleton skeleton-line" style={{ width: 120, height: 15, marginBottom: 10 }} />
                  <div className="round-card skeleton-card">
                    <div className="market-top">
                      <div className="skeleton skeleton-line" style={{ width: 44, height: 11 }} />
                      <div className="skeleton skeleton-circle" style={{ width: 26, height: 26 }} />
                    </div>
                    <div className="skeleton skeleton-line" style={{ height: 8, borderRadius: 999, margin: "12px 0 8px" }} />
                    <div className="skeleton skeleton-line" style={{ width: "70%", height: 13 }} />
                    <div className="skeleton skeleton-line" style={{ width: "45%", height: 11, marginTop: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!busy && connected && markets.length === 0 && (
            <p className="muted">No windows returned right now. Try refreshing in a moment.</p>
          )}
          <div className="market-list tab-enter">
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
        <div className="grid tab-enter">
          <section className="card">
            <h2>Your bets</h2>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={autoClaim}
                onChange={(e) => setAutoClaim(e.target.checked)}
                disabled={!signedIn}
              />
              Reactive claim — Keel watches settlement on your open windows and pulls winners. Losing sides are skipped. Voids redeem both sides.
            </label>
            <div className="actions" style={{ marginBottom: 14 }}>
              <button
                disabled={busy || claimable.length === 0 || !signedIn}
                onClick={() => {
                  void (async () => {
                    for (const item of claimable) {
                      if (item.estimatedPayout <= 0) continue;
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
              <p className="muted">Nothing to claim yet. Keel also scans finalized windows on-chain, not just this browser's history.</p>
            )}
            {claimable.map((c) => (
              <div key={`${c.marketId}:${c.side}`} className="market">
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
            <div className="edge-readout">
              <div className="edge-headline">
                <strong>{stats.winRate === null ? "—" : `${stats.winRate}%`}</strong>
                <span>
                  win rate{stats.settled > 0 ? ` · ${stats.wins} of ${stats.settled} settled bets` : " · nothing settled yet"}
                </span>
              </div>
              <div className="edge-sub">
                <span>
                  Wagered <strong>${formatUsd(stats.wagered)}</strong>
                </span>
                <span>
                  Won <strong>${formatUsd(stats.won)}</strong>
                </span>
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
        <div className="grid single tab-enter">
          <section className="card">
            <h2>Recent winning stakes</h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              Built from real fills on the last few settled windows — the wallets who bought onto the side that ended
              up winning. Not a full profit ranking (losing windows aren't netted out), just recent activity.
            </p>
            {leaderboardBusy && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
                <SpinnerIcon /> Reading recent settled windows...
              </div>
            )}
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
