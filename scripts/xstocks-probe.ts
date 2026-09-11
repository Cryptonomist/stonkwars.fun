/* Would real xStocks pass the escrow screen? Read their mainnet mint accounts,
 * list their Token-2022 extensions, and apply the same test as
 * programs/duel/src/mint_check.rs.
 *
 *   RPC=https://api.mainnet-beta.solana.com npx tsx scripts/xstocks-probe.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC ?? "https://api.mainnet-beta.solana.com";

/* Mints from Jupiter's verified token list, 2026-09-11. */
const XSTOCKS: Record<string, string> = {
  NVDAx: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  TSLAx: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  AAPLx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  SPYx: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
  QQQx: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
  MSFTx: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
  GOOGLx: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
  AMZNx: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
  METAx: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
  COINx: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
  MSTRx: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
  HOODx: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
  PLTRx: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4",
};

const NAMES: Record<number, string> = {
  1: "TransferFeeConfig", 3: "MintCloseAuthority", 4: "ConfidentialTransferMint", 6: "DefaultAccountState",
  9: "NonTransferable", 10: "InterestBearingConfig", 12: "PermanentDelegate", 14: "TransferHook",
  16: "ConfidentialTransferFeeConfig", 18: "MetadataPointer", 19: "TokenMetadata", 20: "GroupPointer",
  21: "TokenGroup", 22: "GroupMemberPointer", 23: "TokenGroupMember", 24: "ConfidentialMintBurn",
  25: "ScaledUiAmount", 26: "Pausable",
};

function extensions(data: Buffer): { kind: number; value: Buffer }[] {
  if (data.length <= 82) return [];
  const out: { kind: number; value: Buffer }[] = [];
  let at = 166;
  while (at + 4 <= data.length) {
    const kind = data.readUInt16LE(at);
    const len = data.readUInt16LE(at + 2);
    if (kind === 0) break;
    out.push({ kind, value: data.subarray(at + 4, at + 4 + len) });
    at += 4 + len;
  }
  return out;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const infos = await conn.getMultipleAccountsInfo(Object.values(XSTOCKS).map((m) => new PublicKey(m)));
  let pass = 0;
  Object.keys(XSTOCKS).forEach((sym, i) => {
    const info = infos[i];
    if (!info) return console.log(sym.padEnd(7), "MISSING");
    const exts = extensions(info.data);
    const hook = exts.find((e) => e.kind === 14);
    const liveHook = hook ? !hook.value.subarray(32, 64).every((b) => b === 0) : false;
    const nonTransferable = exts.some((e) => e.kind === 9);
    // DefaultAccountState: one byte, 1 = Initialized, 2 = Frozen.
    const das = exts.find((e) => e.kind === 6)?.value[0];
    const frozenByDefault = das === 2;
    // ScaledUiAmount: authority(32) multiplier(f64) new_multiplier_effective_timestamp(i64) new_multiplier(f64)
    const sua = exts.find((e) => e.kind === 25)?.value;
    const multiplier = sua && sua.length >= 40 ? sua.readDoubleLE(32) : null;
    const nextMultiplier = sua && sua.length >= 56 ? sua.readDoubleLE(48) : null;
    const ok = !liveHook && !nonTransferable && !frozenByDefault;
    if (ok) pass++;
    console.log(
      sym.padEnd(7),
      ok ? "ESCROWABLE" : "REFUSED   ",
      `defaultState=${das === 1 ? "Initialized" : das === 2 ? "FROZEN" : das}`,
      `multiplier=${multiplier}${nextMultiplier !== null && nextMultiplier !== multiplier ? ` -> ${nextMultiplier}` : ""}`,
      liveHook ? "(live transfer hook)" : "",
    );
  });
  console.log(`${pass}/${Object.keys(XSTOCKS).length} pass the escrow screen`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
