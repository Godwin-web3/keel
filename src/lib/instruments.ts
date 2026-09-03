import type { ParlayQuote, RunHop, RunState, Side, WindowMarket } from "./types";
import { quoteTicket } from "./format";

const RUN_KEY = "keel.run.v1";

/** Other live window to parlay against — same cadence, closest expiry. */
export function findParlayPartner(selected: WindowMarket, markets: WindowMarket[]): WindowMarket | null {
  const other = selected.asset === "BTC" ? "ETH" : selected.asset === "ETH" ? "BTC" : null;
  if (!other) return null;
  const live = markets.filter((m) => m.asset === other && m.status === "trading" && m.marketId !== selected.marketId);
  if (live.length === 0) return null;
  const sameTf = live.filter((m) => m.timeframe === selected.timeframe);
  const pool = sameTf.length > 0 ? sameTf : live;
  return [...pool].sort((a, b) => Math.abs(a.expirySec - selected.expirySec) - Math.abs(b.expirySec - selected.expirySec))[0];
}

/** Split total stake across two independent Event Contracts. Both must hit. */
export function quoteParlay(
  a: WindowMarket,
  aSide: Side,
  b: WindowMarket,
  bSide: Side,
  totalStake: number,
): ParlayQuote {
  const half = totalStake / 2;
  const qa = quoteTicket(aSide, half, a.impliedUp);
  const qb = quoteTicket(bSide, half, b.impliedUp);
  return {
    stake: totalStake,
    implied: qa.entryProb * qb.entryProb,
    redeemIfWin: qa.redeemIfWin + qb.redeemIfWin,
    maxLoss: totalStake,
    legs: [
      { ...qa, asset: a.asset, marketId: a.marketId },
      { ...qb, asset: b.asset, marketId: b.marketId },
    ],
  };
}

export function findSuccessor(current: WindowMarket, markets: WindowMarket[]): WindowMarket | null {
  const same = markets
    .filter(
      (m) =>
        m.status === "trading" &&
        m.marketId !== current.marketId &&
        m.asset === current.asset &&
        m.timeframe === current.timeframe &&
        m.expirySec > current.expirySec,
    )
    .sort((a, b) => a.expirySec - b.expirySec);
  if (same[0]) return same[0];
  return (
    markets
      .filter((m) => m.status === "trading" && m.marketId !== current.marketId && m.asset === current.asset)
      .sort((a, b) => a.expirySec - b.expirySec)[0] ?? null
  );
}

export function findLiveWindow(markets: WindowMarket[], asset: "BTC" | "ETH", timeframe?: string): WindowMarket | null {
  const live = markets.filter((m) => m.status === "trading" && m.asset === asset);
  const pool = timeframe ? live.filter((m) => m.timeframe === timeframe) : live;
  return [...(pool.length ? pool : live)].sort((a, b) => a.expirySec - b.expirySec)[0] ?? null;
}

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunState;
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

export function saveRun(run: RunState | null): void {
  try {
    if (!run) localStorage.removeItem(RUN_KEY);
    else localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    /* private browsing */
  }
}

export function newRun(args: {
  stake: number;
  cashOutAt: number;
  stopAt: number;
  maxRounds: number;
  sameSide: boolean;
  asset: "BTC" | "ETH";
  timeframe: string;
}): RunState {
  return {
    id: crypto.randomUUID(),
    status: "running",
    bankrollStart: args.stake,
    bankrollNow: args.stake,
    peak: args.stake,
    cashOutAt: args.cashOutAt,
    stopAt: args.stopAt,
    maxRounds: Math.max(1, Math.floor(args.maxRounds)),
    sameSide: args.sameSide,
    asset: args.asset,
    timeframe: args.timeframe,
    hops: [],
    startedAt: new Date().toISOString(),
  };
}

export function applyHopResult(
  run: RunState,
  hopMarketId: string,
  result: "win" | "loss" | "void" | "pending",
  payout?: number,
  hash?: string,
): RunState {
  const hops = run.hops.map((h) =>
    h.marketId === hopMarketId && (h.result === "pending" || !h.result)
      ? { ...h, result, payout, hash }
      : h,
  );
  const next: RunState = { ...run, hops };

  if (result === "pending") return next;

  if (result === "loss") {
    return endRun(next, "busted", 0, "Lost the round. Run stopped.");
  }

  const credited = payout ?? (result === "void" ? hops.find((h) => h.marketId === hopMarketId)?.stake ?? 0 : 0);
  next.bankrollNow = credited;
  next.peak = Math.max(next.peak, credited);

  if (credited <= 0) return endRun(next, "busted", 0, "Nothing left to ride.");
  if (credited >= next.cashOutAt) return endRun(next, "cashed", credited, `Hit cash-out at ${credited.toFixed(2)}.`);
  if (credited <= next.stopAt) return endRun(next, "stopped", credited, `Hit stop at ${credited.toFixed(2)}.`);
  if (next.hops.filter((h) => h.result && h.result !== "pending").length >= next.maxRounds) {
    return endRun(next, "maxed", credited, `Max ${next.maxRounds} rounds.`);
  }
  return next;
}

export function endRun(run: RunState, status: RunState["status"], bankrollNow: number, reason: string): RunState {
  return {
    ...run,
    status,
    bankrollNow,
    peak: Math.max(run.peak, bankrollNow),
    endedAt: new Date().toISOString(),
    stopReason: reason,
  };
}

export function appendPendingHop(run: RunState, hop: RunHop): RunState {
  return { ...run, hops: [...run.hops, hop], bankrollNow: hop.stake };
}

export function shouldRestake(run: RunState): boolean {
  return run.status === "running";
}
