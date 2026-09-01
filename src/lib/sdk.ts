import { createWalletClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Claimable, MarketStatus, NetworkName, OpenPosition, Side, WindowMarket } from "./types";
import { detectAsset, detectTimeframe, statusFromCode, statusFromString } from "./format";

export type SessionConfig = {
  network: NetworkName;
  privateKey?: string;
};

type PortfolioMarketShape = {
  id: string;
  marketAddress: string;
  asset: string;
  status: string;
  strike: string;
  expiry: string | null;
  winningOutcome?: number | null;
  voided: boolean;
  quoteDecimals: number;
  interval: string | null;
};

type PortfolioPositionShape = {
  market: PortfolioMarketShape;
  outcomeIndex: number;
  tokenId: string;
  balance: string;
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
      marketAddress?: `0x${string}`;
      outcomeToken?: `0x${string}`;
      yesId?: bigint | number | string;
      noId?: bigint | number | string;
      [k: string]: unknown;
    }>;
    getOutcomeBalance?: (p: { outcomeToken: `0x${string}`; account: `0x${string}`; id: bigint }) => Promise<bigint>;
    getPortfolio?: (account: string, opts?: { tradesLimit?: number }) => Promise<{ positions: PortfolioPositionShape[] }>;
    redeemOutcome?: (...args: any[]) => Promise<any>;
  };
  trader?: {
    redeem?: (args: {
      marketId: `0x${string}`;
      market: `0x${string}`;
      outcomeToken: `0x${string}`;
      outcomeIdx: number;
      amount: bigint;
    }) => Promise<any>;
    redeemOutcome?: (...args: any[]) => Promise<any>;
    cancelOrder?: (...args: any[]) => Promise<any>;
  };
};

let exchange: Exchange | null = null;
let lastConfig: string = "";
let accountAddress: `0x${string}` | null = null;

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 12) return "....";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

async function resolveNetworkConfig(network: NetworkName) {
  const sdk = await import("@somnia-chain/markets-sdk");
  const chainMod = await import("@somnia-chain/markets-sdk/chains").catch(() => null);

  const isTest = network === "shannon";
  const chain = (isTest ? chainMod?.somniaShannon ?? sdk.somniaShannon : chainMod?.somniaMainnet ?? sdk.somniaMainnet) ?? undefined;
  const addresses = isTest ? sdk.SOMNIA_TESTNET_ADDRESSES : sdk.SOMNIA_MAINNET_ADDRESSES;
  const indexerUrl = isTest ? "https://dev.smk.somnia.host/v1/graphql" : "https://prd.smk.somnia.host/v1/graphql";
  const wsRpcUrl = isTest
    ? "wss://api.infra.testnet.somnia.network/ws"
    : "wss://api.infra.mainnet.somnia.network/ws";

  return { sdk, chain, addresses, indexerUrl, wsRpcUrl };
}

export async function connectExchange(config: SessionConfig): Promise<void> {
  const fingerprint = `${config.network}:${config.privateKey ? "signed" : "read"}`;
  if (exchange && lastConfig === fingerprint) return;

  const { sdk, chain, addresses, indexerUrl, wsRpcUrl } = await resolveNetworkConfig(config.network);

  const opts: Record<string, unknown> = {
    indexerUrl,
    chain,
    wsRpcUrl,
    addresses,
  };
  if (config.privateKey) {
    const key = (config.privateKey.startsWith("0x") ? config.privateKey : `0x${config.privateKey}`) as `0x${string}`;
    opts.privateKey = key;
    accountAddress = privateKeyToAccount(key).address;
  } else {
    accountAddress = null;
  }

  exchange = new sdk.SomniaMarkets(opts) as unknown as Exchange;
  lastConfig = fingerprint;
  await exchange.loadMarkets(true);
}

// ---------------- injected browser wallet (MetaMask/Rabby/etc.) ----------------

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
  providers?: InjectedProvider[];
  isMetaMask?: boolean;
};

function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as any).ethereum as InjectedProvider | undefined;
  if (!eth) return null;
  // Multiple extensions (MetaMask + Rabby + Coinbase, say) stack under
  // window.ethereum.providers rather than each claiming window.ethereum alone.
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0];
  }
  return eth;
}

