import { createPublicClient, createWalletClient, custom } from "viem";
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

type CandleShape = {
  bucketStart: string;
  openPrice: string;
  high: string;
  low: string;
  closePrice: string;
  tradeCount: number;
};

type FillShape = {
  quoteQuantity: string;
  taker: string | null;
  takerOrder: { owner: string; side: string | null } | null;
};

type PastMarketShape = {
  marketId?: string;
  id?: string;
  poolAddress?: string;
  quoteDecimals?: number;
  voided?: boolean;
  winningOutcome?: number | null;
  asset?: string;
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
    getClaimable?: (account: string) => Promise<
      Array<{
        marketId: string;
        pool?: string;
        outcomeIdx: number;
        amount: bigint | string | number;
        estPayout: bigint | string | number;
        status?: string;
      }>
    >;
    redeemOutcome?: (...args: any[]) => Promise<any>;
    getCandles?: (
      pool: string,
      intervalSeconds: number,
      opts?: { limit?: number; from?: number; to?: number },
    ) => Promise<CandleShape[]>;
    getFills?: (pool: string, opts?: { limit?: number; offset?: number }) => Promise<FillShape[]>;
    listPastBinaryMarkets?: (opts?: { limit?: number }) => Promise<PastMarketShape[]>;
    listBinaryMarkets?: (opts?: { status?: string; limit?: number; venueId?: string }) => Promise<any[]>;
    watchMarkets?: (opts?: { discover?: boolean }) => Promise<{ stop: () => void }>;
    watchMarket?: (pool: string) => Promise<{ stop: () => void }>;
    watchUser?: (account: string) => Promise<{ stop: () => void }>;
    watchPrice?: (asset: string) => Promise<{ stop: () => void }>;
    getLivePrice?: (asset: string) => { price?: number; ema?: number } | null;
    fetchPrice?: (asset: string) => Promise<{ price?: number; latestSpot?: string; ema?: number } | null>;
    subscribeLive?: (listener: () => void) => (() => void) | void;
    getLiveBinaryOrderBook?: (pool: string) => any;
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
  watchOrderBook?: (ref: string, depth?: number) => Promise<any>;
  fetchPrice?: (asset: string) => Promise<{ price?: number; ema?: number } | null>;
};

let exchange: Exchange | null = null;
let lastConfig: string = "";
let accountAddress: `0x${string}` | null = null;
let liveStop: (() => void) | null = null;
const liveListeners = new Set<() => void>();

export function onLiveUpdate(fn: () => void): () => void {
  liveListeners.add(fn);
  return () => liveListeners.delete(fn);
}

function emitLive() {
  for (const fn of liveListeners) {
    try {
      fn();
    } catch {
      /* listener failed */
    }
  }
}

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
  void startLiveFeeds();
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
  const w = window as any;
  const okx = w.okxwallet as InjectedProvider | undefined;
  if (okx?.request) return okx;
  const eth = w.ethereum as InjectedProvider | undefined;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const okxInList = eth.providers.find((p: any) => p.isOkxWallet || p.isOKExWallet);
    if (okxInList) return okxInList;
    return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0];
  }
  return eth;
}

export function friendlyWalletError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not been authorized|4100|provider is not ready|unauthorized|user rejected/i.test(msg)) {
    return "Wallet blocked the send. In OKX, switch network to Somnia Shannon (chain 50312), stay on this same account, then try again and tap Approve. First seal deploys a contract — you need a little STT for gas.";
  }
  return msg;
}

