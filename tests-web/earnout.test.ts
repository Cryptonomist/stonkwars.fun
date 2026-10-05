/* Earnout's tag, as this app carries it onto a fight: the token an Earnout
 * link hands over decodes to what the instructions need, the two
 * instructions match the Earnout program's expectations byte for byte, and
 * anything else decodes to nothing. */

import { expect } from "chai";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { decodeEarnoutToken, EARNOUT_PROGRAM, earnoutTagInstructions, fitsWith } from "../src/lib/earnout";

const campaign = PublicKey.unique();
const identity = PublicKey.unique();
const reference = PublicKey.unique();
const signature = "3".repeat(88);
const token = `e1.${campaign.toBase58()}.${identity.toBase58()}.${reference.toBase58()}.${signature}`;

describe("the Earnout tag on a fight", () => {
  it("decodes a link token to its four parts", () => {
    const tag = decodeEarnoutToken(token)!;
    expect(tag.campaign.equals(campaign)).to.equal(true);
    expect(tag.identity.equals(identity)).to.equal(true);
    expect(tag.reference.equals(reference)).to.equal(true);
    expect(tag.signature).to.equal(signature);
  });

  it("builds the tag and the identity memo the settler looks for", () => {
    const [tag, memo] = earnoutTagInstructions(decodeEarnoutToken(token)!);
    expect(tag.programId.equals(EARNOUT_PROGRAM)).to.equal(true);
    expect(tag.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).to.deep.equal([
      [campaign.toBase58(), false, false],
      [identity.toBase58(), false, false],
      [reference.toBase58(), false, false],
    ]);
    expect([...tag.data]).to.deep.equal([62, 126, 95, 189, 228, 237, 42, 150]);
    expect(memo.programId.toBase58()).to.equal("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(memo.keys).to.deep.equal([]);
    expect(memo.data.toString("utf8")).to.equal(`solana-action:${identity.toBase58()}:${reference.toBase58()}:${signature}`);
  });

  it("rides along only when the fight's transaction still fits, so it never breaks one", () => {
    const tag = earnoutTagInstructions(decodeEarnoutToken(token)!);
    const payer = PublicKey.unique();
    // A fight entry with this many bytes of instruction data, standing in for a long taunt.
    const entry = (dataBytes: number) => [
      new TransactionInstruction({
        programId: PublicKey.unique(),
        keys: Array.from({ length: 12 }, () => ({ pubkey: PublicKey.unique(), isSigner: false, isWritable: true })),
        data: Buffer.alloc(dataBytes),
      }),
    ];
    // The largest real fight creation on devnet was 868 bytes; 370 more is 6 over the cap.
    expect(fitsWith(entry(100), payer, tag)).to.equal(true);
    expect(fitsWith(entry(600), payer, tag)).to.equal(false);
    expect(fitsWith(entry(600), payer, [])).to.equal(true);
  });

  it("decodes nothing else", () => {
    for (const t of ["", "e1.a.b.c.d", token.replace(/^e1\./, "e2."), token.split(".").slice(0, 4).join("."), `${token}.more`, token.replace(signature, "short")]) {
      expect(decodeEarnoutToken(t), t).to.equal(null);
    }
  });
});
