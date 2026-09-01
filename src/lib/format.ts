import type { MarketStatus, Side, TicketQuote, WindowMarket } from "./types";

export const STATUS_LABEL: Record<MarketStatus, string> = {
  listed: "Listed",
  trading: "Trading",
  locked: "Locked",
  resolved: "Resolved",
  voided: "Voided",
  unknown: "Unknown",
};

export function statusFromCode(code: number): MarketStatus {
  if (code === 0) return "listed";
  if (code === 1) return "trading";
  if (code === 2) return "locked";
  if (code === 4) return "resolved";
  if (code === 5) return "voided";
  return "unknown";
}

export function detectAsset(symbol: string): WindowMarket["asset"] {
  const s = symbol.toUpperCase();
  if (s.includes("BTC")) return "BTC";
  if (s.includes("ETH")) return "ETH";
  return "OTHER";
}

export function detectTimeframe(secondsLeft: number, symbol: string): WindowMarket["timeframe"] {
  const s = symbol.toUpperCase();
  if (s.includes("15") || s.includes("15M") || s.includes("900")) return "15m";
  if (s.includes("1H") || s.includes("60M") || s.includes("3600")) return "1h";
  if (secondsLeft > 0 && secondsLeft <= 20 * 60) return "15m";
  if (secondsLeft > 20 * 60 && secondsLeft <= 75 * 60) return "1h";
  return "other";
}

export function formatCountdown(secondsLeft: number): string {
  if (!Number.isFinite(secondsLeft)) return "—";
  const sign = secondsLeft < 0 ? "-" : "";
  const s = Math.abs(Math.floor(secondsLeft));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
  return `${sign}${m}m ${String(sec).padStart(2, "0")}s`;
}

export function formatProb(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function quoteTicket(side: Side, stake: number, impliedUp: number | null): TicketQuote {
  const p = impliedUp !== null && impliedUp > 0.02 && impliedUp < 0.98 ? impliedUp : 0.5;
  const entryProb = side === "up" ? p : 1 - p;
  const safeProb = Math.min(0.99, Math.max(0.01, entryProb));
  const contracts = stake / safeProb;
  return {
    side,
    stake,
    contracts,
    entryProb: safeProb,
    redeemIfWin: contracts,
    maxLoss: stake,
  };
}

export function plainLanguage(market: WindowMarket, stake: number, side: Side): string {
  const p = market.impliedUp;
  const upPct = p === null ? "an unknown" : `${Math.round(p * 100)}%`;
  const q = quoteTicket(side, stake, p);
  const asset = market.asset === "OTHER" ? "this market" : market.asset;
  const win = side === "up" ? "finishes at or above the window open" : "finishes below the window open";
  return `${asset} · ${market.timeframe} · ${formatCountdown(market.secondsLeft)} left · the book prices a ${upPct} chance Up wins · ${side === "up" ? "Up" : "Down"}: stake ${formatUsd(stake)} to redeem about ${formatUsd(q.redeemIfWin)} if ${asset} ${win}. Maximum loss is the stake.`;
}

export function shorten(id: string, size = 6): string {
  if (!id) return "—";
  if (id.length <= size * 2 + 2) return id;
  return `${id.slice(0, size + 2)}…${id.slice(-size)}`;
}
