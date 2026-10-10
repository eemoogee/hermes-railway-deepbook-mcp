/**
 * NAVI Protocol lending tools.
 * Gives Dulcibella the ability to deposit, borrow, repay, withdraw,
 * and claim rewards on NAVI -- Sui's leading lending protocol.
 */

import type { AppState } from '../client.js';
import { executeTransaction } from '../utils/tx-executor.js';
import { Transaction } from '@mysten/sui/transactions';

// Numeric strings or numbers -> NAVI asset ID; "pkg::module::TYPE" -> coin type; anything else -> token symbol.
async function resolveNaviPool(identifier: string): Promise<any> {
  const { getPool, getPools } = await import('@naviprotocol/lending');
  if (/^\d+$/.test(identifier)) {
    return getPool(Number(identifier), { env: 'prod' });
  }
  if (identifier.includes('::')) {
    return getPool(identifier, { env: 'prod' });
  }
  const pools = (await getPools({ env: 'prod' })) as any[];
  const match = pools.find((p) => String(p.token?.symbol ?? '').toUpperCase() === identifier.toUpperCase());
  if (!match) {
    const symbols = pools.map((p) => p.token?.symbol).filter(Boolean).join(', ');
    throw new Error(`No NAVI pool for symbol "${identifier}". Available: ${symbols}`);
  }
  return match;
}

// NAVI reports rates as percent strings (e.g. "1.912"); keep blanks as null rather than 0
function pct(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

function amount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundedAmount(value: number | null): string {
  return value === null ? '?' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function naviGetPoolHandler(
  args: Record<string, unknown>,
  _state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const identifier = String(args.coin_type ?? '').trim();
    if (!identifier) throw new Error('coin_type is required.');

    const pool = await resolveNaviPool(identifier);
    const symbol: string = pool.token?.symbol ?? '';
    const supplied = amount(pool.poolSupplyAmount);
    const borrowed = amount(pool.poolBorrowAmount);
    const supplyApy = pct(pool.supplyIncentiveApyInfo?.apy);
    const borrowApy = pct(pool.borrowIncentiveApyInfo?.apy);
    // Checked against live SUI data: supply total = vaultApr + boostedApr, borrow total = vaultApr - boostedApr
    const supplyInterest = pct(pool.supplyIncentiveApyInfo?.vaultApr);
    const supplyRewards = pct(pool.supplyIncentiveApyInfo?.boostedApr);
    const borrowInterest = pct(pool.borrowIncentiveApyInfo?.vaultApr);
    const borrowRewards = pct(pool.borrowIncentiveApyInfo?.boostedApr);
    const supplyUnderlying = pct(pool.supplyIncentiveApyInfo?.underlyingApy);
    const ltv = amount(pool.ltvValue ?? pool.ltv);
    const liquidationThreshold = amount(pool.liquidationFactor?.threshold);

    const result = {
      symbol,
      coin_type: pool.suiCoinType ?? pool.coinType,
      asset_id: pool.id,
      summary: `${symbol}: lenders earn ${supplyApy ?? '?'}% APY (${supplyInterest ?? '?'}% interest + ${supplyRewards ?? '?'}% rewards); `
        + `borrowers pay ${borrowApy ?? '?'}% net APY (${borrowInterest ?? '?'}% interest - ${borrowRewards ?? '?'}% rewards). `
        + `${roundedAmount(supplied)} ${symbol} supplied, ${roundedAmount(borrowed)} ${symbol} borrowed.`,
      rates_pct: {
        supply: {
          total_apy: supplyApy,
          interest_apr: supplyInterest,
          reward_apr: supplyRewards,
          ...(supplyUnderlying ? { underlying_apy: supplyUnderlying } : {}),
          reward_coins: pool.supplyIncentiveApyInfo?.rewardCoin ?? [],
        },
        borrow: {
          net_apy: borrowApy,
          interest_apr: borrowInterest,
          reward_apr: borrowRewards,
          reward_coins: pool.borrowIncentiveApyInfo?.rewardCoin ?? [],
        },
        note: 'Percent per year. Lenders earn interest + rewards; borrowers pay interest minus rewards, so the net borrow APY can be lower than the supply APY. Rewards are paid in the listed reward_coins.',
      },
      pool_size: {
        total_supplied: supplied,
        total_borrowed: borrowed,
        unit: symbol,
        total_supplied_usd: amount(pool.poolSupplyValue),
        total_borrowed_usd: amount(pool.poolBorrowValue),
        utilization_pct: supplied && borrowed !== null ? Number(((borrowed / supplied) * 100).toFixed(2)) : null,
        oracle_price_usd: amount(pool.oracle?.price),
      },
      risk: {
        max_ltv_pct: ltv === null ? null : Number((ltv * 100).toFixed(2)),
        liquidation_threshold_pct: liquidationThreshold === null ? null : Number((liquidationThreshold * 100).toFixed(2)),
        is_isolated: pool.isIsolated,
      },
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }] };
  }
}

async function naviGetPositionHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { getLendingState, getHealthFactor } = await import('@naviprotocol/lending');

    if (!state.keypair) throw new Error('Keypair not configured.');
    const address = state.keypair.toSuiAddress();

    const [lendingState, healthFactor] = await Promise.all([
      getLendingState(address, { env: 'prod' }),
      getHealthFactor(address, { env: 'prod' }),
    ]);

    const result = {
      address,
      health_factor: healthFactor,
      positions: lendingState.map((s: any) => ({
        asset_id: s.assetId,
        coin_type: s.pool?.coinType ?? s.pool?.coin_type ?? '',
        symbol: s.pool?.token?.symbol ?? '',
        supply_balance: s.supplyBalance,
        borrow_balance: s.borrowBalance,
        market: s.market,
      })),
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }] };
  }
}

export const naviTools = [
  {
    name: 'navi_get_pool',
    description: 'Fetch current lending pool state for any NAVI-supported asset. Returns a plain-language summary, supply APY (interest + rewards) and net borrow APY (interest - rewards) in percent with the interest/reward split, pool size in whole tokens and USD, utilization, max LTV and liquidation threshold. Use this to check yield rates before depositing or to assess borrow costs.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_type: {
          type: 'string',
          description: 'Token symbol (e.g. "SUI", "USDC"), coin type (e.g. "0x2::sui::SUI"), or numeric NAVI asset ID (e.g. "0" for SUI).',
        },
      },
      required: ['coin_type'],
    },
  },
  {
    name: 'navi_get_position',
    description: 'Fetch current NAVI lending position for this wallet -- all supply and borrow balances across all assets plus health factor. Always call this before borrowing to verify health factor is safe. Health factor above 1.0 is safe; at or below 1.0 risks liquidation.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

export const naviHandlers: Record<string, (args: Record<string, unknown>, state: AppState) => Promise<{ content: { type: string; text: string }[] }>> = {
  navi_get_pool: naviGetPoolHandler,
  navi_get_position: naviGetPositionHandler,
};
