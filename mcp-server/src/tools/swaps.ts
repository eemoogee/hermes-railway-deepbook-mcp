/**
 * DeepBook swap tools.
 * Execute immediate token swaps using wallet coins directly.
 */

import { Transaction } from '@mysten/sui/transactions';
import { mainnetPools, testnetPools } from '@mysten/deepbook-v3';
import { config } from '../config.js';
import { executeTransaction, simulateTransaction } from '../utils/tx-executor.js';
import {
  requireAllowedPool, requirePositiveNumber, optionalNonNegativeNumber, optionalBoolean, maxSlippagePct,
} from '../utils/validate.js';
import { swapMinOut } from '../utils/slippage.js';
import type { AppState } from '../client.js';

// Handler signature
export type SwapHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

type Direction = 'base_for_quote' | 'quote_for_base';

/** Base and quote coin keys of a DeepBook pool, e.g. SUI_USDSUI -> { base: 'SUI', quote: 'USDSUI' }. */
function poolCoins(pool: string): { base: string; quote: string } {
  const pools: Record<string, { baseCoin: string; quoteCoin: string }> =
    config.network === 'testnet' ? testnetPools : mainnetPools;
  const p = pools[pool];
  if (!p) {
    throw new Error(`Unknown DeepBook pool '${pool}'.`);
  }
  return { base: p.baseCoin, quote: p.quoteCoin };
}

function describeSimulation(simulation: { would_succeed: boolean; error: unknown; gas_fee_sui: number | null }): string {
  if (simulation.would_succeed) {
    return 'the simulation says it would succeed' +
      (simulation.gas_fee_sui !== null ? `, network fee about ${Number(simulation.gas_fee_sui.toPrecision(3))} SUI` : '');
  }
  const reason = typeof simulation.error === 'string' ? simulation.error : JSON.stringify(simulation.error);
  return `the simulation says it would FAIL: ${reason}`;
}

/**
 * Shared swap flow. When the caller gives no minimum output, the minimum is set from a
 * live quote minus MAX_SLIPPAGE_PCT, so a swap never accepts an unbounded price.
 */
async function runSwap(
  args: Record<string, unknown>,
  state: AppState,
  direction: Direction,
): Promise<{ content: { type: string; text: string }[] }> {
  if (!state.keypair) {
    throw new Error('Cannot execute swap: MCP server is in read-only mode.');
  }

  const amountKey = direction === 'base_for_quote' ? 'base_amount' : 'quote_amount';
  const minOutKey = direction === 'base_for_quote' ? 'min_quote_out' : 'min_base_out';

  const pool = requireAllowedPool(args.pool);
  const amount = requirePositiveNumber(amountKey, args[amountKey]);
  const deep_amount = optionalNonNegativeNumber('deep_amount', args.deep_amount, 0);
  const dry_run = optionalBoolean('dry_run', args.dry_run, false);

  // An explicit min of 0 is still treated as "not given": it would disable price protection
  const callerMinOut = optionalNonNegativeNumber(minOutKey, args[minOutKey], 0);
  const guard = await swapMinOut(state, pool, direction, amount, maxSlippagePct());
  const min_out = callerMinOut > 0 ? callerMinOut : guard.min_out;

  const senderAddress = state.keypair.toSuiAddress();
  const tx = new Transaction();
  const dbContract = state.client.deepbook.deepBook as any;
  const params = { poolKey: pool, amount, deepAmount: deep_amount, minOut: min_out };
  const [baseCoinResult, quoteCoinResult, deepCoinResult] = direction === 'base_for_quote'
    ? dbContract.swapExactBaseForQuote(params)(tx)
    : dbContract.swapExactQuoteForBase(params)(tx);
  tx.transferObjects([baseCoinResult, quoteCoinResult, deepCoinResult], senderAddress);

  const { base, quote } = poolCoins(pool);
  const [sellCoin, buyCoin] = direction === 'base_for_quote' ? [base, quote] : [quote, base];
  const fmt = (n: number) => Number(n.toPrecision(6));
  const trade = `sell ${amount} ${sellCoin} for about ${fmt(guard.expected_out)} ${buyCoin} on ${pool} ` +
    `(minimum ${fmt(min_out)} ${buyCoin}` +
    (guard.input_returned > 0 ? `; ${fmt(guard.input_returned)} ${sellCoin} returned unused` : '') + ')';

  const swap = {
    pool,
    // Spelled out so the direction of the trade is never ambiguous
    sell: { coin: sellCoin, amount },
    buy: { coin: buyCoin, expected: guard.expected_out, minimum: min_out },
    [amountKey]: amount,
    expected_out: guard.expected_out,
    // Fills come in whole lots; any leftover input goes back to the wallet
    input_returned: guard.input_returned,
    [minOutKey]: min_out,
    min_out_source: callerMinOut > 0 ? 'caller' : `quote minus ${guard.max_slippage_pct}% slippage`,
    deep_amount,
  };

  if (dry_run) {
    const simulation = await simulateTransaction(tx, state);
    const summary = `Dry run, nothing was sent: ${trade}; ${describeSimulation(simulation)}.`;
    return { content: [{ type: 'text', text: JSON.stringify({ summary, dry_run: true, ...swap, simulation }, null, 2) }] };
  }

  const result = await executeTransaction(tx, state);
  const fee = result.gas_fee_sui !== null ? ` Network fee ${Number(result.gas_fee_sui.toPrecision(3))} SUI.` : '';
  const summary = `Swap sent: ${trade}. Digest ${result.tx_digest}.${fee}`;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ summary, success: true, tx_digest: result.tx_digest, gas_fee_sui: result.gas_fee_sui, ...swap, dry_run: false }, null, 2),
    }],
  };
}

