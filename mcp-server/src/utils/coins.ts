/**
 * Coins the balance, deposit and withdraw tools handle, with their on-chain type and
 * decimals taken from the DeepBook SDK for the configured network.
 */

import { mainnetCoins, testnetCoins } from '@mysten/deepbook-v3';
import { config } from '../config.js';
import { requireOneOf } from './validate.js';

export const SUPPORTED_COINS = ['SUI', 'USDC', 'DEEP', 'USDSUI'] as const;
export type SupportedCoin = (typeof SUPPORTED_COINS)[number];

export interface NetworkCoin {
  key: SupportedCoin;
  /** Full Move type, e.g. 0x...::usdc::USDC */
  type: string;
  /** Raw units per whole coin (1e9 for SUI, 1e6 for the others) */
  scalar: number;
}

/** The supported coins the SDK defines on this network; USDC and USDSUI exist on mainnet only. */
export function networkCoins(): NetworkCoin[] {
  const coins: Record<string, { type: string; scalar: number }> =
    config.network === 'testnet' ? testnetCoins : mainnetCoins;
  return SUPPORTED_COINS.filter((key) => key in coins).map((key) => ({
    key,
    type: coins[key].type,
    scalar: coins[key].scalar,
  }));
}

/** A supported coin key that exists on this network, or throws. */
export function requireNetworkCoin(name: string, value: unknown): SupportedCoin {
  return requireOneOf(name, value, networkCoins().map((c) => c.key));
}
