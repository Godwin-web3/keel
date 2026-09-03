import {
  decodeEventLog,
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  maxUint256,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { KEEL_SEAL_ABI, KEEL_SEAL_BYTECODE } from "./KeelSeal.generated";
import { getTradeContext } from "./sdk";
import type { NetworkName, Side, WindowMarket } from "./types";

export type SealStatus = "sealed" | "revealed" | "refunded" | "placed";

export type LocalSeal = {
  id: string;
  chainId: string;
  marketId: string;
  symbol: string;
  asset: WindowMarket["asset"];
  timeframe: string;
  side: Side;
  amount: number;
  amountWei: string;
  salt: Hex;
  revealBy: number;
  status: SealStatus;
  commitHash?: string;
  revealHash?: string;
  placeHash?: string;
};

const ADDR_KEY = (n: NetworkName) => `keel.seal.addr.${n}`;
const LIST_KEY = (n: NetworkName) => `keel.seals.${n}.v1`;

export function loadSeals(network: NetworkName): LocalSeal[] {
  try {
    const raw = localStorage.getItem(LIST_KEY(network));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalSeal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSeals(network: NetworkName, rows: LocalSeal[]): void {
  localStorage.setItem(LIST_KEY(network), JSON.stringify(rows.slice(0, 80)));
}

export function getSealAddress(network: NetworkName): Address | null {
  try {
    const v = localStorage.getItem(ADDR_KEY(network));
    return v && v.startsWith("0x") ? (v as Address) : null;
  } catch {
    return null;
  }
}

function setSealAddress(network: NetworkName, addr: Address): void {
  localStorage.setItem(ADDR_KEY(network), addr);
}

export function marketToBytes32(id: string): Hex {
  const h = id.toLowerCase().replace(/^0x/, "");
  if (h.length === 64) return `0x${h}`;
  return `0x${h.padStart(64, "0")}`;
}

export function makeSalt(): Hex {
  const u = new Uint8Array(32);
  crypto.getRandomValues(u);
  return `0x${Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function commitmentHash(args: {
  marketId: string;
  side: Side;
  amountWei: bigint;
  salt: Hex;
  owner: Address;
}): Hex {
  const side = args.side === "up" ? 1 : 2;
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
      ],
      [marketToBytes32(args.marketId), side, args.amountWei, args.salt, args.owner],
    ),
  );
}

export function sealDeadline(market: WindowMarket, nowSec = Math.floor(Date.now() / 1000)): number {
  const expiry = market.expirySec || nowSec + 600;
  return Math.max(nowSec + 45, expiry - 30);
}

export function canSeal(market: WindowMarket, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return market.status === "trading" && sealDeadline(market, nowSec) > nowSec + 20;
}

async function decimalsFor(network: NetworkName, market?: WindowMarket): Promise<number> {
  const d = Number((market?.raw as { quoteDecimals?: number } | undefined)?.quoteDecimals);
  if (d === 6 || d === 18) return d;
  try {
    const { publicClient, collateral } = await getTradeContext(network);
    const n = await publicClient.readContract({
      address: collateral,
      abi: erc20Abi,
      functionName: "decimals",
    });
    return Number(n);
  } catch {
    return network === "mainnet" ? 18 : 6;
  }
}

async function ensureAllowance(network: NetworkName, spender: Address, need: bigint): Promise<void> {
  const { publicClient, walletClient, account, collateral } = await getTradeContext(network);
  const have = (await publicClient.readContract({
    address: collateral,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, spender],
  })) as bigint;
  if (have >= need) return;
  const hash = await walletClient.writeContract({
    address: collateral,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
    account,
    chain: walletClient.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function ensureSealDeployed(network: NetworkName): Promise<Address> {
  const existing = getSealAddress(network);
  if (existing) return existing;
  const { publicClient, walletClient, account, collateral } = await getTradeContext(network);
  const hash = await walletClient.deployContract({
    abi: KEEL_SEAL_ABI,
    bytecode: KEEL_SEAL_BYTECODE,
    args: [collateral],
    account,
    chain: walletClient.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const addr = receipt.contractAddress;
  if (!addr) throw new Error("Seal contract deployed but no address came back.");
  setSealAddress(network, addr);
  return addr;
}

export async function commitSeal(args: {
  network: NetworkName;
  market: WindowMarket;
  side: Side;
  amount: number;
}): Promise<LocalSeal> {
  if (!canSeal(args.market)) throw new Error("Too close to close to seal this one. Place it in the open, or pick a later window.");
  const { publicClient, walletClient, account } = await getTradeContext(args.network);
  const seal = await ensureSealDeployed(args.network);
  const decimals = await decimalsFor(args.network, args.market);
  const amountWei = parseUnits(String(args.amount), decimals);
  await ensureAllowance(args.network, seal, amountWei);
  const salt = makeSalt();
  const revealBy = BigInt(sealDeadline(args.market));
  const commitment = commitmentHash({
    marketId: args.market.marketId,
    side: args.side,
    amountWei,
    salt,
    owner: account,
  });
  const hash = await walletClient.writeContract({
    address: seal,
    abi: KEEL_SEAL_ABI,
    functionName: "commit",
    args: [commitment, marketToBytes32(args.market.marketId), amountWei, revealBy],
    account,
    chain: walletClient.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let id = "";
  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({ abi: KEEL_SEAL_ABI, data: log.data, topics: log.topics });
      if (parsed.eventName === "Sealed") {
        id = String((parsed.args as { id: bigint }).id);
        break;
      }
    } catch {
      /* other logs */
    }
  }
  if (!id) throw new Error("Sealed on-chain but couldn't read the ticket id.");
  const row: LocalSeal = {
    id,
    chainId: seal,
    marketId: args.market.marketId,
    symbol: args.market.symbol,
    asset: args.market.asset,
    timeframe: args.market.timeframe,
    side: args.side,
    amount: args.amount,
    amountWei: amountWei.toString(),
    salt,
    revealBy: Number(revealBy),
    status: "sealed",
    commitHash: hash,
  };
  saveSeals(args.network, [row, ...loadSeals(args.network)]);
  return row;
}

export async function revealSeal(network: NetworkName, row: LocalSeal): Promise<string> {
  const { publicClient, walletClient, account } = await getTradeContext(network);
  const seal = (row.chainId as Address) || getSealAddress(network);
  if (!seal) throw new Error("No seal contract.");
  const side = row.side === "up" ? 1 : 2;
  const hash = await walletClient.writeContract({
    address: seal,
    abi: KEEL_SEAL_ABI,
    functionName: "reveal",
    args: [BigInt(row.id), side, row.salt],
    account,
    chain: walletClient.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  patchSeal(network, row.id, { status: "revealed", revealHash: hash });
  return hash;
}

export async function refundSeal(network: NetworkName, row: LocalSeal): Promise<string> {
  const { publicClient, walletClient, account } = await getTradeContext(network);
  const seal = (row.chainId as Address) || getSealAddress(network);
  if (!seal) throw new Error("No seal contract.");
  const hash = await walletClient.writeContract({
    address: seal,
    abi: KEEL_SEAL_ABI,
    functionName: "refund",
    args: [BigInt(row.id)],
    account,
    chain: walletClient.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  patchSeal(network, row.id, { status: "refunded", revealHash: hash });
  return hash;
}

export function markSealPlaced(network: NetworkName, id: string, placeHash?: string): void {
  patchSeal(network, id, { status: "placed", placeHash });
}

function patchSeal(network: NetworkName, id: string, patch: Partial<LocalSeal>): void {
  saveSeals(
    network,
    loadSeals(network).map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
}
