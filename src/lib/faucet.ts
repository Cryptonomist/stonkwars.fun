/* WHAT THE TEST FAUCET HANDS OUT, in one place.
 *
 * The faucet route tops a wallet up to about this many dollars of each test
 * stock it asks for. The fight ticket needs the same number: offering "Get
 * test AAPLx" for a $5,000 stake sent people to a button that could never
 * cover it. It lives here, not in the route, because a route file may export
 * only its handlers and Next refuses the build otherwise. */

/** Dollars of each test stock a faucet top-up reaches. */
export const FAUCET_TARGET_USD = 250;

/** A top-up only happens while a wallet holds under half the target, so a
 *  second press gives nothing until the wallet has spent some. */
export const faucetWouldTopUp = (heldUsd: number | null): boolean => heldUsd === null || heldUsd * 2 < FAUCET_TARGET_USD;
