import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, Section } from "@/components/Legal";

export const metadata: Metadata = {
  title: "Terms",
  description: "What Stonk Wars is, what it is not, and what you take on by using it.",
};

export default function Terms() {
  return (
    <LegalPage
      title="Terms"
      updated="11 September 2026"
      intro="Stonk Wars is a demonstration of peer-to-peer escrow on Solana. Using it means accepting what follows. If you do not, do not use it."
    >
      <Section title="What this is">
        <p>
          Two people each stake tokenized shares of a stock. At the bell, whichever stock moved more in percent takes
          both stakes. A program on Solana holds the shares in the meantime and pays them out. That is the whole
          service.
        </p>
        <p>
          It currently runs on Solana devnet with test tokens that stand in for real tokenized shares. Devnet tokens
          have no monetary value, devnet SOL has no monetary value, and the cluster can be reset by its operators at
          any time, taking everything on it.
        </p>
      </Section>

      <Section title="What this is not">
        <p>
          Not advice. Nothing here is financial, investment, tax or legal advice, and nothing here is an offer or
          solicitation to buy or sell anything. We are not a broker, a dealer, an exchange, an investment adviser or a
          custodian, and we do not hold anyone&apos;s assets.
        </p>
        <p>
          Not a share in a company. A tokenized stock is an issuer&apos;s product. Whatever it entitles you to is between
          you and that issuer, and is described in their documents, not ours.
        </p>
      </Section>

      <Section title="Nobody holds the stakes but the program">
        <p>
          Staked shares sit in an escrow account owned by the fight itself. They can leave it three ways: back to the
          challenger if the challenge is called off, to the winner when it settles, or home to both if it could not be
          run fairly. There is no fourth way, and no key of ours can make one.
        </p>
        <p>
          An admin can pause new fights. Pausing cannot touch a fight already running, cannot block a settlement and
          cannot block a refund, because an admin who could freeze payouts would be a custodian.
        </p>
      </Section>

      <Section title="How a result is decided, and by whom">
        <p>
          By the bigger percentage move between two prices, worked out by the program in whole numbers with no rounding
          in the comparison. Anyone can post the prices and settle a fight, and the answer is identical whoever does it.
        </p>
        <p>
          A few stocks are priced by Pyth, which trusts nobody. The rest are priced by the Stonk Wars oracle: a key that
          signs the close of a stock&apos;s first one-minute bar at or after the moment in question, checked on chain by
          Solana&apos;s signature program. That second path is only as honest as that key, every fight that uses it says so
          on its own page, and every quote it signs is public in the transaction that used it. If you are not willing to
          rely on it, fight only the stocks marked as priced by Pyth.
        </p>
        <p>
          While a US stock&apos;s own market is open, from 4am to 8pm New York time, that market is where the oracle reads.
          Outside those hours, for stocks whose Solana pool clears a liquidity and volume floor, the price is taken from
          the last fifteen one-minute closes on that pool as of the moment in question, discarding the highest fifth and
          the lowest fifth and averaging the rest. Off-hours pool prices are
          thinner than an exchange print and can differ from where the stock next opens, which is the trade for being
          able to fight at all while the exchange is shut. The pool for each stock is pinned and published, so anyone
          can read the same number from the same public source.
        </p>
      </Section>

      <Section title="Who may use it">
        <p>
          You must be 18 or older, and using it must be lawful where you live. That is your judgement to make, not ours.
          Issuers of tokenized stocks generally do not offer them to US persons, and their restrictions are theirs to
          enforce.
        </p>
      </Section>

      <Section title="What you are taking on">
        <p>
          The program has not been audited. It has tests, its source is open, and it is deployed where anyone can read
          it, but software has bugs and this software may have some.
        </p>
        <p>
          Every issuer of a tokenized stock keeps powers over its tokens, including ones sitting in a fight: freezing an
          account, pausing transfers, and in most cases moving tokens out of any account at will. A fight inherits those
          powers over what it holds, and nothing built on top can remove them.
        </p>
        <p>
          Prices come from outside. A source can be late, wrong or unavailable. A stock that does not trade in the
          relevant minute settles on its next trade, which for a thin listing can be the following morning. A pool that
          barely trades in the fifteen minutes before a boundary gives no off-hours price at all. A fight that cannot be
          run fairly is voided and both stakes go home.
        </p>
        <p>
          Your wallet is yours. We cannot recover a key, reverse a signature or undo a transaction, and neither can
          anyone else.
        </p>
      </Section>

      <Section title="Connecting an X account">
        <p>
          Optional, and cosmetic: it puts a handle beside your record. Doing it writes that handle onto a public
          blockchain next to your wallet address, permanently. The{" "}
          <Link className="text-ink underline decoration-line underline-offset-4" href="/privacy">
            privacy policy
          </Link>{" "}
          says exactly what that means before you decide.
        </p>
      </Section>

      <Section title="Fair use">
        <p>
          Do not use Stonk Wars for anything unlawful. Do not attack, overload or try to disrupt it. Do not drain the
          test faucet with scripts, which only spoils it for people trying the demo. Do not use a handle to pass
          yourself off as somebody else.
        </p>
      </Section>

      <Section title="Names that belong to other people">
        <p>
          Ticker symbols and company names appear here to identify the stock a fight is about. Stonk Wars is not
          affiliated with, endorsed by or sponsored by any of those companies, nor by X Corp., Pyth, the Solana
          Foundation, or any issuer of tokenized stocks. All trademarks belong to their owners.
        </p>
      </Section>

      <Section title="No warranty, and the limit of what we owe">
        <p>
          Stonk Wars is provided as it is, with no warranty of any kind, express or implied, including that it will be
          available, uninterrupted, accurate or fit for any purpose.
        </p>
        <p>
          To the fullest extent the law allows, we are not liable for any loss arising from using it, including lost
          tokens, lost profits, or any indirect or consequential loss. Where liability cannot be excluded, it is limited
          to the amount you paid us, which is nothing.
        </p>
      </Section>

      <Section title="Changes and the law that applies">
        <p>
          These terms can change, and the date at the top changes with them. Continuing to use the site after that means
          accepting the new version.
        </p>
        <p>
          Governing law and the courts that hear any dispute: the laws of the operator&apos;s place of residence, to be
          stated here before any mainnet deployment.
        </p>
      </Section>
    </LegalPage>
  );
}
