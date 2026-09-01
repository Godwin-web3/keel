import type { Claimable, NetworkName, OpenPosition, Side, WindowMarket } from "./types";
import { detectAsset, detectTimeframe, statusFromCode } from "./format";

export type SessionConfig = {
  network: NetworkName;
  privateKey?: string;
};

type Exchange = {
  loadMarkets: (force?: boolean) => Promise<Record<string, any>>;
  fetchOrderBook: (symbol: string, depth?: number) => Promise<any>;
  createOrder: (
    symbol: string,
    type: string,
    side: string,
    size: number,
    price?: number,
    opts?: Record<string, unknown>,
  ) => Promise<any>;
  client: {
    listLiveBinaryMarkets?: (args?: { limit?: number }) => Promise<any[]>;
    getMarketOnchain: (marketId: `0x${string}`) => Promise<{
      status: number;
      isResolved?: boolean;
      isVoided?: boolean;
      winningOutcome?: number;
      [k: string]: unknown;
    }>;
    redeemOutcome?: (...args: any[]) => Promise<any>;
  };
  trader?: {
    redeemOutcome?: (...args: any[]) => Promise<any>;
    cancelOrder?: (...args: any[]) => Promise<any>;
  };
};

let exchange: Exchange | null = null;
let lastConfig: string = "";

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 12) return "....";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export async function connectExchange(config: SessionConfig): Promise<void> {
  const fingerprint = `${config.network}:${config.privateKey ? "signed" : "read"}`;
  if (exchange && lastConfig === fingerprint) return;

  const sdk = await import("@somnia-chain/markets-sdk");
  const chainMod = await import("@somnia-chain/markets-sdk/chains").catch(() => null);

  const isTest = config.network === "shannon";
  const chain =
    (isTest
      ? chainMod?.somniaShannon ?? sdk.somniaShannon
      : chainMod?.somniaMainnet ?? sdk.somniaMainnet) ?? undefined;

  const addresses = isTest ? sdk.SOMNIA_TESTNET_ADDRESSES : sdk.SOMNIA_MAINNET_ADDRESSES;

  const indexerUrl = isTest
    ? "https://dev.smk.somnia.host/v1/graphql"
    : "https://prd.smk.somnia.host/v1/graphql";

  const wsRpcUrl = isTest
    ? "wss://api.infra.testnet.somnia.network/ws"
    : "wss://api.infra.mainnet.somnia.network/ws";

  const opts: Record<string, unknown> = {
    indexerUrl,
    chain,
    wsRpcUrl,
    addresses,
  };
  if (config.privateKey) {
    const key = config.privateKey.startsWith("0x") ? config.privateKey : `0x${config.privateKey}`;
    opts.privateKey = key;
  }

  exchange = new sdk.SomniaMarkets(opts) as unknown as Exchange;
  lastConfig = fingerprint;
  await exchange.loadMarkets(true);
}

export function isConnected(): boolean {
  return Boolean(exchange);
}

export function disconnectExchange(): void {
  exchange = null;
  lastConfig = "";
}

function pickImplied(book: any): { bid: number | null; ask: number | null; mid: number | null } {
  const bidRaw = book?.bids?.[0]?.[0] ?? book?.bids?.[0]?.price ?? null;
  const askRaw = book?.asks?.[0]?.[0] ?? book?.asks?.[0]?.price ?? null;
  const bid = bidRaw !== null ? Number(bidRaw) : null;
  const ask = askRaw !== null ? Number(askRaw) : null;
  const mid =
    bid !== null && ask !== null && Number.isFinite(bid) && Number.isFinite(ask)
      ? (bid + ask) / 2
      : ask ?? bid;
  return { bid, ask, mid };
}

function extractUpSymbol(market: any): string {
  return (
    market?.outcomes?.[0]?.symbol ||
    market?.info?.outcomes?.[0]?.symbol ||
    market?.symbol ||
    market?.info?.symbol ||
    ""
  );
}

