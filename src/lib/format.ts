import type { MarketStatus, Side, TicketQuote, WindowMarket } from "./types";

export const STATUS_LABEL: Record<MarketStatus, string> = {
  listed: "Coming up",
  trading: "Open",
  locked: "Closing",
  settling: "Settling",
  resolved: "Settled",
  voided: "Voided",
  finalized: "Settled",
  unknown: "Unknown",
};

export const ASSET_ICON: Record<WindowMarket["asset"], string> = {
  BTC: "₿",
  ETH: "Ξ",
  OTHER: "◆",
};

// Index -> status for the on-chain MarketStatus enum (confirmed against
// @somnia-chain/markets-sdk's BINARY_MARKET_STATUS: Listed, Trading, Locked,
// Settling, Resolved, Voided — "Finalized" is indexer-derived, no numeric code).
export function statusFromCode(code: number): MarketStatus {
  if (code === 0) return "listed";
  if (code === 1) return "trading";
  if (code === 2) return "locked";
  if (code === 3) return "settling";
  if (code === 4) return "resolved";
  if (code === 5) return "voided";
  return "unknown";
}

// Fallback for when the on-chain status read fails: map the indexer's own
// BinaryMarketStatus string (what listLiveBinaryMarkets returns as `status`)
// instead of leaving the market as "unknown".
export function statusFromString(status: unknown): MarketStatus {
  switch (String(status ?? "")) {
    case "Listed":
      return "listed";
    case "Trading":
      return "trading";
    case "Locked":
      return "locked";
    case "Settling":
      return "settling";
    case "Resolved":
      return "resolved";
    case "Voided":
      return "voided";
    case "Finalized":
      return "finalized";
    default:
      return "unknown";
  }
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

export function formatCloseLabel(expirySec: number, secondsLeft: number): string {
  if (!expirySec) return "Closing time unknown";
  const when = new Date(expirySec * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (secondsLeft > 0) return `Closes ${formatCountdown(secondsLeft)} · ${when}`;
  return `Closed ${when}`;
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
  const upPct = p === null ? "an unclear" : `${Math.round(p * 100)}%`;
  const q = quoteTicket(side, stake, p);
  const asset = market.asset === "OTHER" ? "This market" : market.asset;
  const sideWord = side === "up" ? "Up" : "Down";
  return `${asset} looks like ${upPct} likely to finish Up. Bet ${sideWord}: put in ${formatUsd(stake)}, and if you're right you get about ${formatUsd(q.redeemIfWin)} back. If you're wrong, you lose the ${formatUsd(stake)} — never more.`;
}

/** Book odds vs how far spot has already moved inside this window. */
export function formatEdge(impliedUp: number | null, spotMovePct: number | null): string {
  const book =
    impliedUp === null || !Number.isFinite(impliedUp) ? "Book —" : `Book ${Math.round(impliedUp * 100)}% Up`;
  if (spotMovePct === null || !Number.isFinite(spotMovePct)) return book;
  const sign = spotMovePct > 0 ? "+" : "";
  return `${book} · spot already ${sign}${spotMovePct.toFixed(2)}% this window`;
}

export function spotMovePct(spot: number | null, strike: number | null): number | null {
  if (spot === null || strike === null || !Number.isFinite(spot) || !Number.isFinite(strike) || strike === 0) {
    return null;
  }
  return ((spot - strike) / strike) * 100;
}

export function shorten(id: string, size = 6): string {
  if (!id) return "—";
  if (id.length <= size * 2 + 2) return id;
  return `${id.slice(0, size + 2)}…${id.slice(-size)}`;
}