export async function prepareProviderForWrite(network: NetworkName): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found.");
  const { chain } = await resolveNetworkConfig(network);
  if (!chain) throw new Error("Somnia chain not found.");
  await provider.request({ method: "eth_requestAccounts" });
  const hexId = `0x${Number(chain.id).toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err: any) {
    const notAdded = err?.code === 4902 || /unrecognized|has not been added|does not exist/i.test(String(err?.message ?? ""));
    if (!notAdded) throw err;
    const rpc =
      (chain as any).rpcUrls?.default?.http?.[0] ??
      (network === "shannon" ? "https://api.infra.testnet.somnia.network/" : "https://api.infra.mainnet.somnia.network/");
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: network === "shannon" ? "Somnia Shannon" : "Somnia",
          nativeCurrency: { name: network === "shannon" ? "STT" : "SOMI", symbol: network === "shannon" ? "STT" : "SOMI", decimals: 18 },
          rpcUrls: [rpc],
          blockExplorerUrls: [
            network === "shannon" ? "https://shannon-explorer.somnia.network" : "https://explorer.somnia.network",
          ],
        },
      ],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  }
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
  void startLiveFeeds();
  return address;
}

export function isConnected(): boolean {
  return Boolean(exchange);
}

export function getAccountAddress(): `0x${string}` | null {
  return accountAddress;
}

export async function getTradeContext(network: NetworkName) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found. Connect MetaMask first.");
  const address = accountAddress ?? (await getAuthorizedInjectedAddress());
  if (!address) throw new Error("Connect a wallet first.");
  const { chain, addresses } = await resolveNetworkConfig(network);
  if (!chain) throw new Error("Somnia chain not found.");
  await prepareProviderForWrite(network);
  const collateral = (addresses.collateral ?? addresses.testUsdc) as `0x${string}` | undefined;
  if (!collateral) throw new Error("No collateral token on this network.");
  const walletClient = createWalletClient({
    account: address,
    chain: chain as any,
    transport: custom(provider),
  });
  const publicClient = createPublicClient({
    chain: chain as any,
    transport: custom(provider),
  });
  return { walletClient, publicClient, account: address, collateral };
}

export function disconnectExchange(): void {
  stopLiveFeeds();
  exchange = null;
  lastConfig = "";
  accountAddress = null;
}

/** Start SDK live watches (market discovery + BTC/ETH oracle). Best-effort. */
export async function startLiveFeeds(): Promise<void> {
  stopLiveFeeds();
  if (!exchange) return;
  const stops: Array<() => void> = [];
  try {
    if (typeof exchange.client.watchMarkets === "function") {
      const h = await exchange.client.watchMarkets({ discover: true });
      if (h?.stop) stops.push(() => h.stop());
    }
  } catch {
    /* watches are optional — polling still works */
  }
  try {
    if (typeof exchange.client.watchPrice === "function") {
      for (const asset of ["BTC", "ETH"]) {
        try {
          const h = await exchange.client.watchPrice(asset);
          if (h?.stop) stops.push(() => h.stop());
        } catch {
          /* price feed may be unset */
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof exchange.client.watchUser === "function" && accountAddress) {
      const h = await exchange.client.watchUser(accountAddress);
      if (h?.stop) stops.push(() => h.stop());
    }
  } catch {
    /* user watch is optional */
  }
  try {
    if (typeof exchange.client.subscribeLive === "function") {
      const unsub = exchange.client.subscribeLive(() => emitLive());
      if (typeof unsub === "function") stops.push(unsub);
    }
  } catch {
    /* subscribeLive optional */
  }
  liveStop = () => {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        /* already stopped */
      }
    }
    liveStop = null;
  };
}

export function stopLiveFeeds(): void {
  liveStop?.();
}

export async function fetchBook(symbol: string): Promise<{ bid: number | null; ask: number | null; mid: number | null }> {
  return safeBook(symbol);
}

export async function fetchSpotPrice(asset: string): Promise<number | null> {
  if (!exchange || asset === "OTHER") return null;
  try {
    if (typeof exchange.fetchPrice === "function") {
      const p = await exchange.fetchPrice(asset);
      const n = Number(p?.price ?? p?.ema);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (typeof exchange.client.fetchPrice === "function") {
      const p = await exchange.client.fetchPrice(asset);
      const n = Number(p?.price ?? p?.latestSpot ?? p?.ema);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    const live = exchange.client.getLivePrice?.(asset);
    const n = Number(live?.price ?? live?.ema);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
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

function parseStrike(market: any): number | null {
  const raw = market?.strike ?? market?.openingPrice ?? market?.refPrice ?? market?.info?.strike;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function poolOf(market: any): string {
  const p = String(market?.poolAddress ?? market?.binaryPoolAddress ?? market?.pool ?? market?.info?.poolAddress ?? "");
  return p.startsWith("0x") ? p : "";
}

function yesNoSymbols(declared: string, resolved: string): { upSymbol: string; downSymbol: string } {
  const src = SYMBOL_RE.test(declared) ? declared : resolved || declared;
  const base = src.replace(/#(YES|NO)$/i, "");
  if (base.includes("/") || SYMBOL_RE.test(base)) {
    return { upSymbol: `${base}#YES`, downSymbol: `${base}#NO` };
  }
  return { upSymbol: src || resolved, downSymbol: `${base}#NO` };
}