function extractMarketId(market: any): string {
  return String(market?.info?.marketId || market?.marketId || market?.id || "");
}

function extractExpiry(market: any): number {
  const raw = market?.info?.expiry ?? market?.expiry ?? market?.expiresAt ?? 0;
  const n = Number(raw);
  if (n > 1e12) return Math.floor(n / 1000);
  return n;
}

export async function listWindows(): Promise<WindowMarket[]> {
  if (!exchange) throw new Error("Exchange is not connected.");

  const now = Date.now() / 1000;
  const out: WindowMarket[] = [];

  if (typeof exchange.client.listLiveBinaryMarkets === "function") {
    const live = await exchange.client.listLiveBinaryMarkets({ limit: 50 });
    for (const m of live) {
      const marketId = String(m.marketId || m.id || "");
      if (!marketId.startsWith("0x")) continue;
      let statusCode = Number(m.status ?? 1);
      try {
        const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
        statusCode = Number(onchain.status);
      } catch {
        /* indexer row still useful */
      }
      const expirySec = extractExpiry(m);
      const secondsLeft = expirySec ? expirySec - now : 0;
      const symbol = String(m.symbol || m.upSymbol || m.yesSymbol || marketId);
      const book = await safeBook(symbol);
      out.push({
        marketId,
        symbol,
        upSymbol: symbol,
        asset: detectAsset(symbol),
        timeframe: detectTimeframe(secondsLeft, symbol),
        expirySec,
        secondsLeft,
        status: statusFromCode(statusCode),
        statusCode,
        impliedUp: book.mid,
        bestBid: book.bid,
        bestAsk: book.ask,
        openingPriceLabel: String(m.openingPrice ?? m.strike ?? m.refPrice ?? "window open"),
        raw: m,
      });
    }
    return out.sort((a, b) => a.secondsLeft - b.secondsLeft);
  }

  const loaded = Object.values(await exchange.loadMarkets(true));
  const { isBinaryMarket } = await import("@somnia-chain/markets-sdk");

  for (const m of loaded) {
    const info = m.info ?? m;
    if (typeof isBinaryMarket === "function" && !isBinaryMarket(info) && !isBinaryMarket(m)) {
      if (!String(extractUpSymbol(m)).includes("#YES") && !String(m.kind || "").includes("binary")) {
        continue;
      }
    }
    const marketId = extractMarketId(m);
    const upSymbol = extractUpSymbol(m);
    if (!marketId || !upSymbol) continue;

    let statusCode = 1;
    try {
      if (marketId.startsWith("0x")) {
        const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
        statusCode = Number(onchain.status);
      }
    } catch {
      statusCode = m.active ? 1 : 4;
    }

    const expirySec = extractExpiry(m);
    const secondsLeft = expirySec ? expirySec - now : 0;
    const book = await safeBook(upSymbol);

    out.push({
      marketId,
      symbol: upSymbol,
      upSymbol,
      asset: detectAsset(upSymbol),
      timeframe: detectTimeframe(secondsLeft, upSymbol),
      expirySec,
      secondsLeft,
      status: statusFromCode(statusCode),
      statusCode,
      impliedUp: book.mid,
      bestBid: book.bid,
      bestAsk: book.ask,
      openingPriceLabel: "window open",
      raw: m,
    });
  }

  return out.sort((a, b) => a.secondsLeft - b.secondsLeft);
}

async function safeBook(symbol: string): Promise<{ bid: number | null; ask: number | null; mid: number | null }> {
  if (!exchange || !symbol) return { bid: null, ask: null, mid: null };
  try {
    const book = await exchange.fetchOrderBook(symbol, 5);
    return pickImplied(book);
  } catch {
    return { bid: null, ask: null, mid: null };
  }
}

export async function assertTrading(marketId: string): Promise<void> {
  if (!exchange) throw new Error("Exchange is not connected.");
  if (!marketId.startsWith("0x")) return;
  const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
  if (Number(onchain.status) !== 1) {
    throw new Error(`Market is not in Trading (status=${onchain.status}). Writes are blocked.`);
  }
}

