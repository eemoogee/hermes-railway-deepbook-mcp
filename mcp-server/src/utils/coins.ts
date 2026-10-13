/**
 * Coins the balance, deposit and withdraw tools handle, with their on-chain type and
 * decimals taken from the DeepBook SDK for the configured network.
 */

import { mainnetCoins, testnetCoins } from '@mysten/deepbook-v3';
import { normalizeStructTag } from '@mysten/sui/utils';
import { config } from '../config.js';
import { requireOneOf } from './validate.js';
import type { AppState } from '../client.js';

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

/** A supported coin by key, e.g. 'SUI'; null when it doesn't exist on this network. */
export function networkCoin(key: string): NetworkCoin | null {
  return networkCoins().find((c) => c.key === key) ?? null;
}

/** The supported coin with this Move type; 0x2::sui::SUI and its long form both match SUI. */
export function coinByType(type: string): NetworkCoin | null {
  let wanted: string;
  try { wanted = normalizeStructTag(type); } catch { return null; }
  return networkCoins().find((c) => normalizeStructTag(c.type) === wanted) ?? null;
}

/** The wallet's balance of one coin type, in raw on-chain units. */
export async function walletBalanceRaw(state: AppState, owner: string, type: string): Promise<bigint> {
  const response = await (state.client as any).getBalance({ owner, coinType: type });
  return BigInt(response?.balance?.balance ?? '0');
}

/** Raw units as whole coins, e.g. 1915000n with scalar 1e6 -> 1.915 */
export function toWhole(raw: bigint | string, scalar: number): number {
  return Number(raw) / scalar;
}

/**
 * Wallet balance changes in whole coins, e.g. [{ coin: 'USDSUI', amount: -1.915 }].
 * Negative = left the wallet. The SUI change already includes the network fee.
 * Coins outside SUPPORTED_COINS keep their full type and raw amount.
 */
export function describeBalanceChanges(changes: { coin_type: string; amount_raw: string }[]):
  ({ coin: string; amount: number } | { coin_type: string; amount_raw: string })[] {
  return changes.map((c) => {
    const coin = coinByType(c.coin_type);
    return coin ? { coin: coin.key, amount: toWhole(c.amount_raw, coin.scalar) } : c;
  });
}