export function hasInjectedWallet(): boolean {
  return getInjectedProvider() !== null;
}

/** Checks for an already-authorized injected account without prompting. */
export async function getAuthorizedInjectedAddress(): Promise<`0x${string}` | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return (accounts?.[0] as `0x${string}`) ?? null;
  } catch {
    return null;
  }
}

async function ensureWalletOnChain(walletClient: ReturnType<typeof createWalletClient>, chain: { id: number }) {
  const current = await walletClient.getChainId();
  if (current === chain.id) return;
  try {
    await walletClient.switchChain({ id: chain.id });
  } catch (err: any) {
    const notAdded = err?.code === 4902 || /unrecognized|has not been added|does not exist/i.test(String(err?.message ?? ""));
    if (!notAdded) throw err;
    await walletClient.addChain({ chain: chain as any });
    await walletClient.switchChain({ id: chain.id });
  }
}

/**
 * Connects via an injected browser wallet instead of a pasted private key.
 * Prompts for account access (unless already authorized), then switches (or
 * adds) the wallet to the target Somnia chain before wiring it into the SDK.
 */
export async function connectInjectedWallet(network: NetworkName): Promise<`0x${string}`> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet found. Install MetaMask, Rabby, or another browser wallet.");
  }

  const { sdk, chain, addresses, indexerUrl, wsRpcUrl } = await resolveNetworkConfig(network);
  if (!chain) throw new Error("Somnia chain definition not found in the SDK.");

  const requested = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = requested?.[0] as `0x${string}` | undefined;
  if (!address) throw new Error("The wallet didn't return an account.");

  const walletClient = createWalletClient({
    account: address,
    chain: chain as any,
    transport: custom(provider),
  });

  await ensureWalletOnChain(walletClient, chain as any);

  exchange = new sdk.SomniaMarkets({
    indexerUrl,
    chain,
    wsRpcUrl,
    addresses,
    walletClient,
  }) as unknown as Exchange;
  lastConfig = `${network}:injected:${address.toLowerCase()}`;
  accountAddress = address;
  await exchange.loadMarkets(true);
  return address;
}

export function isConnected(): boolean {
  return Boolean(exchange);
}

export function getAccountAddress(): `0x${string}` | null {
  return accountAddress;
}

export function disconnectExchange(): void {
  exchange = null;
  lastConfig = "";
  accountAddress = null;
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
  const raw =
    market?.info?.expiry ??
    market?.expiry ??
    market?.expiresAt ??
    market?.endTime ??
    market?.closeTime ??
    market?.settleTime ??
    market?.windowEnd ??
    0;
  const n = Number(raw);
  if (n > 1e12) return Math.floor(n / 1000);
  return n;
}

// A ccxt-style order symbol looks like "BTC-0-12AUG26-1600/USDso#YES": asset,
// series index, expiry date (DDMMMYY), expiry time (HHMM, UTC), then
// collateral/outcome. That's the trading-layer symbol used for order books
// and order placement, not what the indexer's Market rows return, so it's
// only a fallback here when the confirmed indexer fields (below) are absent.
const SYMBOL_RE = /^(BTC|ETH)-\d+-(\d{2})([A-Za-z]{3})(\d{2})-(\d{4})\//;
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseSymbolMeta(symbol: string): { asset: "BTC" | "ETH"; expirySec: number } | null {
  const match = SYMBOL_RE.exec(symbol);
  if (!match) return null;
  const [, asset, dd, mon, yy, hhmm] = match;
  const month = MONTHS[mon.toUpperCase()];
  if (month === undefined) return null;
  const ms = Date.UTC(2000 + Number(yy), month, Number(dd), Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)), 0);
  if (!Number.isFinite(ms)) return null;
  return { asset: asset.toUpperCase() as "BTC" | "ETH", expirySec: Math.floor(ms / 1000) };
}