export async function placeStake(args: {
  market: WindowMarket;
  side: Side;
  stake: number;
}): Promise<{ hash?: string; raw: unknown }> {
  if (!exchange) throw new Error("Exchange is not connected. Add a session key first.");
  await assertTrading(args.market.marketId);

  const implied = args.market.impliedUp ?? 0.5;
  const entry = args.side === "up" ? implied : 1 - implied;
  const price = Math.min(0.99, Math.max(0.01, entry));
  const contracts = args.stake / price;

  const book = await safeBook(args.market.upSymbol);
  const limit =
    args.side === "up"
      ? (book.ask ?? price) + 0.02
      : 1 - ((book.bid ?? price) - 0.02);

  const symbol = args.market.upSymbol;
  const orderSide = args.side === "up" ? "buy" : "sell";

  const order = await exchange.createOrder(symbol, "limit", orderSide, Number(contracts.toFixed(4)), Number(limit.toFixed(4)), {
    timeInForce: "IOC",
  });

  const hash =
    order?.info?.receipt?.transactionHash ||
    order?.receipt?.transactionHash ||
    order?.transactionHash ||
    undefined;

  return { hash, raw: order };
}

function sideFromWinningOutcome(outcome: unknown): Side | null {
  const n = Number(outcome);
  if (n === 0) return "up";
  if (n === 1) return "down";
  return null;
}

export async function redeemMarket(
  marketId: string,
  side: Side,
): Promise<{ hash?: string; result: "win" | "loss" | "void" | "pending"; raw: unknown }> {
  if (!exchange) throw new Error("Exchange is not connected.");
  const trader = exchange.trader ?? (exchange.client as any);
  if (typeof trader?.redeemOutcome !== "function" && typeof exchange.client.redeemOutcome !== "function") {
    throw new Error(
      "This SDK build does not expose redeemOutcome on the client used here. Check docs.dreamdex.io/developers/event-contracts/recipes and wire the method name from your installed version.",
    );
  }
  const fn = trader.redeemOutcome ?? exchange.client.redeemOutcome;
  const raw = await fn(marketId);
  const hash = raw?.receipt?.transactionHash || raw?.transactionHash;

  let result: "win" | "loss" | "void" | "pending" = "pending";
  try {
    const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
    if (onchain.isVoided) {
      result = "void";
    } else if (onchain.isResolved) {
      const winningSide = sideFromWinningOutcome(onchain.winningOutcome);
      result = winningSide === side ? "win" : "loss";
    }
  } catch {
    /* settlement unreadable; leave as pending rather than assume a win */
  }

  return { hash, result, raw };
}

export function derivePositions(
  markets: WindowMarket[],
  journal: { marketId: string; side?: Side; stake?: number; entryProb?: number; kind: string; result?: string }[],
): {
  open: OpenPosition[];
  claimable: Claimable[];
} {
  const open: OpenPosition[] = [];
  const claimable: Claimable[] = [];

  for (const row of journal) {
    if (row.kind !== "trade" || row.result === "win" || row.result === "loss" || row.result === "void") continue;
    const market = markets.find((m) => m.marketId === row.marketId);
    const status = market?.status ?? "unknown";
    const side = row.side ?? "up";
    const stake = row.stake ?? 0;
    const entryProb = row.entryProb ?? 0.5;
    const contracts = entryProb > 0 ? stake / entryProb : 0;

    if (status === "trading" || status === "locked" || status === "listed") {
      open.push({
        marketId: row.marketId,
        symbol: market?.symbol ?? row.marketId,
        side,
        contracts,
        entryProb,
        stake,
        status,
      });
    }

    if (status === "resolved" || status === "voided") {
      claimable.push({
        marketId: row.marketId,
        symbol: market?.symbol ?? row.marketId,
        side,
        contracts,
        estimatedPayout: status === "voided" ? stake : contracts,
        resolved: status === "resolved",
      });
    }
  }

  return { open, claimable };
}
