/**
 * Deploy KeelSeal to Somnia Shannon.
 *
 * Usage:
 *   DEPLOYER_KEY=0x... npx tsx scripts/deploy-seal.ts
 *   # or place the key at ~/.config/keel/deployer.key (outside the repo)
 *
 * Never commit private keys.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KEEL_SEAL_ABI, KEEL_SEAL_BYTECODE } from "../src/lib/KeelSeal.generated";

function loadDeployerKey(): `0x${string}` {
  const fromEnv = process.env.DEPLOYER_KEY?.trim();
  if (fromEnv?.startsWith("0x") && fromEnv.length === 66) return fromEnv as `0x${string}`;
  const path = join(homedir(), ".config/keel/deployer.key");
  if (existsSync(path)) {
    const key = readFileSync(path, "utf8").trim();
    if (key.startsWith("0x") && key.length === 66) return key as `0x${string}`;
  }
  throw new Error("Set DEPLOYER_KEY or write ~/.config/keel/deployer.key (never commit the key).");
}

async function main() {
  const account = privateKeyToAccount(loadDeployerKey());

  const shannon = defineChain({
    id: 50312,
    name: "Somnia Shannon",
    nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: ["https://dream-rpc.somnia.network"] } },
  });

  const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;

  const publicClient = createPublicClient({
    chain: shannon,
    transport: http("https://dream-rpc.somnia.network"),
  });
  const walletClient = createWalletClient({
    account,
    chain: shannon,
    transport: http("https://dream-rpc.somnia.network"),
  });

  const bal = await publicClient.getBalance({ address: account.address });
  console.log(JSON.stringify({ deployer: account.address, balanceSTT: Number(bal) / 1e18 }));
  if (bal === 0n) throw new Error("No STT");

  console.log("Deploying KeelSeal...");
  const hash = await walletClient.deployContract({
    abi: KEEL_SEAL_ABI,
    bytecode: KEEL_SEAL_BYTECODE,
    args: [COLLATERAL],
    account,
  });
  console.log("tx", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  const address = receipt.contractAddress;
  if (!address) throw new Error("No contractAddress in receipt");

  const code = await publicClient.getCode({ address });
  const out = {
    network: "shannon",
    chainId: 50312,
    address,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
    collateral: COLLATERAL,
    deployer: account.address,
    codeBytes: code ? (code.length - 2) / 2 : 0,
  };
  const outPath = join(homedir(), ".config/keel/shannon-keelseal.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log("wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
