export type NetworkName = "shannon" | "mainnet";

export type MarketStatus = "listed" | "trading" | "locked" | "resolved" | "voided" | "unknown";

export type Side = "up" | "down";

export type WindowMarket = {
  marketId: string;
  symbol: string;
  upSymbol: string;
  asset: "BTC" | "ETH" | "OTHER";
  timeframe: "15m" | "1h" | "other";
  expirySec: number;
  secondsLeft: number;
  status: MarketStatus;
  statusCode: number;
  impliedUp: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  openingPriceLabel: string;
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

export type OpenPosition = {
  marketId: string;
  symbol: string;
  side: Side;
  contracts: number;
  entryProb: number;
  stake: number;
  status: MarketStatus;
};

export type Claimable = {
  marketId: string;
  symbol: string;
  side: Side;
  contracts: number;
  estimatedPayout: number;
  resolved: boolean;
};

export type JournalRow = {
  id: string;
  at: string;
  kind: "trade" | "redeem" | "roll" | "note";
  marketId: string;
  symbol: string;
  side?: Side;
  stake?: number;
  entryProb?: number;
  result?: "win" | "loss" | "void" | "pending";
  net?: number;
  hash?: string;
  note?: string;
};
