/* A guest wallet, for test clusters only.
 *
 * A judge with no Solana wallet, or with Phantom set to mainnet and no devnet
 * SOL, would otherwise need five minutes of setup before their first fight.
 * This makes a keypair in the browser's localStorage the first time it is
 * chosen, and the faucet funds it. One click to connect, one to get stocks.
 *
 * IT IS NOT A WALLET FOR ANYTHING OF VALUE, and the app refuses to offer it on
 * mainnet (see Providers). The key sits in plain localStorage, readable by any
 * script this origin ever runs. That is an acceptable home for devnet test
 * shares and nothing else.
 *
 * It is a plain wallet-adapter adapter because it does not implement the
 * Wallet Standard, which is the one reason Providers ever passes an explicit
 * adapter. Ready state is Installed: it is built in, and on a phone with no
 * wallet app it is what lets someone play without leaving the browser.
 */

import {
  BaseSignerWalletAdapter,
  isVersionedTransaction,
  WalletNotConnectedError,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { Keypair, type PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

export const GuestWalletName = "Guest wallet (devnet)" as WalletName<"Guest wallet (devnet)">;

const STORAGE_KEY = "stonkwars.guest-wallet.v1";

const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#15151f"/><polyline points="4,27 10,19 14,22 25,7" fill="none" stroke="#2fe0ff" stroke-width="3.2"/><polyline points="28,27 22,19 18,22 7,7" fill="none" stroke="#ff3ea5" stroke-width="3.2"/></svg>',
      )
    : "");

export class GuestWalletAdapter extends BaseSignerWalletAdapter {
  name = GuestWalletName;
  url = "https://stonkwars.fun";
  icon = ICON;
  readonly supportedTransactionVersions = new Set(["legacy", 0] as const);

  private keypair: Keypair | null = null;
  private busy = false;

  get publicKey(): PublicKey | null {
    return this.keypair?.publicKey ?? null;
  }

  get connecting(): boolean {
    return this.busy;
  }

  get readyState(): WalletReadyState {
    return typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Installed;
  }

  async connect(): Promise<void> {
    if (this.keypair || this.busy) return;
    this.busy = true;
    try {
      let stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        stored = JSON.stringify(Array.from(Keypair.generate().secretKey));
        window.localStorage.setItem(STORAGE_KEY, stored);
      }
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored) as number[]));
      this.emit("connect", this.keypair.publicKey);
    } finally {
      this.busy = false;
    }
  }

  async disconnect(): Promise<void> {
    this.keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this.keypair) throw new WalletNotConnectedError();
    if (isVersionedTransaction(tx)) tx.sign([this.keypair]);
    else tx.partialSign(this.keypair);
    return tx;
  }
}
