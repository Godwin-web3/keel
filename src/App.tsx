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
import { canSeal, commitSeal, loadSeals, markSealPlaced, refundSeal, revealSeal, type LocalSeal } from "./lib/seal";
import PriceChart from "./PriceChart";
import Landing from "./Landing";
import RunCard from "./RunCard";
import { AssetAvatar, ChanceMeter, Identicon, RankMedal } from "./Brand";
import { LogoWordmark } from "./Logo";
import { ExternalLinkIcon, MarketsIcon, MenuIcon, MoonIcon, PositionsIcon, RunIcon, SpinnerIcon, SunIcon, TrophyIcon } from "./Icons";

type Tab = "markets" | "run" | "desk" | "leaderboard";
type HistoryFilter = "all" | "won" | "lost" | "collected";
type PendingBet = { kind: "single"; side: Side } | { kind: "parlay"; a: Side; b: Side } | null;

const DEFAULT_STAKE = 10;
const APP_HASH = "#/app";
const KIND_LABEL: Record<JournalRow["kind"], string> = {
  trade: "Filled",
  redeem: "Claimed",
  roll: "Rolled",
  note: "Note",
  parlay: "Parlay",
  run: "Run",
  seal: "Sealed",
  unseal: "Unsealed",
};

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
  const [sealOn, setSealOn] = useState(true);
  const [seals, setSeals] = useState<LocalSeal[]>([]);
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
  const [sparks, setSparks] = useState<Record<string, ProbabilityPoint[]>>({});
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
    setSeals(loadSeals(network));
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

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  function enterApp(marketId?: string) {
    history.pushState(null, "", APP_HASH);
    setEntered(true);
    setTab("markets");
    if (marketId) {
      setSelectedId(marketId);
      setPendingBet(null);
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
    setBetOpen(true);
  }

  function openTicket(m: WindowMarket, side: Side) {
    setSelectedId(m.marketId);
    setPendingBet({ kind: "single", side });
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
      if (!silent) setMessage({ kind: "ok", text: `${rows.length} markets.` });
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
      setMessage({ kind: "ok", text: `${rows.length} markets.` });
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
      const rows = await listWindows();
      setMarkets(rows);
      void discoverPositions(address);
      setWalletOpen(false);
      setMessage({
        kind: "ok",
        text: `Connected · ${maskKey(address)}. ${rows.length} markets.`,
      });
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (connected || busy) return;
    void (async () => {
      const authorized = await getAuthorizedInjectedAddress();
      if (authorized) {
        const ok = await connectInjected();
        if (!ok) await connectAndLoad(network);
      } else {
        await connectAndLoad(network);
      }
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

  async function onSeal(side: Side) {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const row = await commitSeal({ network, market: selected, side, amount: stake });
      setSeals(loadSeals(network));
      appendJournal({
        kind: "seal",
        marketId: selected.marketId,
        symbol: selected.symbol,
        asset: selected.asset,
        side,
        stake: stake,
        hash: row.commitHash,
        note: `Sealed ${selected.asset}. Side is hidden on-chain until you unseal.`,
      });
      setJournal(loadJournal());
      setTab("desk");
      setMessage({
        kind: "ok",
        text: `Sealed. The book cannot see ${side === "up" ? "Up" : "Down"} until you unseal.`,
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onUnseal(row: LocalSeal) {
    const market = markets.find((m) => m.marketId === row.marketId);
    setBusy(true);
    setMessage(null);
    try {
      await revealSeal(network, row);
      if (!market) {
        setSeals(loadSeals(network));
        setMessage({ kind: "ok", text: "Unsealed. Place the bet when the window is open." });
        return;
      }
      const placed = await placeStake({ market, side: row.side, stake: row.amount });
      markSealPlaced(network, row.id, placed.hash);
      setSeals(loadSeals(network));
      appendJournal({
        kind: "unseal",
        marketId: row.marketId,
        symbol: row.symbol,
        asset: row.asset,
        side: row.side,
        stake: row.amount,
        hash: placed.hash,
        note: "Unsealed and placed on DreamDEX.",
      });
      setJournal(loadJournal());
      setMessage({
        kind: "ok",
        text: `Unsealed and placed${placed.hash ? ` · ${shorten(placed.hash)}` : ""}.`,
      });
    } catch (err) {
      setSeals(loadSeals(network));
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
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
        kind: "seal",
        marketId: row.marketId,
        symbol: row.symbol,
        asset: row.asset,
        side: row.side,
        stake: row.amount,
        note: "Missed the unseal window. Money returned.",
      });
      setJournal(loadJournal());
      setMessage({ kind: "ok", text: "Returned. The side was never shown." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
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
            <button className="unclaimed-pill" onClick={() => setTab("desk")}>
              {money(totalUnclaimed, network)} to claim
            </button>
          )}
          <button className={`wallet-trigger ${signedIn ? "signed-in" : "connect-cta"}`} onClick={() => setWalletOpen(true)}>
            {signedIn && walletAddress ? maskKey(walletAddress) : "Connect"}
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
                  <a
                    className="dropdown-item"
                    href="https://github.com/Godwin-web3/keel"
                    target="_blank"
                    rel="noreferrer"
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

            <div className="muted" style={{ marginTop: 12 }}>
              {!signedIn &&
                (connected
                  ? "Looking around — connect a wallet to bet."
                  : busy
                    ? "Loading markets..."
                    : "You can look around without a wallet.")}
            </div>
          </div>
        </div>
      )}

      {betOpen && selected && (
        <div className="confirm-backdrop" onClick={closeBetSheet}>
          <div className="confirm-card bet-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-sheet-head">
              <h2>{pendingBet ? (pendingBet.kind === "parlay" ? "Confirm both bets" : "Confirm") : "Place a bet"}</h2>
              <button className="ghost" onClick={closeBetSheet}>
                Close
              </button>
            </div>

            {!pendingBet && (
              <>
                <p className="plain">
                  {selected.asset === "OTHER" ? "This market" : selected.asset} · {formatWindow(selected.timeframe)}
                </p>
                <PriceChart points={chartPoints} height={140} />
                <p className="ticket-edge">{formatEdge(selected.impliedUp, spotMovePct(spotPrice, selected.strike))}</p>
                {parlayPartner && (
                  <label className="parlay-toggle">
                    <input
                      type="checkbox"
                      checked={parlayOn}
                      onChange={(e) => {
                        setParlayOn(e.target.checked);
                        if (e.target.checked) setSealOn(false);
                      }}
                    />
                    Also bet on {parlayPartner.asset} in the same {formatWindow(parlayPartner.timeframe)}. You only get paid if both are right.
                  </label>
                )}
                <label className="parlay-toggle">
                  <input
                    type="checkbox"
                    checked={sealOn && !parlayOn}
                    onChange={(e) => {
                      setSealOn(e.target.checked);
                      if (e.target.checked) setParlayOn(false);
                    }}
                    disabled={!canSeal(selected) && !sealOn}
                  />
                  Seal this bet. The book cannot see Up or Down until you unseal.
                </label>
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
                        {money(quoteParlay(selected, "up", parlayPartner, parlaySideB, stake).redeemIfWin, network)}
                      </div>
                      <div>
                        <span>Chance both win</span>
                        {Math.round(quoteParlay(selected, "up", parlayPartner, parlaySideB, stake).implied * 100)}%
                      </div>
                      <div>
                        <span>If you're wrong</span>
                        {money(stake, network)}
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
                        {money(stake, network)}
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
                    ? "This one isn't open right now."
                    : !signedIn
                      ? "Connect your wallet to place this."
                      : sealOn
                        ? "Seal it first. Nobody sees your side until you unseal."
                        : "You only lose what you put in."}
                </p>
              </>
            )}

            {pendingBet && pendingBet.kind === "single" && (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  {selected.asset} · {formatWindow(selected.timeframe)} ·{" "}
                  <span className={`confirm-side ${pendingBet.side}`}>{pendingBet.side === "up" ? "Up" : "Down"}</span>
                </p>
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
                    {money(stake, network)}
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    className={pendingBet.side}
                    disabled={busy}
                    onClick={() => {
                      const side = pendingBet.side;
                      closeBetSheet();
                      if (sealOn) void onSeal(side);
                      else void onTrade(side);
                    }}
                  >
                    {sealOn ? `Seal ${pendingBet.side === "up" ? "Up" : "Down"}` : `Confirm ${pendingBet.side === "up" ? "Up" : "Down"}`}
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
                    <span>You put in</span>
                    {money(stake, network)}
                  </div>
                  <div>
                    <span>If both win</span>
                    {money(quoteParlay(selected, pendingBet.a, parlayPartner, pendingBet.b, stake).redeemIfWin, network)}
                  </div>
                  <div>
                    <span>Chance both win</span>
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
                    Confirm both bets
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

      <nav className="bottom-nav">
        <button className={tab === "markets" ? "active" : ""} onClick={() => setTab("markets")}>
          <MarketsIcon size={22} />
          Markets
        </button>
        <button className={tab === "run" ? "active" : ""} onClick={() => setTab("run")}>
          <RunIcon size={22} />
          Run
        </button>
        <button className={tab === "desk" ? "active" : ""} onClick={() => setTab("desk")}>
          <PositionsIcon size={22} />
          Bets{claimable.length > 0 ? ` · ${claimable.length}` : ""}
        </button>
        <button
          className={tab === "leaderboard" ? "active" : ""}
          onClick={() => {
            setTab("leaderboard");
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
            <h1>Markets</h1>
            <div className="asset-chips">
              {(["ALL", "BTC", "ETH"] as const).map((a) => (
                <button key={a} className={assetFilter === a ? "on" : ""} onClick={() => setAssetFilter(a)}>
                  {a === "ALL" ? "All" : a}
                </button>
              ))}
            </div>
          </div>
          {!busy && !connected && <p className="muted">Couldn't load markets. Try refresh.</p>}
          {busy && markets.length === 0 && (
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
          {!busy && connected && feedMarkets.length === 0 && (
            <p className="muted">No markets right now. Try again in a bit.</p>
          )}
          <div className="pm-grid tab-enter">
            {feedMarkets.slice(0, 24).map((m) => {
              const upPct = m.impliedUp === null ? null : Math.round(m.impliedUp * 100);
              const secondsLeft = m.expirySec ? m.expirySec - nowMs / 1000 : m.secondsLeft;
              const live = m.status === "trading";
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
                      </p>
                      <h3>Will {m.asset} go up in the next {formatWindow(m.timeframe)}?</h3>
                    </div>
                    {upPct !== null && <ChanceMeter pct={upPct} />}
                  </div>
                  {sparks[m.marketId] && sparks[m.marketId].length > 1 && (
                    <PriceChart points={sparks[m.marketId]} height={72} />
                  )}
                  <div className="pm-actions">
                    <button
                      className="pm-up"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicket(m, "up");
                      }}
                    >
                      Up {upPct === null ? "" : `${upPct}%`}
                    </button>
                    <button
                      className="pm-down"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicket(m, "down");
                      }}
                    >
                      Down {upPct === null ? "" : `${100 - upPct}%`}
                    </button>
                  </div>
                  <p className="pm-meta">{formatCloseLabel(m.expirySec, secondsLeft)}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "desk" && (
        <div className="grid tab-enter">
          <section className="card">
            <h2>Your bets</h2>
            {seals.some((s) => s.status === "sealed") && (
              <>
                <h3 className="muted">Sealed</h3>
                <p className="muted" style={{ marginTop: -6, marginBottom: 10 }}>
                  Hidden on-chain. Unseal to place it on DreamDEX. Miss the time and the money comes back.
                </p>
                {seals
                  .filter((s) => s.status === "sealed")
                  .map((s) => {
                    const left = s.revealBy - nowMs / 1000;
                    const late = left <= 0;
                    return (
                      <div key={s.id} className="market">
                        <div className="market-top">
                          <strong className="market-name">
                            <span className="asset-icon">{ASSET_ICON[s.asset]}</span>
                            {s.asset}{" "}
                            <span className="muted">
                              · {formatWindow(s.timeframe)} · {s.side === "up" ? "Up" : "Down"} · {money(s.amount, network)}
                            </span>
                          </strong>
                          {late ? (
                            <button disabled={busy || !signedIn} onClick={() => void onRefundSeal(s)}>
                              Get money back
                            </button>
                          ) : (
                            <button disabled={busy || !signedIn} onClick={() => void onUnseal(s)}>
                              Unseal
                            </button>
                          )}
                        </div>
                        <div className="muted">
                          {late
                            ? "Time to unseal has passed. The side was never shown."
                            : `Unseal in the next ${Math.max(0, Math.floor(left / 60))}m ${String(Math.max(0, Math.floor(left % 60))).padStart(2, "0")}s`}
                        </div>
                      </div>
                    );
                  })}
              </>
            )}
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={autoClaim}
                onChange={(e) => setAutoClaim(e.target.checked)}
                disabled={!signedIn}
              />
              Pay me automatically when a bet settles.
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
            <h3 className="muted">Open</h3>
            {open.length === 0 && <p className="muted">No open bets.</p>}
            {open.map((p) => (
              <div key={p.marketId + p.side} className="market">
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
            ))}
            <h3 className="muted">Ready to claim</h3>
            {claimable.length === 0 && (
              <p className="muted">Nothing to collect yet.</p>
            )}
            {claimable.map((c) => (
              <div key={`${c.marketId}:${c.side}`} className="market">
                <div className="market-top">
                  <strong className="market-name">
                    <span className="asset-icon">{ASSET_ICON[c.asset]}</span>
                    {c.asset} <span className="muted">· {formatWindow(c.timeframe)} · {c.side === "up" ? "Up" : "Down"}</span>
                  </strong>
                  <button
                    disabled={busy || !signedIn}
                    onClick={() => void onRedeem(c.marketId, c.symbol, c.side, c.asset, c.estimatedPayout)}
                  >
                    Claim {money(c.estimatedPayout, network)}
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
                        ? "Nothing here yet. This list stays on this phone or computer."
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
                      {row.stake !== undefined ? `${money(row.stake, network)} · ` : ""}
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
        <section className="lb">
          <div className="lb-head">
            <h1>Leaderboard</h1>
            <button className="ghost" disabled={leaderboardBusy} onClick={() => void loadLeaderboard()}>
              {leaderboardBusy ? "Loading…" : "Refresh"}
            </button>
          </div>
          <p className="muted lb-note">Who won recently — people who picked the right side.</p>
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
            {!leaderboardBusy && leaderboard !== null && leaderboard.length === 0 && (
              <div className="lb-empty">Nobody on the board yet.</div>
            )}
            {leaderboard?.map((entry, i) => (
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
    </div>
  );
}
