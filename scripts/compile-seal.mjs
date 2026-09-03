import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const solc = require("solc");
const source = await import("node:fs/promises").then((fs) =>
  fs.readFile(join(root, "contracts/KeelSeal.sol"), "utf8"),
);

const input = {
  language: "Solidity",
  sources: { "KeelSeal.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors?.some((e) => e.severity === "error")) {
  console.error(out.errors);
  process.exit(1);
}
const art = out.contracts["KeelSeal.sol"].KeelSeal;
const destDir = join(root, "src/lib");
if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
writeFileSync(
  join(destDir, "KeelSeal.generated.ts"),
  `export const KEEL_SEAL_ABI = ${JSON.stringify(art.abi, null, 2)} as const;\nexport const KEEL_SEAL_BYTECODE = "0x${art.evm.bytecode.object}" as const;\n`,
);
console.log("compiled KeelSeal", art.evm.bytecode.object.length / 2, "bytes");
execSync("true");
