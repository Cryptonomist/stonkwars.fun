import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, Section } from "@/components/Legal";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Stonk Wars collects, which is close to nothing, and what the blockchain makes public forever.",
};

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy"
      updated="13 September 2026"
      intro="Stonk Wars has no accounts, no signup and no email list. There is very little to say here, and most of what there is concerns a blockchain, which is public by design and which nobody can edit afterwards, including us."
    >
      <Section title="What we do not collect">
        <p>
          No account, no password, no email address, no name, no phone number. No analytics, no advertising, no
          third-party trackers, no fingerprinting, no session recording. Nothing is sold or shared for marketing,
          because nothing is gathered to sell.
        </p>
      </Section>

      <Section title="What the blockchain makes public">
        <p>
          Every fight is a public record on Solana: the wallet addresses involved, the stocks, the stakes, the prices
          that settled it and the result. That is how anyone can check a fight without trusting us, and it is the point
          of the whole thing.
        </p>
        <p>
          It also means those records are not ours to change. We do not hold them, we cannot edit them, and we cannot
          delete them for you. Anyone can read them at any time, now and in years to come.
        </p>
      </Section>

      <Section title="If you connect X">
        <p>Connecting an X account is optional. It puts a handle next to your record on the leaderboard, and that is all it does.</p>
        <p>
          We use X&apos;s own sign-in. We ask for read-only access to your profile, plus the permission to read posts that
          X requires before it will hand over a profile, and nothing else. We never read your posts with it, never
          post, never read your messages, never follow or unfollow anyone, and never see your password. We do not
          request offline access, so X gives us no refresh token and we cannot act as you later.
        </p>
        <p>
          At the moment you connect we read three things, your numeric X account id, your handle, and the address of
          your X profile picture. The access token that let us read them is discarded immediately and never stored.
        </p>
        <p className="text-ink">
          Your handle and your numeric X id, and a memo with your profile picture&apos;s address, are then written onto
          the Solana blockchain, beside your wallet address, in a transaction you sign yourself. The picture itself is
          fetched from X by this site and shown beside your handle, so a visitor&apos;s browser never contacts X for it. That record is public and permanent. Unlinking closes the account and returns
          its rent, but the transaction that created it stays in the chain&apos;s history for good. If you would rather not
          have an X account tied publicly to a wallet, do not connect one.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Three, all short-lived, all only during the few seconds you are connecting an X account. One carries the
          one-time security values that stop somebody else&apos;s sign-in being swapped for yours. One remembers which
          page on this site to bring you back to. The last carries the handle and picture X just confirmed, from the
          moment you come back to the moment you sign. All expire within minutes and none is readable by scripts in the
          page.
        </p>
        <p>There are no analytics cookies, because there are no analytics.</p>
      </Section>

      <Section title="What your own browser keeps">
        <p>
          On test clusters the site can make you a guest wallet so you can play without installing an extension. Its key
          is generated in your browser and kept in your browser&apos;s local storage. It never reaches our servers and we
          never see it. Clearing site data destroys it, and anything it holds.
        </p>
      </Section>

      <Section title="Servers and logs">
        <p>
          The site runs on Vercel, which keeps ordinary request logs for a short time as part of serving pages: IP
          address, the page asked for, a timestamp, a browser string. That is Vercel&apos;s standard operation, we use those
          logs only to keep the site working, and we do not join them to wallets or handles.
        </p>
      </Section>

      <Section title="Who else sees something">
        <p>
          Loading a page or settling a fight means talking to a Solana node, to Pyth, and to a market data source for
          prices. Connecting an account means talking to X. Those services see the requests we make on your behalf, and
          their own privacy policies govern what they do with them.
        </p>
      </Section>

      <Section title="Age">
        <p>Stonk Wars is not for anyone under 18, and we do not knowingly collect anything from children.</p>
      </Section>

      <Section title="Changes">
        <p>
          If this changes, the date at the top changes with it. The{" "}
          <Link className="text-ink underline decoration-line underline-offset-4" href="/how">
            how it works
          </Link>{" "}
          page describes what the program does and where prices come from, in more detail than belongs here.
        </p>
      </Section>
    </LegalPage>
  );
}
