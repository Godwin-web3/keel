export type NetworkName = "shannon" | "mainnet";

export type MarketStatus = "listed" | "trading" | "locked" | "settling" | "resolved" | "voided" | "finalized" | "unknown";

export type Side = "up" | "down";

export type WindowMarket = {
  marketId: string;
  symbol: string;
  upSymbol: string;
  downSymbol: string;
  asset: "BTC" | "ETH" | "OTHER";
  timeframe: string;
  expirySec: number;
  tradingStartSec: number;
  secondsLeft: number;
  status: MarketStatus;
  statusCode: number;
  isResolved?: boolean;
  isVoided?: boolean;
  winningOutcome?: number | null;
  impliedUp: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  openingPriceLabel: string;
  /** Numeric strike / window-open price when the indexer provides one. */
  strike: number | null;
  poolAddress: string;
  raw: unknown;
};

export type TicketQuote = {
  side: Side;
  stake: number;
  contracts: number;
  entryProb: number;
  redeemIfWin: number;
  maxLoss: number;
};

export type ParlayQuote = {
  stake: number;
  implied: number;
  redeemIfWin: number;
  maxLoss: number;
  legs: Array<TicketQuote & { asset: WindowMarket["asset"]; marketId: string }>;
};

export type OpenPosition = {
  marketId: string;
  symbol: string;
  asset: WindowMarket["asset"];
  timeframe: WindowMarket["timeframe"];
  side: Side;
  contracts: number;
  /** Unknown for a position discovered on-chain with no matching journal entry. */
  entryProb: number | null;
  /** Unknown for a position discovered on-chain with no matching journal entry. */
  stake: number | null;
  status: MarketStatus;
  /** True when this row came from an on-chain balance scan, not the local journal. */
  fromChain?: boolean;
  parlayId?: string;
  runId?: string;
};

export type Claimable = {
  marketId: string;
  symbol: string;
  asset: WindowMarket["asset"];
  timeframe: WindowMarket["timeframe"];
  side: Side;
  contracts: number;
  estimatedPayout: number;
  resolved: boolean;
  /** True when this row came from an on-chain balance scan, not the local journal. */
  fromChain?: boolean;
};

export type JournalRow = {
  id: string;
  at: string;
  kind: "trade" | "redeem" | "roll" | "note" | "parlay" | "run" | "commit" | "reveal";
  marketId: string;
  symbol: string;
  asset?: WindowMarket["asset"];
  side?: Side;
  stake?: number;
  entryProb?: number;
  result?: "win" | "loss" | "void" | "pending";
  net?: number;
  payout?: number;
  hash?: string;
  note?: string;
  parlayId?: string;
  runId?: string;
};

export type RunHop = {
  marketId: string;
  symbol: string;
  asset: WindowMarket["asset"];
  timeframe: string;
  side: Side;
  stake: number;
  at: string;
  result?: "win" | "loss" | "void" | "pending";
  payout?: number;
  hash?: string;
};

export type RunStatus = "running" | "cashed" | "stopped" | "busted" | "maxed";

export type RunState = {
  id: string;
  status: RunStatus;
  bankrollStart: number;
  bankrollNow: number;
  peak: number;
  cashOutAt: number;
  stopAt: number;
  maxRounds: number;
  sameSide: boolean;
  asset: "BTC" | "ETH";
  timeframe: string;
  hops: RunHop[];
  startedAt: string;
  endedAt?: string;
  stopReason?: string;
};