/**
 * swap: name the coin to sell and the coin to buy; the pool and direction are worked out here,
 * so the model cannot pick the base/quote direction backwards.
 */
async function swapByCoinHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const coinKey = (name: string) => {
      const v = args[name];
      if (typeof v !== 'string' || v.trim() === '') throw new Error(`${name} is required, e.g. SUI or USDC.`);
      return v.trim().toUpperCase();
    };
    const sell = coinKey('sell_coin');
    const buy = coinKey('buy_coin');
    if (sell === buy) throw new Error('sell_coin and buy_coin must be different.');

    const matches = (pool: string) => {
      const { base, quote } = poolCoins(pool);
      return (base === sell && quote === buy) || (base === buy && quote === sell);
    };
    let pool: string;
    if (args.pool !== undefined && args.pool !== null && args.pool !== '') {
      pool = requireAllowedPool(args.pool);
      if (!matches(pool)) {
        const { base, quote } = poolCoins(pool);
        throw new Error(`Pool ${pool} trades ${base}/${quote}, not ${sell}/${buy}.`);
      }
    } else {
      const found = config.allowedPools.find((p) => {
        try { return matches(p); } catch { return false; }
      });
      if (!found) {
        throw new Error(`No allowed pool trades ${sell} and ${buy}. Allowed pools: ${config.allowedPools.join(', ')}.`);
      }
      pool = found;
    }

    const direction: Direction = poolCoins(pool).base === sell ? 'base_for_quote' : 'quote_for_base';
    const mapped: Record<string, unknown> = {
      pool,
      [direction === 'base_for_quote' ? 'base_amount' : 'quote_amount']: args.amount,
      [direction === 'base_for_quote' ? 'min_quote_out' : 'min_base_out']: args.min_out,
      deep_amount: args.deep_amount,
      dry_run: args.dry_run,
    };
    return await runSwap(mapped, state, direction);
  } catch (err) {
    throw new Error(`swap failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 1: swap_base_for_quote handler
async function swapBaseForQuoteHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    return await runSwap(args, state, 'base_for_quote');
  } catch (err) {
    throw new Error(`swap_base_for_quote failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 2: swap_quote_for_base handler
async function swapQuoteForBaseHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    return await runSwap(args, state, 'quote_for_base');
  } catch (err) {
    throw new Error(`swap_quote_for_base failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const DRY_RUN_PROPERTY = {
  type: 'boolean',
  description: 'If true, simulate the swap and return the expected balance changes without sending it. Use this to show the user what will happen before they confirm.',
  default: false,
};

// Tool definitions
export const swapTools = [
  {
    name: 'swap',
    description: 'Swap one coin for another on DeepBook using wallet coins. Name the coin to SELL and the coin to BUY; the pool and direction are chosen automatically from ALLOWED_POOLS. Use this rather than swap_base_for_quote / swap_quote_for_base. Example: "swap 2 USDSUI for SUI" -> sell_coin USDSUI, buy_coin SUI, amount 2. Without min_out, the minimum is a live quote minus MAX_SLIPPAGE_PCT (default 1%). Set dry_run=true to preview, and show the user the returned summary.',
    inputSchema: {
      type: 'object',
      properties: {
        sell_coin: { type: 'string', description: 'Coin to sell (spend), e.g. USDSUI, SUI, USDC, DEEP' },
        buy_coin: { type: 'string', description: 'Coin to buy (receive), e.g. SUI' },
        amount: { type: 'number', description: 'Amount of sell_coin to spend, in whole coins' },
        min_out: { type: 'number', description: 'Minimum amount of buy_coin to accept. Omit to use a live quote minus MAX_SLIPPAGE_PCT.' },
        pool: { type: 'string', description: 'Optional pool key; normally omitted and found automatically' },
        deep_amount: { type: 'number', description: 'Amount of DEEP to use for fees. Default 0.', default: 0 },
        dry_run: DRY_RUN_PROPERTY,
      },
      required: ['sell_coin', 'buy_coin', 'amount'],
    },
  },
  {
    name: 'swap_base_for_quote',
    description: 'SELLS the pool\'s base coin (first in the pool name) for its quote coin (second), e.g. on SUI_USDSUI this sells SUI and buys USDSUI. Prefer the swap tool, which takes sell_coin/buy_coin. Pool must be in ALLOWED_POOLS. Uses wallet coins directly. DEEP fees are taken from the deepAmount parameter. Without min_quote_out, the minimum is set from a live quote minus MAX_SLIPPAGE_PCT (default 1%). Set dry_run=true to preview it first.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        base_amount: {
          type: 'number',
          description: 'Exact amount of base asset to swap',
        },
        min_quote_out: {
          type: 'number',
          description: 'Minimum quote asset to receive. Omit to use a live quote minus MAX_SLIPPAGE_PCT.',
        },
        deep_amount: {
          type: 'number',
          description: 'Amount of DEEP tokens to use for fees. Default 0.',
          default: 0,
        },
        dry_run: DRY_RUN_PROPERTY,
      },
      required: ['pool', 'base_amount'],
    },
  },
  {
    name: 'swap_quote_for_base',
    description: 'SELLS the pool\'s quote coin (second in the pool name) for its base coin (first), e.g. on SUI_USDSUI this sells USDSUI and buys SUI. Prefer the swap tool, which takes sell_coin/buy_coin. Pool must be in ALLOWED_POOLS. Uses wallet coins directly. DEEP fees are taken from the deepAmount parameter. Without min_base_out, the minimum is set from a live quote minus MAX_SLIPPAGE_PCT (default 1%). Set dry_run=true to preview it first.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        quote_amount: {
          type: 'number',
          description: 'Exact amount of quote asset to swap',
        },
        min_base_out: {
          type: 'number',
          description: 'Minimum base asset to receive. Omit to use a live quote minus MAX_SLIPPAGE_PCT.',
        },
        deep_amount: {
          type: 'number',
          description: 'Amount of DEEP tokens to use for fees. Default 0.',
          default: 0,
        },
        dry_run: DRY_RUN_PROPERTY,
      },
      required: ['pool', 'quote_amount'],
    },
  },
];

// Handler mapping
export const swapHandlers: Record<string, SwapHandler> = {
  swap: swapByCoinHandler,
  swap_base_for_quote: swapBaseForQuoteHandler,
  swap_quote_for_base: swapQuoteForBaseHandler,
};
