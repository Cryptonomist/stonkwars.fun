"use client";

/* Devnet only: test shares and a little SOL, so a judge with an empty wallet
 * can play in under a minute. The server holds the test mints' authority. */

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";

export function FaucetButton({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { publicKey } = useWallet();
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function drip() {
    if (!publicKey) {
      setState("error");
      setMsg("Connect a wallet first.");
      return;
    }
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const body = (await r.json()) as { ok?: boolean; message?: string; error?: string };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setState("done");
      setMsg(body.message ?? "Sent.");
      void qc.invalidateQueries();
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Faucet failed.");
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={drip} disabled={state === "busy"} className={`btn btn-sm btn-ghost ${compact ? "!px-2" : ""}`}>
        {state === "busy" ? "Minting..." : compact ? "Faucet" : "Get test stocks"}
      </button>
      {msg ? (
        <p className={`card absolute right-0 z-30 mt-2 w-64 p-3 text-xs ${state === "error" ? "text-down" : "text-up"}`}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}