export function outcomeSymbol(market: WindowMarket, side: Side): string {
  if (side === "down" && market.downSymbol) return market.downSymbol;
  if (side === "up" && market.upSymbol) return market.upSymbol;
  const raw = market.upSymbol || market.symbol;
  const base = raw.replace(/#(YES|NO)$/i, "");
  return `${base}#${side === "up" ? "YES" : "NO"}`;
}

export async function listWindows(): Promise<WindowMarket[]> {
  if (!exchange) throw new Error("Exchange is not connected.");

  const now = Date.now() / 1000;

  if (typeof exchange.client.listLiveBinaryMarkets === "function") {
    const live = await exchange.client.listLiveBinaryMarkets({ limit: 50 });
    const mapped = await Promise.all(
      live.map(async (m) => {
        const marketId = String(m.marketId || m.id || "");
        if (!marketId.startsWith("0x")) return null;
        let status: MarketStatus = statusFromString(m.status);
        let statusCode = 1;
        let isResolved: boolean | undefined;
        let isVoided: boolean | undefined;
        let winningOutcome: number | null | undefined;
        try {
          const onchain = await exchange!.client.getMarketOnchain(marketId as `0x${string}`);
          statusCode = Number(onchain.status);
          status = statusFromCode(statusCode);
          isResolved = onchain.isResolved;
          isVoided = onchain.isVoided;
          winningOutcome = onchain.winningOutcome ?? null;
        } catch {
          /* indexer status fallback */
        }
        const declaredSymbol = String(m.symbol || m.upSymbol || m.yesSymbol || "");
        const { symbol, asset, expirySec, timeframe } = resolveMarketMeta(m, declaredSymbol);
        const { upSymbol, downSymbol } = yesNoSymbols(declaredSymbol, symbol);
        const secondsLeft = expirySec ? expirySec - now : 0;
        const book = status === "trading" ? await safeBook(upSymbol || marketId) : { bid: null, ask: null, mid: null };
        const tradingStartSec = Number(m.tradingStart ?? m.info?.tradingStart ?? 0);
        const row: WindowMarket = {
          marketId,
          symbol: symbol || marketId,
          upSymbol: upSymbol || marketId,
          downSymbol,
          asset,
          timeframe,
          expirySec,
          tradingStartSec,
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
          strike: parseStrike(m),
          poolAddress: poolOf(m),
          raw: m,
        };
        return row;
      }),
    );
    return mapped.filter((row): row is WindowMarket => row !== null).sort((a, b) => a.secondsLeft - b.secondsLeft);
  }

  const loaded = Object.values(await exchange.loadMarkets(true));
  const { isBinaryMarket } = await import("@somnia-chain/markets-sdk");
  const out: WindowMarket[] = [];

  for (const m of loaded) {
    const info = m.info ?? m;
    if (typeof isBinaryMarket === "function" && !isBinaryMarket(info) && !isBinaryMarket(m)) {
      if (!String(extractUpSymbol(m)).includes("#YES") && !String(m.kind || "").includes("binary")) {
        continue;
      }
    }
    const marketId = extractMarketId(m);
    const upRaw = extractUpSymbol(m);
    if (!marketId || !upRaw) continue;

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

    const { symbol, asset, expirySec, timeframe } = resolveMarketMeta(m, upRaw);
    const { upSymbol, downSymbol } = yesNoSymbols(upRaw, symbol);
    const secondsLeft = expirySec ? expirySec - now : 0;
    const book = status === "trading" ? await safeBook(upSymbol) : { bid: null, ask: null, mid: null };
    const tradingStartSec = Number(m.tradingStart ?? m.info?.tradingStart ?? 0);

    out.push({
      marketId,
      symbol,
      upSymbol,
      downSymbol,
      asset,
      timeframe,
      expirySec,
      tradingStartSec,
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
      strike: parseStrike(m),
      poolAddress: poolOf(m),
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
  if (!exchange) throw new Error("Exchange is not connected. Connect a wallet first.");
  await assertTrading(args.market.marketId);

  const implied = args.market.impliedUp ?? 0.5;
  const entry = args.side === "up" ? implied : 1 - implied;
  const price = Math.min(0.99, Math.max(0.01, entry));
  const contracts = args.stake / price;

  // Always BUY the outcome token. Down is #NO, not a sell on the Up book —
  // selling Up requires inventory and is the wrong fill path for a new stake.
  const symbol = outcomeSymbol(args.market, args.side);
  const book = await safeBook(symbol);
  const limit = Math.min(0.99, Math.max(0.01, (book.ask ?? price) + 0.02));

  const order = await exchange.createOrder(symbol, "limit", "buy", Number(contracts.toFixed(4)), Number(limit.toFixed(4)), {
    timeInForce: "IOC",
  });

  const hash =
    order?.info?.receipt?.transactionHash ||
    order?.receipt?.transactionHash ||
    order?.transactionHash ||
    undefined;

  return { hash, raw: order };
}

export async function placeParlay(args: {
  legs: Array<{ market: WindowMarket; side: Side; stake: number }>;
}): Promise<{ legs: Array<{ marketId: string; side: Side; hash?: string; error?: string }> }> {
  const out: Array<{ marketId: string; side: Side; hash?: string; error?: string }> = [];
  for (const leg of args.legs) {
    try {
      const placed = await placeStake(leg);
      out.push({ marketId: leg.market.marketId, side: leg.side, hash: placed.hash });
    } catch (err) {
      out.push({
        marketId: leg.market.marketId,
        side: leg.side,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (out.every((l) => l.error) && out.length > 0) {
    throw new Error(out.map((l) => l.error).filter(Boolean).join(" · "));
  }
  return { legs: out };
}

export async function peekStatuses(marketIds: string[]): Promise<Map<string, { status: number; isResolved?: boolean; isVoided?: boolean }>> {
  const map = new Map<string, { status: number; isResolved?: boolean; isVoided?: boolean }>();
  if (!exchange) return map;
  await Promise.all(
    marketIds
      .filter((id) => id.startsWith("0x"))
      .map(async (id) => {
        try {
          const oc = await exchange!.client.getMarketOnchain(id as `0x${string}`);
          map.set(id, { status: Number(oc.status), isResolved: oc.isResolved, isVoided: oc.isVoided });
        } catch {
          /* skip */
        }
      }),
  );
  return map;
}

export async function watchPools(pools: string[]): Promise<() => void> {
  if (!exchange?.client.watchMarket) return () => undefined;
  const stops: Array<() => void> = [];
  for (const pool of pools) {
    if (!pool.startsWith("0x")) continue;
    try {
      const h = await exchange.client.watchMarket(pool);
      if (h?.stop) stops.push(() => h.stop());
    } catch {
      /* ignore */
    }
  }
  return () => stops.forEach((s) => s());
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
): Promise<{ hash?: string; hashes: string[]; result: "win" | "loss" | "void" | "pending"; raw: unknown }> {
  if (!exchange) throw new Error("Exchange is not connected.");

  const oc = await exchange.client.getMarketOnchain(marketId as `0x${string}`);

  // Losing redeem succeeds on-chain and pays 0. Skip the gas.
  if (oc.isResolved && !oc.isVoided) {
    const winningSide = sideFromWinningOutcome(oc.winningOutcome);
    if (winningSide && winningSide !== side) {
      return { hashes: [], result: "loss", raw: null };
    }
  }

  const sides: Side[] = oc.isVoided ? ["up", "down"] : [side];
  const hashes: string[] = [];
  let lastRaw: unknown = null;

  for (const s of sides) {
    const raw = await redeemOneSide(marketId, s, oc);
    if (!raw) continue;
    lastRaw = raw;
    if (raw?.receipt?.status === "reverted") {
      throw new Error("Redeem transaction reverted on-chain.");
    }
    const hash = raw?.receipt?.transactionHash || raw?.transactionHash;
    if (hash) hashes.push(String(hash));
  }

  let result: "win" | "loss" | "void" | "pending" = "pending";
  if (oc.isVoided) {
    result = "void";
  } else if (oc.isResolved) {
    const winningSide = sideFromWinningOutcome(oc.winningOutcome);
    result = winningSide === side ? "win" : "loss";
  }

  if (hashes.length === 0 && result !== "loss") {
    throw new Error("No redeemable balance held for this market.");
  }

  return { hash: hashes[0], hashes, result, raw: lastRaw };
}

async function redeemOneSide(marketId: string, side: Side, oc: any): Promise<any> {
  if (!exchange) return null;

  if (typeof exchange.trader?.redeem === "function" && typeof exchange.client.getOutcomeBalance === "function") {
    const { marketAddress, outcomeToken, yesId, noId } = oc;
    if (!marketAddress || !outcomeToken || yesId === undefined || noId === undefined) {
      throw new Error(
        "getMarketOnchain did not return marketAddress/outcomeToken/yesId/noId for this market, so the redeem call can't be built. Check docs.dreamdex.io/developers/event-contracts/recipes against the installed SDK version.",
      );
    }
    if (!accountAddress) {
      throw new Error("No wallet connected. Connect before redeeming.");
    }

    const outcomeIdx = side === "up" ? 0 : 1;
    const tokenId = BigInt(outcomeIdx === 0 ? yesId : noId);
    const amount = await exchange.client.getOutcomeBalance({ outcomeToken, account: accountAddress, id: tokenId });
    if (amount === 0n) return null;

    return exchange.trader.redeem({
      marketId: marketId as `0x${string}`,
      market: marketAddress,
      outcomeToken,
      outcomeIdx,
      amount,
    });
  }

  const trader = exchange.trader ?? (exchange.client as any);
  const fn = trader?.redeemOutcome ?? exchange.client.redeemOutcome;
  if (typeof fn !== "function") {
    throw new Error(
      "This SDK build exposes neither trader.redeem(...) nor redeemOutcome(marketId). Check docs.dreamdex.io/developers/event-contracts/recipes and wire the method from your installed version.",
    );
  }
  return fn(marketId);
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
  const redeemedKeys = new Set(
    journal.filter((r) => r.kind === "redeem").map((r) => `${r.marketId}:${r.side ?? ""}`),
  );

  for (const row of journal) {
    if (row.kind !== "trade" || row.result === "win" || row.result === "loss" || row.result === "void") continue;
    const side = row.side ?? "up";
    if (redeemedKeys.has(`${row.marketId}:${side}`)) continue;
    const market = markets.find((m) => m.marketId === row.marketId);
    const status = market?.status ?? "unknown";
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
      if (estimatedPayout > 0) {
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
      if (estimatedPayout > 0) {
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
  }

  if (typeof exchange.client.getClaimable === "function") {
    try {
      const extra = await exchange.client.getClaimable(account);
      const seen = new Set(claimable.map((c) => `${c.marketId}:${c.side}`));
      for (const row of extra ?? []) {
        const side: Side = Number(row.outcomeIdx) === 1 ? "down" : "up";
        const key = `${row.marketId}:${side}`;
        if (seen.has(key)) continue;
        const decimals = 6;
        const payoutRaw = typeof row.estPayout === "bigint" ? Number(row.estPayout) : Number(row.estPayout);
        const amountRaw = typeof row.amount === "bigint" ? Number(row.amount) : Number(row.amount);
        const estimatedPayout = Number.isFinite(payoutRaw) ? payoutRaw / 10 ** decimals : 0;
        const contracts = Number.isFinite(amountRaw) ? amountRaw / 10 ** decimals : 0;
        if (estimatedPayout <= 0) continue;
        const status = statusFromString(row.status);
        claimable.push({
          marketId: row.marketId,
          symbol: row.marketId,
          asset: "OTHER",
          timeframe: "other",
          side,
          contracts,
          estimatedPayout,
          resolved: status === "resolved" || status === "finalized" || status === "voided",
          fromChain: true,
        });
        seen.add(key);
      }
    } catch {
      /* getClaimable is additive */
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

// ---------------- probability chart ----------------

export type ProbabilityPoint = { t: number; probUp: number };

/**
 * The market's own trade tape, bucketed into candles by the indexer — read as
 * an implied Up-probability history (a binary market's price IS the YES/Up
 * probability, 0..1). Best-effort: an unreachable indexer or a market with no
 * fills yet returns an empty array rather than throwing, so a quiet chart is
 * never a crash.
 */
export async function getMarketProbabilityHistory(
  market: WindowMarket,
  opts: { limit?: number; intervalSeconds?: number } = {},
): Promise<ProbabilityPoint[]> {
  if (!exchange?.client.getCandles) return [];
  const raw = market.raw as Record<string, unknown> | undefined;
  const pool = String(raw?.poolAddress ?? raw?.pool ?? "");
  if (!pool || !pool.startsWith("0x")) return [];
  const quoteDecimals = Number(raw?.quoteDecimals ?? 6);
  const from = market.tradingStartSec || undefined;
  const to = market.expirySec || undefined;
  try {
    const candles = await exchange.client.getCandles(pool, opts.intervalSeconds ?? 60, {
      limit: opts.limit ?? 60,
      from,
      to,
    });
    return candles
      .map((c) => ({
        t: Number(c.bucketStart) * 1000,
        probUp: Math.min(1, Math.max(0, Number(c.closePrice) / 10 ** quoteDecimals)),
      }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.probUp));
  } catch {
    return [];
  }
}

// ---------------- recent-winners leaderboard ----------------

export type LeaderboardEntry = { address: string; wins: number; volumeWon: number };

/**
 * A best-effort "top winning stakes" board built from real on-chain fills —
 * there's no indexed cross-account redemption/PnL table to read directly, so
 * this reconstructs it: for each of the last `marketLimit` settled markets,
 * pull its fill tape and credit whoever bought onto the side that ended up
 * winning. Not a full PnL leaderboard (a wallet's losing markets aren't
 * netted out) — presented as "recent winning activity", not final standings.
 * Bounded and best-effort: any failure (or an SDK build without these reads)
 * returns an empty list rather than blocking the rest of the UI.
 */
export async function getRecentLeaderboard(
  opts: { marketLimit?: number; topN?: number } = {},
): Promise<LeaderboardEntry[]> {
  if (!exchange?.client.listPastBinaryMarkets || !exchange.client.getFills) return [];
  try {
    const past = await exchange.client.listPastBinaryMarkets({ limit: opts.marketLimit ?? 10 });
    const totals = new Map<string, { wins: number; volumeWon: number }>();

    for (const m of past) {
      if (m.voided || m.winningOutcome === null || m.winningOutcome === undefined) continue;
      const pool = String(m.poolAddress ?? "");
      if (!pool || !pool.startsWith("0x")) continue;
      const quoteDecimals = Number(m.quoteDecimals ?? 6);
      const winningSide: "BUY_YES" | "BUY_NO" = m.winningOutcome === 0 ? "BUY_YES" : "BUY_NO";

      let fills: FillShape[] = [];
      try {
        fills = await exchange.client.getFills(pool, { limit: 200 });
      } catch {
        continue;
      }

      for (const f of fills) {
        if (f.takerOrder?.side !== winningSide) continue;
        const owner = f.takerOrder?.owner ?? f.taker;
        if (!owner) continue;
        const quote = Number(f.quoteQuantity ?? 0) / 10 ** quoteDecimals;
        if (!Number.isFinite(quote)) continue;
        const entry = totals.get(owner) ?? { wins: 0, volumeWon: 0 };
        entry.wins += 1;
        entry.volumeWon += quote;
        totals.set(owner, entry);
      }
    }

    return [...totals.entries()]
      .map(([address, v]) => ({ address, ...v }))
      .sort((a, b) => b.volumeWon - a.volumeWon)
      .slice(0, opts.topN ?? 5);
  } catch {
    return [];
  }
}
