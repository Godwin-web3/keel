import { useEffect, useMemo, useRef, useState } from "react";
import type { Claimable, JournalRow, MarketStatus, NetworkName, OpenPosition, RunState, Side, WindowMarket } from "./lib/types";
import {
  ASSET_ICON,
  detectAsset,
  formatCloseLabel,
  formatEdge,
  formatProb,
  formatUsd,
  formatWindow,
  money,
  coin,
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
  friendlyWalletError,
  getAccountAddress,
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
import { AUTO_REVEAL_WINDOW_SEC, canSeal, commitSeal, getSealAddress, inAutoRevealWindow, KEEL_SEAL_ADDRESSES, loadSeals, markSealPlaced, refundSeal, revealSeal, type LocalSeal } from "./lib/seal";
import PriceChart from "./PriceChart";
import Landing from "./Landing";
import RunCard from "./RunCard";
import { AssetAvatar, ChanceMeter, Identicon, RankMedal } from "./Brand";
import { LogoWordmark } from "./Logo";
import { ExternalLinkIcon, MarketsIcon, MenuIcon, MoonIcon, PositionsIcon, RunIcon, SpinnerIcon, SunIcon, TrophyIcon } from "./Icons";

type Tab = "markets" | "run" | "desk" | "leaderboard";
type HistoryFilter = "all" | "won" | "lost" | "collected";
type PendingBet = { kind: "single"; side: Side } | { kind: "parlay"; a: Side; b: Side } | null;
type DetailTarget =
  | { type: "sealed"; seal: LocalSeal }
  | { type: "open"; position: OpenPosition }
  | { type: "claimable"; claimable: Claimable }
  | { type: "activity"; row: JournalRow };

const DEFAULT_STAKE = 10;
const APP_HASH = "#/app";
const KIND_LABEL: Record<JournalRow["kind"], string> = {
  trade: "Filled",
  redeem: "Claimed",
  roll: "Rolled",
  note: "Note",
  parlay: "Parlay",
  run: "Run",
  commit: "Committed",
  reveal: "Revealed",
};

type Theme = "light" | "dark";
const THEME_KEY = "keel.theme";
const SEAL_PRIMER_KEY = "keel.sealPrimer.dismissed.v1";
const AUTO_REVEAL_KEY = "keel.autoReveal.v1";
const SHANNON_EXPLORER = "https://shannon-explorer.somnia.network";

function sealExplorerUrl(addr: string): string {
  return `${SHANNON_EXPLORER}/address/${addr}`;
}

function txExplorerUrl(hash: string): string {
  return `${SHANNON_EXPLORER}/tx/${hash}`;
}

function readSealPrimerOpen(): boolean {
  try {
    return localStorage.getItem(SEAL_PRIMER_KEY) !== "1";
  } catch {
    return true;
  }
}

/** Default ON — advanced users can turn off via Positions. */
function readAutoReveal(): boolean {
  try {
    const v = localStorage.getItem(AUTO_REVEAL_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
    return true;
  } catch {
    return true;
  }
}

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
  const [assetFilter, setAssetFilter] = useState<"ALL" | "BTC" | "ETH">("ALL");
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
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [markets, setMarkets] = useState<WindowMarket[]>([]);
  const [marketsLoaded, setMarketsLoaded] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [autoClaim, setAutoClaim] = useState(true);
  const [autoReveal, setAutoReveal] = useState(readAutoReveal);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingBet, setPendingBet] = useState<PendingBet>(null);
  const [parlayOn, setParlayOn] = useState(false);
  const [sealOn, setSealOn] = useState(true);
  const [seals, setSeals] = useState<LocalSeal[]>([]);
  const [parlaySideA, setParlaySideA] = useState<Side>("up");
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
  const [sealPrimerOpen, setSealPrimerOpen] = useState(readSealPrimerOpen);
  const [chartPoints, setChartPoints] = useState<ProbabilityPoint[]>([]);
  const [sparks, setSparks] = useState<Record<string, ProbabilityPoint[]>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const refreshingRef = useRef(false);
  const autoClaimingRef = useRef<Set<string>>(new Set());
  const autoRevealingRef = useRef<Set<string>>(new Set());
  const busyRef = useRef(false);
  const runRef = useRef<RunState | null>(null);
  runRef.current = run;
  busyRef.current = busy;
  const restakingRef = useRef(false);

  useEffect(() => {
    setJournal(loadJournal());
    setRun(loadRun());
    setSeals(loadSeals(network));
    autoRevealingRef.current.clear();
  }, [network]);

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

  function dismissSealPrimer() {
    setSealPrimerOpen(false);
    try {
      localStorage.setItem(SEAL_PRIMER_KEY, "1");
    } catch {
      /* private browsing — dismiss for this session only */
    }
  }

  function openSealBothTicket(m: WindowMarket) {
    if (!signedIn) {
      setSelectedId(m.marketId);
      setMoreOpen(false);
      setWalletOpen(true);
      setMessage({ kind: "error", text: "Connect a wallet to seal." });
      return;
    }
    setSelectedId(m.marketId);
    setSealOn(canSeal(m));
    setParlayOn(true);
    setPendingBet(null);
    setMoreOpen(false);
    setBetOpen(true);
  }

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-dismiss success/error toasts so they don't stick across Run/Markets.
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(id);
  }, [message]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  // Prevent background scroll while a sheet/menu is open (avoids "stuck" feel).
  useEffect(() => {
    if (!walletOpen && !betOpen && !moreOpen && !detail) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [walletOpen, betOpen, moreOpen, detail]);

  useEffect(() => {
    if (!walletOpen && !betOpen && !detail) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (detail) setDetail(null);
      else if (betOpen) closeBetSheet();
      else setWalletOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walletOpen, betOpen, detail]);

  function goTab(next: Tab) {
    setTab(next);
    setMessage(null);
    setMoreOpen(false);
  }

  useEffect(() => {
    function sync() {
      setEntered(isAppRoute());
    }
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  function enterApp(marketId?: string, side?: Side) {
    history.pushState(null, "", APP_HASH);
    setEntered(true);
    setTab("markets");
    if (marketId) {
      setSelectedId(marketId);
      setParlayOn(false);
      setSealOn(true);
      if (side) {
        setPendingBet({ kind: "single", side });
        setParlaySideA(side);
      } else {
        setPendingBet(null);
      }
      setBetOpen(true);
    }
  }

  function exitToLanding() {
    history.pushState(null, "", window.location.pathname + window.location.search);
    setEntered(false);
    setBetOpen(false);
    setWalletOpen(false);
  }

  function selectMarket(id: string) {
    setSelectedId(id);
    setPendingBet(null);
    setParlayOn(false);
    const m = markets.find((row) => row.marketId === id);
    setSealOn(m ? canSeal(m) : true);
    setMoreOpen(false);
    setBetOpen(true);
  }

  function openTicket(m: WindowMarket, side: Side) {
    if (!signedIn) {
      setSelectedId(m.marketId);
      setMoreOpen(false);
      setWalletOpen(true);
      setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
      return;
    }
    setSelectedId(m.marketId);
    setParlayOn(false);
    setSealOn(canSeal(m));
    setPendingBet({ kind: "single", side });
    setMoreOpen(false);
    setBetOpen(true);
  }

  function closeBetSheet(force = false) {
    if (busy && !force) return;
    setBetOpen(false);
    setPendingBet(null);
  }

  const selected = markets.find((m) => m.marketId === selectedId) ?? null;
  const parlayPartner = useMemo(
    () => (selected ? findParlayPartner(selected, markets) : null),
    [selected, markets],
  );

  const feedMarkets = useMemo(() => {
    const list = markets.filter((m) => assetFilter === "ALL" || m.asset === assetFilter);
    return [...list].sort((a, b) => {
      const live = (m: WindowMarket) => (m.status === "trading" ? 0 : 1);
      return live(a) - live(b) || a.expirySec - b.expirySec;
    });
  }, [markets, assetFilter]);

  useEffect(() => {
    const live = feedMarkets.filter((m) => m.status === "trading").slice(0, 8);
    if (live.length === 0) return;
    let cancelled = false;
    void Promise.all(
      live.map(async (m) => {
        const pts = await getMarketProbabilityHistory(m, { limit: 40 });
        if (!cancelled && pts.length > 1) {
          setSparks((s) => ({ ...s, [m.marketId]: pts }));
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [feedMarkets.map((m) => m.marketId).join("|")]);

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
    setLeaderboardError(null);
    try {
      const rows = await Promise.race([
        getRecentLeaderboard(),
        new Promise<LeaderboardEntry[]>((_, reject) =>
          setTimeout(() => reject(new Error("Leaderboard timed out")), 15000),
        ),
      ]);
      setLeaderboard(rows);
      if (rows.length === 0) setLeaderboardError(null);
    } catch (err) {
      setLeaderboard([]);
      setLeaderboardError(err instanceof Error ? err.message : "Couldn't load leaderboard.");
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
      setMarketsError(null);
      setMarketsLoaded(true);
      if (walletAddress) void discoverPositions(walletAddress);
      if (!silent) setMessage({ kind: "ok", text: `${rows.length} markets.` });
    } catch (err) {
      const text = friendlyWalletError(err);
      setMarketsLoaded(true);
      setMarketsError(text);
      if (!silent) setMessage({ kind: "error", text });
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
    setMarketsError(null);
    setMessage({ kind: "ok", text: "Loading markets…" });
    try {
      await connectExchange({ network: net });
      setConnected(true);
      setSignedIn(false);
      setWalletAddress(null);
      try {
        const rows = await listWindows();
        setMarkets(rows);
        setMarketsError(null);
        setMessage({ kind: "ok", text: `${rows.length} markets.` });
      } catch (err) {
        // Keep the read connection — Retry should only re-fetch windows.
        const text = friendlyWalletError(err);
        setMarketsError(text);
        setMessage({ kind: "error", text });
        setMarketsLoaded(true);
        return false;
      }
      setMarketsLoaded(true);
      return true;
    } catch (err) {
      setConnected(false);
      setMarketsLoaded(true);
      const text = friendlyWalletError(err);
      setMarketsError(text);
      setMessage({
        kind: "error",
        text,
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
      try {
        const rows = await listWindows();
        setMarkets(rows);
        setMarketsError(null);
        setMarketsLoaded(true);
        void discoverPositions(address);
        setWalletOpen(false);
        setMessage({
          kind: "ok",
          text: `Connected · ${maskKey(address)}. ${rows.length} markets.`,
        });
      } catch (err) {
        setMarketsLoaded(true);
        const text = friendlyWalletError(err);
        setMarketsError(text);
        setWalletOpen(false);
        setMessage({ kind: "error", text: `Connected · ${maskKey(address)}. Markets: ${text}` });
      }
      return true;
    } catch (err) {
      // Wrong-network / rejected connect must NOT leave a signed-in session.
      setSignedIn(false);
      setWalletAddress(null);
      setMessage({ kind: "error", text: friendlyWalletError(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await connectAndLoad(network);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onNetworkChange(next: NetworkName) {
    setNetwork(next);
    disconnectExchange();
    setConnected(false);
    setSignedIn(false);
    setWalletAddress(null);
    setOnchainPositions({ open: [], claimable: [] });
    setMarkets([]);
    setMarketsLoaded(false);
    setMarketsError(null);
    setSelectedId(null);
    void (async () => {
      await connectAndLoad(next);
    })();
  }

  function onDisconnect() {
    disconnectExchange();
    setConnected(false);
    setSignedIn(false);
    setWalletAddress(null);
    setOnchainPositions({ open: [], claimable: [] });
    setMarkets([]);
    setMarketsLoaded(false);
    setMarketsError(null);
    setMessage({ kind: "ok", text: "Disconnected. Nothing you connected with was ever saved anywhere." });
    void (async () => {
      await connectAndLoad(network);
    })();
  }

  async function onTrade(side: Side, market = selected, amount = stake, runId?: string) {
    if (!market) return;
    if (!signedIn) {
      setWalletOpen(true);
      setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
      return;
    }
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
      setMessage({ kind: "ok", text: `Execution successful${result.hash ? ` · ${shorten(result.hash)}` : ""}.` });
      return { hash: result.hash, quote: q };
    } catch (err) {
      setMessage({ kind: "error", text: friendlyWalletError(err) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onSeal(side: Side): Promise<boolean> {
    if (!selected) return false;
    setBusy(true);
    setMessage(null);
    try {
      const row = await commitSeal({ network, market: selected, side, amount: stake });
      setSeals(loadSeals(network));
      appendJournal({
        kind: "commit",
        marketId: selected.marketId,
        symbol: selected.symbol,
        asset: selected.asset,
        side,
        stake: stake,
        hash: row.commitHash,
        note: `Sealed ${selected.asset}. Side is hidden on-chain until you reveal.`,
      });
      setJournal(loadJournal());
      setTab("desk");
      setMessage({
        kind: "ok",
        text: "Sealed. Side stays hidden on-chain until you reveal.",
      });
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/4100|not been authorized|provider is not ready|unauthorized/i.test(raw)) {
        setMessage({ kind: "ok", text: "OKX couldn't seal. Placing the bet in the open." });
        const placed = await onTrade(side);
        return Boolean(placed);
      }
      setMessage({ kind: "error", text: friendlyWalletError(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onReveal(row: LocalSeal, opts?: { auto?: boolean }) {
    const market = markets.find((m) => m.marketId === row.marketId);
    const auto = Boolean(opts?.auto);
    setBusy(true);
    setMessage(null);
    try {
      await revealSeal(network, row);
      if (!market) {
        setSeals(loadSeals(network));
        setMessage({
          kind: "ok",
          text: auto
            ? "Auto-revealed. Execute when the window is open."
            : "Revealed. Execute when the window is open.",
        });
        return;
      }
      const placed = await placeStake({ market, side: row.side, stake: row.amount });
      markSealPlaced(network, row.id, placed.hash);
      setSeals(loadSeals(network));
      appendJournal({
        kind: "reveal",
        marketId: row.marketId,
        symbol: row.symbol,
        asset: row.asset,
        side: row.side,
        stake: row.amount,
        hash: placed.hash,
        note: auto ? "Auto-revealed near deadline and placed on DreamDEX." : "Revealed and placed on DreamDEX.",
      });
      setJournal(loadJournal());
      setMessage({
        kind: "ok",
        text: `${auto ? "Auto-revealed" : "Revealed"} and placed${placed.hash ? ` · ${shorten(placed.hash)}` : ""}.`,
      });
    } catch (err) {
      setSeals(loadSeals(network));
      setMessage({ kind: "error", text: friendlyWalletError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRefundSeal(row: LocalSeal) {
    setBusy(true);
    setMessage(null);
    try {
      await refundSeal(network, row);
      setSeals(loadSeals(network));
      appendJournal({
        kind: "commit",
        marketId: row.marketId,
        symbol: row.symbol,
        asset: row.asset,
        side: row.side,
        stake: row.amount,
        note: "Refunded. Side was never shown.",
      });
      setJournal(loadJournal());
      setMessage({ kind: "ok", text: "Returned. The side was never shown." });
    } catch (err) {
      setMessage({ kind: "error", text: friendlyWalletError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onParlay(aSide: Side, bSide: Side): Promise<boolean> {
    if (!selected || !parlayPartner) return false;
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
      const allFailed = failed.length === placed.legs.length;
      setMessage({
        kind: allFailed ? "error" : "ok",
        text:
          failed.length === 0
            ? `Parlay filled · ${selected.asset} × ${parlayPartner.asset}. Both must hit.`
            : `Parlay partial: ${failed.map((f) => f.error).join(" · ")}`,
      });
      return !allFailed;
    } catch (err) {
      setMessage({ kind: "error", text: friendlyWalletError(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Two-leg sealed commit — same half/half stake split as open parlay. */
  async function onSealedParlay(aSide: Side, bSide: Side): Promise<boolean> {
    if (!selected || !parlayPartner) return false;
    if (!canSeal(selected) || !canSeal(parlayPartner)) {
      setMessage({
        kind: "error",
        text: "Too close to close to seal both. Place in the open, or pick later windows.",
      });
      return false;
    }
    const q = quoteParlay(selected, aSide, parlayPartner, bSide, stake);
    const parlayId = crypto.randomUUID();
    setBusy(true);
    setMessage(null);
    try {
      const rowA = await commitSeal({
        network,
        market: selected,
        side: aSide,
        amount: q.legs[0].stake,
        parlayId,
      });
      const rowB = await commitSeal({
        network,
        market: parlayPartner,
        side: bSide,
        amount: q.legs[1].stake,
        parlayId,
      });
      setSeals(loadSeals(network));
      appendJournal({
        kind: "parlay",
        marketId: selected.marketId,
        symbol: `${selected.asset}×${parlayPartner.asset}`,
        asset: selected.asset,
        stake,
        parlayId,
        note: `Sealed double · ${selected.asset} ${aSide === "up" ? "Up" : "Down"} × ${parlayPartner.asset} ${bSide === "up" ? "Up" : "Down"} · sides hidden until reveal · ${q.legs[0].stake.toFixed(2)}+${q.legs[1].stake.toFixed(2)} ${coin(network)}`,
      });
      for (const [i, row] of [rowA, rowB].entries()) {
        const m = i === 0 ? selected : parlayPartner;
        const side = i === 0 ? aSide : bSide;
        appendJournal({
          kind: "commit",
          marketId: m.marketId,
          symbol: m.symbol,
          asset: m.asset,
          side,
          stake: q.legs[i].stake,
          hash: row.commitHash,
          parlayId,
          note: `Sealed ${m.asset}. Side is hidden on-chain until you reveal.`,
        });
      }
      setJournal(loadJournal());
      setTab("desk");
      setMessage({
        kind: "ok",
        text: `Sealed both · ${selected.asset} × ${parlayPartner.asset}. Reveal each on Positions.`,
      });
      return true;
    } catch (err) {
      setSeals(loadSeals(network));
      setMessage({ kind: "error", text: friendlyWalletError(err) });
      return false;
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
      setMessage({ kind: "ok", text: `Next round: ${next.asset} · ${money(nextStake, network)}.` });
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
          ? "Window cancelled - your commitment was refunded"
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
      setMessage({ kind: "error", text: friendlyWalletError(err) });
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

  // Auto-reveal: as the reveal deadline approaches, reveal + place once so a
  // user who sealed and walked away still lands a DreamDEX trade. Manual
  // Reveal / Refund stay available; past revealBy we never auto-reveal.
  useEffect(() => {
    if (!autoReveal || !signedIn) return;
    if (busyRef.current) return;
    const nowSec = nowMs / 1000;
    for (const row of seals) {
      if (row.status !== "sealed") continue;
      if (autoRevealingRef.current.has(row.id)) continue;
      if (!inAutoRevealWindow(row.revealBy, nowSec)) continue;
      autoRevealingRef.current.add(row.id);
      void onReveal(row, { auto: true });
      break; // one at a time — busy guards the rest until the next tick
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seals, nowMs, autoReveal, signedIn, network, markets]);


  function journalFor(marketId: string, side?: Side): JournalRow[] {
    return journal.filter(
      (r) => r.marketId === marketId && (side == null || r.side == null || r.side === side),
    );
  }

  function openActivityDetail(row: JournalRow) {
    const sealed = seals.find(
      (s) =>
        s.status === "sealed" &&
        s.marketId === row.marketId &&
        (row.side == null || s.side === row.side),
    );
    if (sealed) {
      setDetail({ type: "sealed", seal: sealed });
      return;
    }
    const openPos = open.find(
      (p) => p.marketId === row.marketId && (row.side == null || p.side === row.side),
    );
    if (openPos) {
      setDetail({ type: "open", position: openPos });
      return;
    }
    const claim = claimable.find(
      (c) => c.marketId === row.marketId && (row.side == null || c.side === row.side),
    );
    if (claim) {
      setDetail({ type: "claimable", claimable: claim });
      return;
    }
    setDetail({ type: "activity", row });
  }

  function setAutoRevealPref(next: boolean) {
    setAutoReveal(next);
    try {
      localStorage.setItem(AUTO_REVEAL_KEY, next ? "1" : "0");
    } catch {
      /* private browsing — session-only */
    }
  }

  function shareWin(row: JournalRow) {
    const asset = row.asset ?? detectAsset(row.symbol || row.marketId);
    const sideWord = row.side === "up" ? "Up" : row.side === "down" ? "Down" : "";
    const amount = row.payout !== undefined ? formatUsd(row.payout) : null;
    const text = amount
      ? `BTC/ETH window on Keel: ${asset} ${sideWord} paid $${amount}`
      : `Settled a window on Keel`;
    const url = `${window.location.origin}${window.location.pathname}`;
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
    return <Landing onLaunch={enterApp} markets={markets} nowMs={nowMs} />;
  }

  return (
    <div className="app">
      <nav className="app-nav">
        <div className="brand-row">
          <LogoWordmark onClick={exitToLanding} />
        </div>
        <div className="nav-actions">
          {totalUnclaimed > 0 && (
            <button className="unclaimed-pill" onClick={() => goTab("desk")}>
              {money(totalUnclaimed, network)} to claim
            </button>
          )}
          <button className={`wallet-trigger ${signedIn ? "signed-in" : "connect-cta"}`} onClick={() => { setMoreOpen(false); setWalletOpen(true); }}>
            {signedIn && walletAddress ? maskKey(walletAddress) : "Connect"}
          </button>
          <button className="theme-trigger" aria-label="Toggle color theme" onClick={toggleTheme}>
            {(theme ?? "dark") === "dark" ? (
              <SunIcon />
            ) : (
              <MoonIcon />
            )}
          </button>
          <div className={`more-menu-wrap ${moreOpen ? "open" : ""}`}>
            <button
              className={`more-trigger ${moreOpen ? "active" : ""}`}
              aria-label="More"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MenuIcon />
            </button>
            {moreOpen && (
              <>
                <div
                  className="menu-catcher"
                  role="presentation"
                  onClick={() => setMoreOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMoreOpen(false);
                  }}
                />
                <div className="dropdown-menu dropdown-menu--trust" role="menu">
                  <div className="dropdown-blurb">
                    <strong>What is Keel?</strong>
                    <p>
                      Commit–reveal for DreamDEX Event Contracts. Seal hides your side on-chain until
                      reveal. Leave and Keel auto-reveals in the last ~45s; refund before then to cancel.
                    </p>
                  </div>
                  <div className="dropdown-divider" />
                  <div className="dropdown-meta">
                    <span className="dropdown-meta-label">Network</span>
                    <span>{network === "shannon" ? "Shannon (practice · tUSDC)" : "Somnia mainnet (USDso)"}</span>
                  </div>
                  {(() => {
                    const sealAddr = getSealAddress(network) ?? KEEL_SEAL_ADDRESSES.shannon;
                    if (!sealAddr) return null;
                    return (
                      <div className="dropdown-meta">
                        <span className="dropdown-meta-label">KeelSeal</span>
                        <a
                          className="dropdown-meta-link"
                          href={sealExplorerUrl(sealAddr)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setMoreOpen(false)}
                        >
                          {shorten(sealAddr, 4)}
                          <ExternalLinkIcon size={12} />
                        </a>
                      </div>
                    );
                  })()}
                  <div className="dropdown-divider" />
                  <a
                    className="dropdown-item"
                    href="/pitch-deck.html"
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                  >
                    <ExternalLinkIcon />
                    Pitch deck
                  </a>
                  <a
                    className="dropdown-item"
                    href="/sdk-notes.html"
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                  >
                    <ExternalLinkIcon />
                    SDK & docs feedback
                  </a>
                  <a
                    className="dropdown-item"
                    href="https://github.com/Godwin-web3/keel"
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                  >
                    <ExternalLinkIcon />
                    GitHub
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
                <option value="shannon">Practice (tUSDC)</option>
                <option value="mainnet">Live (USDso)</option>
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
                    ? "Use MetaMask or Rabby. You can look around first."
                    : "No wallet found. Install MetaMask, then refresh."}
                </p>
                {!injectedAvailable && (
                  <a className="repo-link" href="https://metamask.io/download" target="_blank" rel="noreferrer">
                    Get MetaMask
                  </a>
                )}
              </>
            )}

            <div className="wallet-trust">
              <p className="wallet-trust-title">Keel on {network === "shannon" ? "Shannon" : "mainnet"}</p>
              <p className="muted">
                Seal is the default path: commit stake with the side hidden, reveal to place on DreamDEX.
                Leave and auto-reveal fires in the last ~45s; refund before then to cancel. Practice uses
                tUSDC on Shannon.
              </p>
              {(() => {
                const sealAddr = getSealAddress(network) ?? KEEL_SEAL_ADDRESSES.shannon;
                if (!sealAddr) return null;
                return (
                  <a className="repo-link" href={sealExplorerUrl(sealAddr)} target="_blank" rel="noreferrer">
                    KeelSeal {shorten(sealAddr, 4)}
                  </a>
                );
              })()}
            </div>
            <div className="muted" style={{ marginTop: 12 }}>
              {!signedIn &&
                (connected
                  ? "Looking around — connect a wallet to seal."
                  : busy
                    ? "Loading markets..."
                    : "You can look around without a wallet.")}
            </div>
          </div>
        </div>
      )}

      {betOpen && selected && (
        <div className="confirm-backdrop" onClick={() => closeBetSheet()}>
          <div className="confirm-card bet-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-sheet-head">
              <h2>
                {pendingBet
                  ? pendingBet.kind === "parlay"
                    ? sealOn
                      ? "Confirm sealed double"
                      : "Confirm both commitments"
                    : sealOn
                      ? "Confirm seal"
                      : "Confirm"
                  : "Commit"}
              </h2>
              <button className="ghost" disabled={busy} onClick={() => closeBetSheet()}>
                Close
              </button>
            </div>

            {!pendingBet && (
              <>
                <p className="plain">
                  {selected.asset === "OTHER" ? "This market" : selected.asset} · {formatWindow(selected.timeframe)}
                </p>
                <PriceChart points={chartPoints} height={140} liveUp={selected.impliedUp} />
                <p className="ticket-edge">{formatEdge(selected.impliedUp, spotMovePct(spotPrice, selected.strike))}</p>
                {parlayPartner && (
                  <label className="parlay-toggle">
                    <input
                      type="checkbox"
                      checked={parlayOn}
                      onChange={(e) => setParlayOn(e.target.checked)}
                    />
                    Also {sealOn ? "seal" : "bet"} on {parlayPartner.asset} in the same {formatWindow(parlayPartner.timeframe)}.
                    {sealOn
                      ? " Both sides stay hidden until you reveal each."
                      : " You only get paid if both are right."}
                  </label>
                )}
                {canSeal(selected) ? (
                  <>
                    {sealOn && (
                      <div className="seal-story">
                        <p className="seal-story-kicker">Sealed by default</p>
                        <p>
                          Side stays hidden on-chain until you Reveal on Positions. If you leave, Keel
                          auto-reveals in the last ~{AUTO_REVEAL_WINDOW_SEC}s before the deadline so the
                          trade still goes through. Refund anytime before that to cancel — side never
                          shown.
                        </p>
                      </div>
                    )}
                    <label className="parlay-toggle parlay-toggle--advanced">
                      <input
                        type="checkbox"
                        checked={!sealOn}
                        onChange={(e) => setSealOn(!e.target.checked)}
                      />
                      Place in the open (advanced) — skip commit–reveal; side is visible on DreamDEX immediately.
                    </label>
                  </>
                ) : (
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Too close to close to seal — placing in the open.
                  </p>
                )}
                {parlayOn && parlayPartner && (
                  <>
                    <div className="parlay-sides">
                      <span className="muted">{selected.asset} side</span>
                      <button type="button" className={parlaySideA === "up" ? "up" : "ghost"} onClick={() => setParlaySideA("up")}>
                        Up
                      </button>
                      <button type="button" className={parlaySideA === "down" ? "down" : "ghost"} onClick={() => setParlaySideA("down")}>
                        Down
                      </button>
                    </div>
                    <div className="parlay-sides">
                      <span className="muted">{parlayPartner.asset} side</span>
                      <button type="button" className={parlaySideB === "up" ? "up" : "ghost"} onClick={() => setParlaySideB("up")}>
                        Up
                      </button>
                      <button type="button" className={parlaySideB === "down" ? "down" : "ghost"} onClick={() => setParlaySideB("down")}>
                        Down
                      </button>
                    </div>
                  </>
                )}
                <label className="stake-label">
                  How much ({coin(network)})
                  <div className="stake-input">
                    <span>{coin(network)}</span>
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
                        <span>If both win</span>
                        {money(quoteParlay(selected, parlaySideA, parlayPartner, parlaySideB, stake).redeemIfWin, network)}
                      </div>
                      <div>
                        <span>Chance both win</span>
                        {Math.round(quoteParlay(selected, parlaySideA, parlayPartner, parlaySideB, stake).implied * 100)}%
                      </div>
                      <div>
                        <span>If you're wrong</span>
                        {money(0, network)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span>If Up wins</span>
                        {money(quoteTicket("up", stake, selected.impliedUp).redeemIfWin, network)}
                      </div>
                      <div>
                        <span>If Down wins</span>
                        {money(quoteTicket("down", stake, selected.impliedUp).redeemIfWin, network)}
                      </div>
                      <div>
                        <span>If you're wrong</span>
                        {money(0, network)}
                      </div>
                    </>
                  )}
                </div>
                <div className="actions">
                  {parlayOn && parlayPartner ? (
                    <button
                      disabled={busy || selected.status !== "trading"}
                      onClick={() => {
                        if (!signedIn) {
                          setMoreOpen(false);
                          setWalletOpen(true);
                          setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
                          return;
                        }
                        setPendingBet({ kind: "parlay", a: parlaySideA, b: parlaySideB });
                      }}
                    >
                      {!signedIn
                        ? "Connect to review"
                        : sealOn
                          ? `Seal both · ${selected.asset} ${parlaySideA === "up" ? "Up" : "Down"} × ${parlayPartner.asset} ${parlaySideB === "up" ? "Up" : "Down"}`
                          : `Review ${selected.asset} ${parlaySideA === "up" ? "Up" : "Down"} × ${parlayPartner.asset} ${parlaySideB === "up" ? "Up" : "Down"}`}
                    </button>
                  ) : (
                    <>
                      <button
                        className="up"
                        disabled={busy || selected.status !== "trading"}
                        onClick={() => {
                          if (!signedIn) {
                            setMoreOpen(false);
                            setWalletOpen(true);
                            setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
                            return;
                          }
                          setPendingBet({ kind: "single", side: "up" });
                        }}
                      >
                        {!signedIn ? "Connect to Seal Up" : sealOn ? "Seal Up" : "Place Up"}
                      </button>
                      <button
                        className="down"
                        disabled={busy || selected.status !== "trading"}
                        onClick={() => {
                          if (!signedIn) {
                            setMoreOpen(false);
                            setWalletOpen(true);
                            setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
                            return;
                          }
                          setPendingBet({ kind: "single", side: "down" });
                        }}
                      >
                        {!signedIn ? "Connect to Seal Down" : sealOn ? "Seal Down" : "Place Down"}
                      </button>
                    </>
                  )}
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  {selected.status !== "trading"
                    ? "This one isn't open right now."
                    : !signedIn
                        ? "Connect your wallet to place this."
                        : sealOn
                          ? "Sealing commits your stake now; your side stays hidden until you Reveal on Positions."
                          : "Open place — side is visible on DreamDEX immediately. You only lose what you put in."}
                </p>
              </>
            )}

            {pendingBet && pendingBet.kind === "single" && (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  {selected.asset} · {formatWindow(selected.timeframe)} ·{" "}
                  <span className={`confirm-side ${pendingBet.side}`}>{pendingBet.side === "up" ? "Up" : "Down"}</span>
                  {sealOn ? " · sealed" : " · open"}
                </p>
                {sealOn && (
                  <div className="seal-story seal-story--compact">
                    <p>
                      Commit now — side hidden until Reveal. After reveal, Keel places on DreamDEX. If
                      you leave, Keel auto-reveals in the last ~{AUTO_REVEAL_WINDOW_SEC}s before the deadline so
                      the trade still goes through. Refund anytime before that to cancel — side never
                      shown.
                    </p>
                  </div>
                )}
                <div className="ticket-math">
                  <div>
                    <span>You put in</span>
                    {money(stake, network)}
                  </div>
                  <div>
                    <span>You get back if right</span>
                    {money(quoteTicket(pendingBet.side, stake, selected.impliedUp).redeemIfWin, network)}
                  </div>
                  <div>
                    <span>If you're wrong</span>
                    {money(0, network)}
                  </div>
                </div>
                {message?.kind === "error" && <div className="sheet-error">{message.text}</div>}
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    className={pendingBet.side}
                    disabled={busy}
                    onClick={() => {
                      if (!signedIn) {
                        setWalletOpen(true);
                        setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
                        return;
                      }
                      const side = pendingBet.side;
                      void (async () => {
                        const ok = sealOn ? await onSeal(side) : Boolean(await onTrade(side));
                        if (ok) closeBetSheet(true);
                      })();
                    }}
                  >
                    {!signedIn
                      ? "Connect to confirm"
                      : busy
                        ? sealOn
                          ? "Sealing…"
                          : "Placing…"
                        : sealOn
                          ? `Seal ${pendingBet.side === "up" ? "Up" : "Down"}`
                          : `Place ${pendingBet.side === "up" ? "Up" : "Down"}`}
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => setPendingBet(null)}>
                    Back
                  </button>
                </div>
                {!signedIn && (
                  <p className="muted" style={{ marginTop: 12 }}>
                    Connect a wallet before confirming.
                  </p>
                )}
              </>
            )}

            {pendingBet && pendingBet.kind === "parlay" && parlayPartner && (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  {sealOn ? "Sealed double · " : ""}
                  {selected.asset}{" "}
                  <span className={`confirm-side ${pendingBet.a}`}>{pendingBet.a === "up" ? "Up" : "Down"}</span>
                  {" × "}
                  {parlayPartner.asset}{" "}
                  <span className={`confirm-side ${pendingBet.b}`}>{pendingBet.b === "up" ? "Up" : "Down"}</span>
                </p>
                <div className="ticket-math">
                  <div>
                    <span>You put in</span>
                    {money(stake, network)}
                  </div>
                  <div>
                    <span>{sealOn ? "Stake each leg" : "If both win"}</span>
                    {sealOn
                      ? money(stake / 2, network)
                      : money(quoteParlay(selected, pendingBet.a, parlayPartner, pendingBet.b, stake).redeemIfWin, network)}
                  </div>
                  <div>
                    <span>{sealOn ? "Sides until reveal" : "Chance both win"}</span>
                    {sealOn
                      ? "Hidden"
                      : `${Math.round(quoteParlay(selected, pendingBet.a, parlayPartner, pendingBet.b, stake).implied * 100)}%`}
                  </div>
                </div>
                {sealOn && (
                  <div className="seal-story seal-story--compact">
                    <p className="seal-story-kicker">Sealed double</p>
                    <p>
                      Stake splits half/half like a parlay. Each leg is its own seal — reveal and place
                      them separately on Positions. If you leave, Keel auto-reveals each leg in the last
                      ~{AUTO_REVEAL_WINDOW_SEC}s before its deadline. Refund anytime before that to cancel — side
                      never shown.
                    </p>
                  </div>
                )}
                <div className="actions" style={{ marginTop: 16 }}>
                  {message?.kind === "error" && <div className="sheet-error">{message.text}</div>}
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!signedIn) {
                        setWalletOpen(true);
                        setMessage({ kind: "error", text: "Connect a wallet to place a bet." });
                        return;
                      }
                      const a = pendingBet.a;
                      const b = pendingBet.b;
                      void (async () => {
                        const ok = sealOn ? await onSealedParlay(a, b) : await onParlay(a, b);
                        if (ok) closeBetSheet(true);
                      })();
                    }}
                  >
                    {!signedIn
                      ? "Connect to confirm"
                      : busy
                        ? sealOn
                          ? "Sealing both…"
                          : "Placing…"
                        : sealOn
                          ? "Seal both"
                          : "Confirm both commitments"}
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => setPendingBet(null)}>
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <nav className="bottom-nav">
        <button className={tab === "markets" ? "active" : ""} onClick={() => goTab("markets")}>
          <MarketsIcon size={22} />
          Markets
        </button>
        <button className={tab === "run" ? "active" : ""} onClick={() => goTab("run")}>
          <RunIcon size={22} />
          Run
        </button>
        <button className={tab === "desk" ? "active" : ""} onClick={() => goTab("desk")}>
          <PositionsIcon size={22} />
          Positions{claimable.length > 0 ? ` · ${claimable.length}` : ""}
        </button>
        <button
          className={tab === "leaderboard" ? "active" : ""}
          onClick={() => {
            goTab("leaderboard");
            if (leaderboard === null && !leaderboardBusy) void loadLeaderboard();
          }}
        >
          <TrophyIcon size={22} />
          Leaders
        </button>
      </nav>

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
            coin={coin(network)}
          />
        </div>
      )}

      {tab === "markets" && (
        <section className="feed">
          <div className="feed-head">
            <div className="feed-head-copy">
              <h1>Markets</h1>
              <p className="feed-sub">Live Event Contract windows — seal hides your side until reveal (auto in the last ~45s if you leave).</p>
            </div>
            <div className="asset-chips">
              {(["ALL", "BTC", "ETH"] as const).map((a) => (
                <button key={a} className={assetFilter === a ? "on" : ""} onClick={() => setAssetFilter(a)}>
                  {a === "ALL" ? "All" : a}
                </button>
              ))}
            </div>
          </div>
          <div className="seal-default-row" aria-label="Sealed by default">
            <span className="seal-default-pill">Sealed by default</span>
            <span className="muted seal-default-hint">Commit → Hold → Reveal (or auto ~45s) → Claim · Place in the open stays advanced</span>
          </div>
          {sealPrimerOpen && (
            <aside className="seal-primer" role="note">
              <div className="seal-primer-copy">
                <p className="seal-primer-kicker">How sealing works</p>
                <ol className="seal-primer-steps">
                  <li>
                    <strong>Commit</strong> — stake on-chain; observers see a seal, not Up or Down.
                  </li>
                  <li>
                    <strong>Hold</strong> — KeelSeal escrows until you reveal or the deadline passes.
                  </li>
                  <li>
                    <strong>Reveal</strong> — unseal, then place on DreamDEX from Positions. If you
                    leave, Keel auto-reveals in the last ~{AUTO_REVEAL_WINDOW_SEC}s before the deadline so
                    the trade still goes through.
                  </li>
                  <li>
                    <strong>Claim</strong> — refund anytime before auto-reveal to cancel (side never
                    shown); winners redeem after settlement.
                  </li>
                </ol>
              </div>
              <button type="button" className="ghost seal-primer-dismiss" onClick={dismissSealPrimer}>
                Got it
              </button>
            </aside>
          )}
          {!busy && marketsLoaded && (marketsError || (!connected && markets.length === 0)) && (
            <div className="feed-empty">
              <p className="feed-empty-title">Markets didn't load</p>
              <p className="muted">{marketsError ?? "Couldn't reach DreamDEX right now."}</p>
              <button className="ghost" onClick={() => void connectAndLoad(network)}>
                Retry
              </button>
            </div>
          )}
          {(busy || !marketsLoaded) && markets.length === 0 && (
            <div className="pm-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="pm-card skeleton-card">
                  <div className="skeleton skeleton-circle" style={{ width: 40, height: 40 }} />
                  <div className="skeleton skeleton-line" style={{ width: "70%", height: 16, marginTop: 12 }} />
                  <div className="skeleton skeleton-line" style={{ height: 36, marginTop: 16 }} />
                </div>
              ))}
            </div>
          )}
          {!busy && marketsLoaded && !marketsError && connected && feedMarkets.length === 0 && (
            <div className="feed-empty">
              <p className="feed-empty-title">No live windows</p>
              <p className="muted">Nothing trading in this filter. Check back shortly, or switch BTC / ETH.</p>
              <button className="ghost" onClick={() => void connectAndLoad(network)}>
                Retry
              </button>
            </div>
          )}
          <div className="pm-grid tab-enter">
            {feedMarkets.slice(0, 24).map((m) => {
              const upPct = m.impliedUp === null ? null : Math.round(m.impliedUp * 100);
              const secondsLeft = m.expirySec ? m.expirySec - nowMs / 1000 : m.secondsLeft;
              const live = m.status === "trading";
              const oddsReady = upPct !== null;
              const partner = findParlayPartner(m, markets);
              const canSealBoth = Boolean(partner && live && canSeal(m) && canSeal(partner));
              return (
                <article
                  key={m.marketId}
                  className={`pm-card ${live ? "live" : ""} ${selected?.marketId === m.marketId ? "selected" : ""}`}
                  onClick={() => selectMarket(m.marketId)}
                >
                  <div className="pm-top">
                    <AssetAvatar asset={m.asset} size={42} />
                    <div className="pm-copy">
                      <p className="pm-kicker">
                        {live && <span className="live-pip" />}
                        {m.asset} · {formatWindow(m.timeframe)}
                        {live && canSeal(m) && <span className="pm-seal-tag">Seal</span>}
                      </p>
                      <h3>Will {m.asset} go up in the next {formatWindow(m.timeframe)}?</h3>
                    </div>
                    {oddsReady ? (
                      <ChanceMeter pct={upPct} />
                    ) : live ? (
                      <div className="chance-meter skeleton skeleton-circle" style={{ width: 52, height: 52 }} aria-hidden />
                    ) : null}
                  </div>
                  {sparks[m.marketId] && sparks[m.marketId].length > 1 && (
                    <PriceChart points={sparks[m.marketId]} height={72} liveUp={m.impliedUp} />
                  )}
                  <div className="pm-actions">
                    <button
                      className="pm-up"
                      disabled={!live}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicket(m, "up");
                      }}
                    >
                      {live && canSeal(m)
                        ? oddsReady
                          ? `Seal Up ${upPct}%`
                          : "Seal Up"
                        : oddsReady
                          ? `Up ${upPct}%`
                          : "Up"}
                    </button>
                    <button
                      className="pm-down"
                      disabled={!live}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicket(m, "down");
                      }}
                    >
                      {live && canSeal(m)
                        ? oddsReady
                          ? `Seal Down ${100 - upPct!}%`
                          : "Seal Down"
                        : oddsReady
                          ? `Down ${100 - upPct!}%`
                          : "Down"}
                    </button>
                  </div>
                  {canSealBoth && partner && (
                    <button
                      type="button"
                      className="pm-seal-both"
                      onClick={(e) => {
                        e.stopPropagation();
                        openSealBothTicket(m);
                      }}
                    >
                      Seal both · {m.asset} × {partner.asset}
                    </button>
                  )}
                  <p className="pm-meta">{formatCloseLabel(m.expirySec, secondsLeft)}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "desk" && (
        <div className="grid tab-enter desk-page">
          <section className="card desk-card">
            <h2>Positions</h2>
            <p className="desk-lede">
              Sealed tickets first — tap any row for detail. Reveal to place on DreamDEX. If you leave,
              Keel auto-reveals in the last ~{AUTO_REVEAL_WINDOW_SEC}s before the deadline so the trade still goes
              through. Refund anytime before that to cancel. Open fills and claims sit below.
            </p>
            <div className="desk-section desk-section--sealed">
              <div className="desk-section-head">
                <h3 className="muted">Sealed</h3>
                {seals.some((s) => s.status === "sealed") && (
                  <span className="desk-count">{seals.filter((s) => s.status === "sealed").length}</span>
                )}
              </div>
              <p className="desk-section-note">
                Hidden on-chain until you reveal. Reveal places on DreamDEX. Auto-reveal fires in the last{" "}
                {AUTO_REVEAL_WINDOW_SEC}s if you leave — refund anytime before that to cancel.
              </p>
              {!seals.some((s) => s.status === "sealed") ? (
                <p className="desk-empty desk-empty--teach">
                  No seals yet. From Markets, Seal Up or Down — your side stays private until you reveal
                  here.
                </p>
              ) : (
                seals
                  .filter((s) => s.status === "sealed")
                  .map((s) => {
                    const left = s.revealBy - nowMs / 1000;
                    const late = left <= 0;
                    const mins = Math.max(0, Math.floor(left / 60));
                    const secs = Math.max(0, Math.floor(left % 60));
                    return (
                      <div
                        key={s.id}
                        className={`market seal-row ${late ? "late" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetail({ type: "sealed", seal: s })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetail({ type: "sealed", seal: s });
                          }
                        }}
                      >
                        <div className="market-top">
                          <strong className="market-name">
                            <span className="asset-icon">{ASSET_ICON[s.asset]}</span>
                            {s.asset}{" "}
                            <span className="muted">
                              · {formatWindow(s.timeframe)} · {s.side === "up" ? "Up" : "Down"} · {money(s.amount, network)}
                              {s.parlayId ? " · double" : ""}
                            </span>
                          </strong>
                          {late ? (
                            <button
                              className="seal-cta refund"
                              disabled={busy || !signedIn}
                              onClick={(e) => {
                                e.stopPropagation();
                                void onRefundSeal(s);
                              }}
                            >
                              Refund
                            </button>
                          ) : (
                            <button
                              className="seal-cta reveal"
                              disabled={busy || !signedIn}
                              onClick={(e) => {
                                e.stopPropagation();
                                void onReveal(s);
                              }}
                            >
                              Reveal
                            </button>
                          )}
                        </div>
                        <div className={`seal-countdown ${late ? "late" : ""}`}>
                          {late
                            ? "Reveal window closed — side was never shown. Claim your refund."
                            : inAutoRevealWindow(s.revealBy, nowMs / 1000) && autoReveal
                              ? `Auto-reveal in ${mins}m ${String(secs).padStart(2, "0")}s — or Reveal now / Refund to cancel.`
                              : `Reveal within ${mins}m ${String(secs).padStart(2, "0")}s or refund.`}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
            <div className="desk-toolbar">
              <div className="desk-prefs">
                <label className="muted desk-autoclose">
                  <input
                    type="checkbox"
                    checked={autoReveal}
                    onChange={(e) => setAutoRevealPref(e.target.checked)}
                    disabled={!signedIn}
                  />
                  Auto-reveal near deadline
                </label>
                <label className="muted desk-autoclose">
                  <input
                    type="checkbox"
                    checked={autoClaim}
                    onChange={(e) => setAutoClaim(e.target.checked)}
                    disabled={!signedIn}
                  />
                  Auto-claim when a position settles
                </label>
              </div>
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
                Claim all
              </button>
            </div>
            <div className="desk-section">
              <h3 className="muted">Open</h3>
              {open.length === 0 ? (
                <p className="desk-empty">No open fills yet. After you reveal a seal (or place in the open), live tickets land here until settlement.</p>
              ) : (
                open.map((p) => (
                  <div
                    key={p.marketId + p.side}
                    className="market"
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail({ type: "open", position: p })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail({ type: "open", position: p });
                      }
                    }}
                  >
                    <div className="market-top">
                      <strong className="market-name">
                        <span className="asset-icon">{ASSET_ICON[p.asset]}</span>
                        {p.asset} <span className="muted">· {formatWindow(p.timeframe)}</span>
                      </strong>
                      <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <div className="muted">
                      {p.stake !== null ? (
                        <>
                          You put {money(p.stake, network)} on <strong className={p.side}>{p.side === "up" ? "Up" : "Down"}</strong>
                          {p.entryProb !== null ? ` · ${formatProb(p.entryProb)} chance` : ""}
                        </>
                      ) : (
                        <>
                          You have {formatUsd(p.contracts, 3)} contracts on{" "}
                          <strong className={p.side}>{p.side === "up" ? "Up" : "Down"}</strong>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="desk-section">
              <h3 className="muted">Claim</h3>
              {claimable.length === 0 ? (
                <p className="desk-empty">Nothing to claim yet. Settled winners show up here — or turn on auto-claim above.</p>
              ) : (
                claimable.map((c) => (
                  <div
                    key={`${c.marketId}:${c.side}`}
                    className="market"
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetail({ type: "claimable", claimable: c })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail({ type: "claimable", claimable: c });
                      }
                    }}
                  >
                    <div className="market-top">
                      <strong className="market-name">
                        <span className="asset-icon">{ASSET_ICON[c.asset]}</span>
                        {c.asset} <span className="muted">· {formatWindow(c.timeframe)} · {c.side === "up" ? "Up" : "Down"}</span>
                      </strong>
                      <button
                        disabled={busy || !signedIn}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRedeem(c.marketId, c.symbol, c.side, c.asset, c.estimatedPayout);
                        }}
                      >
                        Claim {money(c.estimatedPayout, network)}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="card desk-card">
            <h2>Activity</h2>
            <div className="edge-readout">
              <div className="edge-headline">
                <strong>{stats.winRate === null ? "—" : `${stats.winRate}%`}</strong>
                <span>
                  won{stats.settled > 0 ? ` · ${stats.wins} of ${stats.settled}` : " · nothing finished yet"}
                </span>
              </div>
              <div className="edge-sub">
                <span>
                  Put in <strong>{money(stats.wagered, network)}</strong>
                </span>
                <span>
                  Won <strong>{money(stats.won, network)}</strong>
                </span>
              </div>
            </div>
            <div className="filter-chips" role="tablist" aria-label="Activity filters">
              {(["all", "won", "lost", "collected"] as HistoryFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={historyFilter === f ? "active" : ""}
                  onClick={() => setHistoryFilter(f)}
                >
                  {f === "all" ? "All" : f === "won" ? "Won" : f === "lost" ? "Lost" : "Collected"}
                </button>
              ))}
            </div>
            {filteredJournal.length === 0 ? (
              <p className="desk-empty">
                {journal.length === 0
                  ? "No activity yet. Trades you place stay on this device."
                  : "Nothing matches this filter."}
              </p>
            ) : (
              <div className="activity-list">
                {filteredJournal.map((row) => {
                  const asset = row.asset ?? detectAsset(row.symbol || row.marketId);
                  return (
                    <article
                      key={row.id}
                      className="activity-row activity-row--clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => openActivityDetail(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openActivityDetail(row);
                        }
                      }}
                    >
                      <div className="activity-row-top">
                        <span className="activity-kind">{KIND_LABEL[row.kind] ?? row.kind}</span>
                        <time className="activity-when">{new Date(row.at).toLocaleString()}</time>
                      </div>
                      <div className="activity-row-main">
                        <span className="asset-icon">{ASSET_ICON[asset]}</span>
                        <strong>{asset}</strong>
                        <span className="muted">
                          {row.side ? (row.side === "up" ? "Up" : "Down") : ""}
                          {row.side && row.stake !== undefined ? " · " : ""}
                          {row.stake !== undefined ? money(row.stake, network) : ""}
                        </span>
                      </div>
                      <div className="activity-row-detail muted">
                        {row.hash ? shorten(row.hash) : row.note || row.result || ""}
                        {row.kind === "redeem" && row.result === "win" && (
                          <button
                            className="share-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              shareWin(row);
                            }}
                          >
                            Share
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "leaderboard" && (
        <section className="lb">
          <div className="lb-head">
            <h1>Leaderboard</h1>
            <button className="ghost" disabled={leaderboardBusy} onClick={() => void loadLeaderboard()}>
              {leaderboardBusy ? "Loading…" : "Refresh"}
            </button>
          </div>
          <p className="muted lb-note">Recent winners on DreamDEX windows — rank and PnL, not a raw address dump.</p>
          <div className="lb-table">
            <div className="lb-cols">
              <span>Rank</span>
              <span>Trader</span>
              <span>Wins</span>
              <span>Won</span>
            </div>
            {leaderboardBusy && leaderboard === null && (
              <div className="lb-empty">
                <SpinnerIcon /> Loading…
              </div>
            )}
            {!leaderboardBusy && leaderboardError && (
              <div className="lb-empty">
                {leaderboardError}{" "}
                <button className="ghost" onClick={() => void loadLeaderboard()}>
                  Retry
                </button>
              </div>
            )}
            {!leaderboardBusy && !leaderboardError && leaderboard !== null && leaderboard.length === 0 && (
              <div className="lb-empty">Nobody on the board yet.</div>
            )}
            {!leaderboardError &&
              leaderboard?.map((entry, i) => (
              <div key={entry.address} className={`lb-row ${i < 3 ? "podium" : ""}`}>
                <RankMedal rank={i + 1} />
                <div className="lb-trader">
                  <Identicon seed={entry.address} size={32} />
                  <span>{maskKey(entry.address)}</span>
                </div>
                <span className="lb-wins">{entry.wins}</span>
                <span className="lb-won">{money(entry.volumeWon, network)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {detail && (
        <div className="confirm-backdrop" onClick={() => setDetail(null)}>
          <div
            className="confirm-card bet-sheet position-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="position-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wallet-sheet-head">
              <h2 id="position-detail-title">
                {detail.type === "sealed"
                  ? "Sealed ticket"
                  : detail.type === "open"
                    ? "Open position"
                    : detail.type === "claimable"
                      ? "Claimable"
                      : "Activity"}
              </h2>
              <button type="button" className="ghost" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>

            {detail.type === "sealed" &&
              (() => {
                const s = seals.find((x) => x.id === detail.seal.id) ?? detail.seal;
                const left = s.revealBy - nowMs / 1000;
                const late = left <= 0;
                const mins = Math.max(0, Math.floor(left / 60));
                const secs = Math.max(0, Math.floor(left % 60));
                const autoSoon = !late && inAutoRevealWindow(s.revealBy, nowMs / 1000) && autoReveal;
                return (
                  <>
                    <div className="detail-hero">
                      <span className="asset-icon">{ASSET_ICON[s.asset]}</span>
                      <div>
                        <strong>
                          {s.asset} · {formatWindow(s.timeframe)}
                        </strong>
                        <p className="muted">
                          Your side{" "}
                          <span className={`confirm-side ${s.side}`}>
                            {s.side === "up" ? "Up" : "Down"}
                          </span>
                          {s.parlayId ? " · sealed double leg" : ""}
                        </p>
                      </div>
                    </div>
                    <dl className="detail-grid">
                      <div>
                        <dt>Stake</dt>
                        <dd>{money(s.amount, network)}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{late ? "Reveal window closed" : "Sealed"}</dd>
                      </div>
                      <div>
                        <dt>Reveal by</dt>
                        <dd className={late ? "detail-warn" : ""}>
                          {late
                            ? "Closed"
                            : `${mins}m ${String(secs).padStart(2, "0")}s`}
                        </dd>
                      </div>
                      <div>
                        <dt>Auto-reveal</dt>
                        <dd>
                          {autoReveal
                            ? autoSoon
                              ? "Firing soon (on)"
                              : `On · last ~${AUTO_REVEAL_WINDOW_SEC}s`
                            : "Off — reveal manually or refund"}
                        </dd>
                      </div>
                      {s.commitHash && (
                        <div className="detail-span">
                          <dt>Commit tx</dt>
                          <dd>
                            <a
                              href={txExplorerUrl(s.commitHash)}
                              target="_blank"
                              rel="noreferrer"
                              className="detail-link"
                            >
                              {shorten(s.commitHash)}
                              <ExternalLinkIcon size={12} />
                            </a>
                          </dd>
                        </div>
                      )}
                      <div className="detail-span">
                        <dt>Market</dt>
                        <dd className="detail-mono">{shorten(s.marketId, 8)}</dd>
                      </div>
                    </dl>
                    <p className="detail-explain">
                      {late
                        ? "The reveal window closed without unsealing. Your side was never shown on-chain — claim the refund to get your stake back."
                        : autoReveal
                          ? `Side stays hidden until you Reveal. If you leave, Keel auto-reveals in the last ~${AUTO_REVEAL_WINDOW_SEC}s so the trade still places. Refund anytime before that to cancel — side never shown.`
                          : "Side stays hidden until you Reveal on Positions. Auto-reveal is off for this device — reveal yourself or refund to cancel."}
                    </p>
                    <div className="detail-actions">
                      {!late && (
                        <button
                          className="seal-cta reveal"
                          disabled={busy || !signedIn}
                          onClick={() => {
                            void (async () => {
                              await onReveal(s);
                              const still = loadSeals(network).find(
                                (x) => x.id === s.id && x.status === "sealed",
                              );
                              if (!still) setDetail(null);
                            })();
                          }}
                        >
                          Reveal
                        </button>
                      )}
                      <button
                        className="seal-cta refund"
                        disabled={busy || !signedIn}
                        onClick={() => {
                          void (async () => {
                            await onRefundSeal(s);
                            const still = loadSeals(network).find(
                              (x) => x.id === s.id && x.status === "sealed",
                            );
                            if (!still) setDetail(null);
                          })();
                        }}
                      >
                        Refund
                      </button>
                    </div>
                  </>
                );
              })()}

            {detail.type === "open" &&
              (() => {
                const p = detail.position;
                const related = journalFor(p.marketId, p.side);
                const placeRow =
                  related.find((r) => r.kind === "trade" || r.kind === "reveal" || r.kind === "parlay") ??
                  null;
                const commitRow = related.find((r) => r.kind === "commit") ?? null;
                const revealRow = related.find((r) => r.kind === "reveal") ?? null;
                return (
                  <>
                    <div className="detail-hero">
                      <span className="asset-icon">{ASSET_ICON[p.asset]}</span>
                      <div>
                        <strong>
                          {p.asset} · {formatWindow(p.timeframe)}
                        </strong>
                        <p className="muted">
                          <span className={`confirm-side ${p.side}`}>
                            {p.side === "up" ? "Up" : "Down"}
                          </span>
                          {" · "}
                          <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                          {p.parlayId ? " · double" : ""}
                          {p.fromChain ? " · on-chain" : ""}
                        </p>
                      </div>
                    </div>
                    <dl className="detail-grid">
                      <div>
                        <dt>Stake</dt>
                        <dd>{p.stake !== null ? money(p.stake, network) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Entry chance</dt>
                        <dd>{p.entryProb !== null ? formatProb(p.entryProb) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Contracts</dt>
                        <dd>{p.contracts > 0 ? formatUsd(p.contracts, 3) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{STATUS_LABEL[p.status]}</dd>
                      </div>
                      {placeRow?.hash && (
                        <div className="detail-span">
                          <dt>Place / trade tx</dt>
                          <dd>
                            <a
                              href={txExplorerUrl(placeRow.hash)}
                              target="_blank"
                              rel="noreferrer"
                              className="detail-link"
                            >
                              {shorten(placeRow.hash)}
                              <ExternalLinkIcon size={12} />
                            </a>
                          </dd>
                        </div>
                      )}
                      <div className="detail-span">
                        <dt>Market id</dt>
                        <dd className="detail-mono">{shorten(p.marketId, 8)}</dd>
                      </div>
                      {commitRow && (
                        <div className="detail-span">
                          <dt>Sealed</dt>
                          <dd>{new Date(commitRow.at).toLocaleString()}</dd>
                        </div>
                      )}
                      {revealRow && (
                        <div className="detail-span">
                          <dt>Revealed</dt>
                          <dd>{new Date(revealRow.at).toLocaleString()}</dd>
                        </div>
                      )}
                    </dl>
                    <p className="detail-explain">
                      Live ticket on DreamDEX until the window settles. Claim winners from Positions when
                      the market resolves.
                    </p>
                  </>
                );
              })()}

            {detail.type === "claimable" &&
              (() => {
                const c = detail.claimable;
                const market = markets.find((m) => m.marketId === c.marketId);
                return (
                  <>
                    <div className="detail-hero">
                      <span className="asset-icon">{ASSET_ICON[c.asset]}</span>
                      <div>
                        <strong>
                          {c.asset} · {formatWindow(c.timeframe)}
                        </strong>
                        <p className="muted">
                          <span className={`confirm-side ${c.side}`}>
                            {c.side === "up" ? "Up" : "Down"}
                          </span>
                          {c.resolved ? " · settled" : " · settling"}
                          {c.fromChain ? " · on-chain" : ""}
                        </p>
                      </div>
                    </div>
                    <dl className="detail-grid">
                      <div>
                        <dt>Payout est.</dt>
                        <dd>{money(c.estimatedPayout, network)}</dd>
                      </div>
                      <div>
                        <dt>Contracts</dt>
                        <dd>{formatUsd(c.contracts, 3)}</dd>
                      </div>
                      <div className="detail-span">
                        <dt>Market</dt>
                        <dd className="detail-mono">{shorten(c.marketId, 8)}</dd>
                      </div>
                      {market && (
                        <div className="detail-span">
                          <dt>Settlement</dt>
                          <dd>
                            {STATUS_LABEL[market.status]}
                            {market.winningOutcome != null
                              ? ` · winner ${market.winningOutcome === 1 ? "Up" : market.winningOutcome === 2 ? "Down" : market.winningOutcome}`
                              : ""}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <p className="detail-explain">
                      Window settled in your favor. Claim to pull payout into your wallet
                      {autoClaim ? " — auto-claim is on for this device." : "."}
                    </p>
                    <div className="detail-actions">
                      <button
                        disabled={busy || !signedIn || c.estimatedPayout <= 0}
                        onClick={() => {
                          void (async () => {
                            try {
                              await onRedeem(c.marketId, c.symbol, c.side, c.asset, c.estimatedPayout);
                              setDetail(null);
                            } catch {
                              /* onRedeem surfaces errors via toast */
                            }
                          })();
                        }}
                      >
                        Claim {money(c.estimatedPayout, network)}
                      </button>
                    </div>
                  </>
                );
              })()}

            {detail.type === "activity" &&
              (() => {
                const row = detail.row;
                const asset = row.asset ?? detectAsset(row.symbol || row.marketId);
                return (
                  <>
                    <div className="detail-hero">
                      <span className="asset-icon">{ASSET_ICON[asset]}</span>
                      <div>
                        <strong>
                          {asset}
                          {row.side ? ` · ${row.side === "up" ? "Up" : "Down"}` : ""}
                        </strong>
                        <p className="muted">
                          {KIND_LABEL[row.kind] ?? row.kind} · {new Date(row.at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <dl className="detail-grid">
                      {row.stake !== undefined && (
                        <div>
                          <dt>Stake</dt>
                          <dd>{money(row.stake, network)}</dd>
                        </div>
                      )}
                      {row.entryProb !== undefined && (
                        <div>
                          <dt>Entry chance</dt>
                          <dd>{formatProb(row.entryProb)}</dd>
                        </div>
                      )}
                      {row.payout !== undefined && (
                        <div>
                          <dt>Payout</dt>
                          <dd>{money(row.payout, network)}</dd>
                        </div>
                      )}
                      {row.result && (
                        <div>
                          <dt>Result</dt>
                          <dd>{row.result}</dd>
                        </div>
                      )}
                      {row.hash && (
                        <div className="detail-span">
                          <dt>Tx</dt>
                          <dd>
                            <a
                              href={txExplorerUrl(row.hash)}
                              target="_blank"
                              rel="noreferrer"
                              className="detail-link"
                            >
                              {shorten(row.hash)}
                              <ExternalLinkIcon size={12} />
                            </a>
                          </dd>
                        </div>
                      )}
                      {row.marketId && (
                        <div className="detail-span">
                          <dt>Market</dt>
                          <dd className="detail-mono">{shorten(row.marketId, 8)}</dd>
                        </div>
                      )}
                      {row.note && (
                        <div className="detail-span">
                          <dt>Note</dt>
                          <dd>{row.note}</dd>
                        </div>
                      )}
                    </dl>
                    {row.kind === "redeem" && row.result === "win" && (
                      <div className="detail-actions">
                        <button type="button" className="ghost" onClick={() => shareWin(row)}>
                          Share
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
          </div>
        </div>
      )}
    </div>
  );
}