function findSymbolLike(obj: unknown, depth = 0): string {
  if (!obj || typeof obj !== "object" || depth > 1) return "";
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (typeof value === "string" && SYMBOL_RE.test(value)) return value;
  }
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      const nested = findSymbolLike(value, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function intervalToTimeframe(intervalSec: number): string {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return "";
  if (intervalSec % 3600 === 0) return `${intervalSec / 3600}h`;
  if (intervalSec % 60 === 0) return `${intervalSec / 60}m`;
  return `${Math.round(intervalSec)}s`;
}

// Confirmed directly against the @somnia-chain/markets-sdk source (BinaryMarket
// in src/markets.ts) and the live indexer schema (dev.smk.somnia.host): a
// market row carries "asset" as a plain "BTC"/"ETH" string, "expiry" and
// "tradingStart" in unix seconds — no ccxt-style symbol string at all (that
// format is synthesized by the SDK's own unified layer for order placement,
// from asset+strike+expiry, not something the indexer or listLiveBinaryMarkets
// returns). These direct fields are the primary source; the symbol scan above
// is only a fallback for a market row shape that doesn't carry them.
function resolveMarketMeta(
  market: any,
  declaredSymbol: string,
): { symbol: string; asset: WindowMarket["asset"]; expirySec: number; timeframe: string } {
  const rawAsset = String(market?.asset ?? market?.info?.asset ?? "").toUpperCase();
  const directAsset: WindowMarket["asset"] | null = rawAsset === "BTC" || rawAsset === "ETH" ? (rawAsset as "BTC" | "ETH") : null;
  const directExpiry = extractExpiry(market);
  const tradingStart = Number(market?.tradingStart ?? market?.info?.tradingStart ?? 0);
  const rawInterval =
    directExpiry && tradingStart ? directExpiry - tradingStart : Number(market?.intervalSec ?? market?.info?.intervalSec ?? 0);
  const directTimeframe = intervalToTimeframe(rawInterval);

  const symbol = SYMBOL_RE.test(declaredSymbol) ? declaredSymbol : findSymbolLike(market) || declaredSymbol;
  const meta = parseSymbolMeta(symbol);

  const asset = directAsset ?? meta?.asset ?? detectAsset(symbol || declaredSymbol);
  const expirySec = directExpiry || meta?.expirySec || 0;
  const now = Date.now() / 1000;
  const timeframe = directTimeframe || detectTimeframe(expirySec ? expirySec - now : 0, symbol);

  return { symbol: symbol || declaredSymbol, asset, expirySec, timeframe };
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
      // m.status here is the indexer's BinaryMarketStatus STRING ("Trading",
      // "Finalized", ...), not a numeric code — used only if the on-chain
      // read below fails.
      let status: MarketStatus = statusFromString(m.status);
      let statusCode = 1;
      let isResolved: boolean | undefined;
      let isVoided: boolean | undefined;
      let winningOutcome: number | null | undefined;
      try {
        const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
        statusCode = Number(onchain.status);
        status = statusFromCode(statusCode);
        isResolved = onchain.isResolved;
        isVoided = onchain.isVoided;
        winningOutcome = onchain.winningOutcome ?? null;
      } catch {
        /* on-chain read failed; fall back to the indexer's own status string */
      }
      const declaredSymbol = String(m.symbol || m.upSymbol || m.yesSymbol || "");
      const { symbol, asset, expirySec, timeframe } = resolveMarketMeta(m, declaredSymbol);
      const secondsLeft = expirySec ? expirySec - now : 0;
      const book = await safeBook(symbol || marketId);
      out.push({
        marketId,
        symbol: symbol || marketId,
        upSymbol: symbol || marketId,
        asset,
        timeframe,
        expirySec,
        secondsLeft,
        status,
        statusCode,
        isResolved,
        isVoided,
        winningOutcome,
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
    let status: MarketStatus = statusFromString(m.status ?? m.info?.status);
    let isResolved: boolean | undefined;
    let isVoided: boolean | undefined;
    let winningOutcome: number | null | undefined;
    try {
      if (marketId.startsWith("0x")) {
        const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
        statusCode = Number(onchain.status);
        status = statusFromCode(statusCode);
        isResolved = onchain.isResolved;
        isVoided = onchain.isVoided;
        winningOutcome = onchain.winningOutcome ?? null;
      }
    } catch {
      statusCode = m.active ? 1 : 4;
      if (status === "unknown") status = statusFromCode(statusCode);
    }

    const { symbol, asset, expirySec, timeframe } = resolveMarketMeta(m, upSymbol);
    const secondsLeft = expirySec ? expirySec - now : 0;
    const book = await safeBook(symbol);

    out.push({
      marketId,
      symbol,
      upSymbol: symbol,
      asset,
      timeframe,
      expirySec,
      secondsLeft,
      status,
      statusCode,
      isResolved,
      isVoided,
      winningOutcome,
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
  if (outcome === null || outcome === undefined) return null;
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

  const oc = await exchange.client.getMarketOnchain(marketId as `0x${string}`);

  let raw: any;
  if (typeof exchange.trader?.redeem === "function" && typeof exchange.client.getOutcomeBalance === "function") {
    const { marketAddress, outcomeToken, yesId, noId } = oc;
    if (!marketAddress || !outcomeToken || yesId === undefined || noId === undefined) {
      throw new Error(
        "getMarketOnchain did not return marketAddress/outcomeToken/yesId/noId for this market, so the redeem call can't be built. Check docs.dreamdex.io/developers/event-contracts/recipes against the installed SDK version.",
      );
    }
    if (!accountAddress) {
      throw new Error("No session key connected. Add a session key before redeeming.");
    }

    const outcomeIdx = side === "up" ? 0 : 1;
    const tokenId = BigInt(outcomeIdx === 0 ? yesId : noId);
    const amount = await exchange.client.getOutcomeBalance({ outcomeToken, account: accountAddress, id: tokenId });
    if (amount === 0n) {
      throw new Error("No redeemable balance held for this side on this market.");
    }

    raw = await exchange.trader.redeem({
      marketId: marketId as `0x${string}`,
      market: marketAddress,
      outcomeToken,
      outcomeIdx,
      amount,
    });
  } else {
    // Fall back to an older SDK surface that redeems by marketId alone.
    const trader = exchange.trader ?? (exchange.client as any);
    const fn = trader?.redeemOutcome ?? exchange.client.redeemOutcome;
    if (typeof fn !== "function") {
      throw new Error(
        "This SDK build exposes neither trader.redeem(...) nor redeemOutcome(marketId). Check docs.dreamdex.io/developers/event-contracts/recipes and wire the method from your installed version.",
      );
    }
    raw = await fn(marketId);
  }

  if (raw?.receipt?.status === "reverted") {
    throw new Error("Redeem transaction reverted on-chain.");
  }

  const hash = raw?.receipt?.transactionHash || raw?.transactionHash;

  let result: "win" | "loss" | "void" | "pending" = "pending";
  if (oc.isVoided) {
    result = "void";
  } else if (oc.isResolved) {
    const winningSide = sideFromWinningOutcome(oc.winningOutcome);
    result = winningSide === side ? "win" : "loss";
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
  // A redeem is always logged as its own journal row rather than updating the
  // original trade row in place (the journal is append-only), so a trade
  // whose market already has a matching redeem row has already been claimed
  // — without this, a claimed position would never leave the claimable list
  // and auto-claim would keep retrying it forever.
  const redeemedMarketIds = new Set(journal.filter((r) => r.kind === "redeem").map((r) => r.marketId));

  for (const row of journal) {
    if (row.kind !== "trade" || row.result === "win" || row.result === "loss" || row.result === "void") continue;
    if (redeemedMarketIds.has(row.marketId)) continue;
    const market = markets.find((m) => m.marketId === row.marketId);
    const status = market?.status ?? "unknown";
    const side = row.side ?? "up";
    const stake = row.stake ?? 0;
    const entryProb = row.entryProb ?? 0.5;
    const contracts = entryProb > 0 ? stake / entryProb : 0;

    if (status === "trading" || status === "locked" || status === "listed" || status === "settling") {
      open.push({
        marketId: row.marketId,
        symbol: market?.symbol ?? row.marketId,
        asset: market?.asset ?? "OTHER",
        timeframe: market?.timeframe ?? "other",
        side,
        contracts,
        entryProb,
        stake,
        status,
      });
    }

    if (status === "resolved" || status === "voided" || status === "finalized") {
      const winningSide = sideFromWinningOutcome(market?.winningOutcome);
      const estimatedPayout =
        status === "voided"
          ? contracts * 0.5
          : winningSide === null
            ? contracts
            : winningSide === side
              ? contracts
              : 0;
      claimable.push({
        marketId: row.marketId,
        symbol: market?.symbol ?? row.marketId,
        asset: market?.asset ?? "OTHER",
        timeframe: market?.timeframe ?? "other",
        side,
        contracts,
        estimatedPayout,
        resolved: status === "resolved" || status === "finalized",
      });
    }
  }

  return { open, claimable };
}

function normalizeAsset(raw: string): WindowMarket["asset"] {
  const s = raw.toUpperCase();
  if (s === "BTC" || s === "ETH") return s;
  return "OTHER";
}

/**
 * Scans the connected wallet's on-chain outcome-token balances via the
 * indexer-backed portfolio query, so Desk can show positions the local
 * journal never saw — a fresh browser, a cleared localStorage, or a bet
 * placed from somewhere else entirely. Unlike journal-derived positions,
 * these never know the original stake/entry price (only the balance and
 * the market's own state are on-chain), so those fields come back null.
 */
export async function discoverOnchainPositions(account: `0x${string}`): Promise<{
  open: OpenPosition[];
  claimable: Claimable[];
}> {
  const open: OpenPosition[] = [];
  const claimable: Claimable[] = [];
  if (!exchange?.client.getPortfolio) return { open, claimable };

  let positions: PortfolioPositionShape[] = [];
  try {
    const portfolio = await exchange.client.getPortfolio(account);
    positions = portfolio.positions ?? [];
  } catch {
    return { open, claimable };
  }

  for (const p of positions) {
    const balance = Number(p.balance);
    if (!Number.isFinite(balance) || balance <= 0) continue;
    const contracts = balance / 10 ** p.market.quoteDecimals;
    const side: Side = p.outcomeIndex === 0 ? "up" : "down";
    const asset = normalizeAsset(p.market.asset);
    const timeframe = p.market.interval ?? "other";
    const status = statusFromString(p.market.status);

    if (status === "trading" || status === "locked" || status === "listed" || status === "settling") {
      open.push({
        marketId: p.market.id,
        symbol: p.market.id,
        asset,
        timeframe,
        side,
        contracts,
        entryProb: null,
        stake: null,
        status,
        fromChain: true,
      });
    }

    if (status === "resolved" || status === "voided" || status === "finalized") {
      const winningSide = sideFromWinningOutcome(p.market.winningOutcome);
      const estimatedPayout = p.market.voided
        ? contracts * 0.5
        : winningSide === null
          ? contracts
          : winningSide === side
            ? contracts
            : 0;
      claimable.push({
        marketId: p.market.id,
        symbol: p.market.id,
        asset,
        timeframe,
        side,
        contracts,
        estimatedPayout,
        resolved: status === "resolved" || status === "finalized",
        fromChain: true,
      });
    }
  }

  return { open, claimable };
}

/**
 * Merges journal-derived positions with on-chain-discovered ones, keyed by
 * market + side. The journal version wins on a collision (it knows the real
 * stake/entry price the chain alone can't tell you); an on-chain-only find
 * fills in whatever the journal missed.
 */
export function mergePositions(
  base: { open: OpenPosition[]; claimable: Claimable[] },
  extra: { open: OpenPosition[]; claimable: Claimable[] },
): { open: OpenPosition[]; claimable: Claimable[] } {
  const openKeys = new Set(base.open.map((p) => `${p.marketId}:${p.side}`));
  const claimableKeys = new Set(base.claimable.map((p) => `${p.marketId}:${p.side}`));
  const open = [...base.open, ...extra.open.filter((p) => !openKeys.has(`${p.marketId}:${p.side}`))];
  const claimable = [
    ...base.claimable,
    ...extra.claimable.filter((p) => !claimableKeys.has(`${p.marketId}:${p.side}`)),
  ];
  return { open, claimable };
}
