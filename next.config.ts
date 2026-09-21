import type { NextConfig } from "next";

/* Security headers, carried over from Commish where each one was checked
 * against what the app does. Framing is refused outright: these pages call
 * signTransaction. A full Content-Security-Policy is deliberately not here
 * (inline hydration scripts, wallet injections and the RPC socket would all
 * need allowances); the three directives below constrain none of those. */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  /* lib/stocks.ts picks one cluster's token list and relies on the bundler to
   * drop the other two, which it can only do when this is known at build time.
   * A machine without the variable set used to ship all three lists (about
   * 95 kB gzipped of dead data on every page). */
  env: { NEXT_PUBLIC_CLUSTER: process.env.NEXT_PUBLIC_CLUSTER ?? "devnet" },


  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  /* `ws` ships two optional native accelerators and the Solana wallet packages
   * pull it in; neither is needed in a browser bundle. `pino-pretty` is the
   * same story from the logging side. */
  webpack: (config) => {
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      "bufferutil",
      "utf-8-validate",
      "pino-pretty",
    ];
    return config;
  },
};

export default nextConfig;
