/**
 * DeepBook swap tools.
 * Execute immediate token swaps using wallet coins directly.
 */

import { Transaction } from '@mysten/sui/transactions';
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

  const swap = {
    pool,
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
    return { content: [{ type: 'text', text: JSON.stringify({ dry_run: true, ...swap, simulation }, null, 2) }] };
  }

  const result = await executeTransaction(tx, state);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, tx_digest: result.tx_digest, ...swap, dry_run: false }, null, 2),
    }],
  };
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
    name: 'swap_base_for_quote',
    description: 'Swap exact base asset for quote asset on a DeepBook pool (pool must be in ALLOWED_POOLS). Uses wallet coins directly. DEEP fees are taken from the deepAmount parameter. Without min_quote_out, the minimum is set from a live quote minus MAX_SLIPPAGE_PCT (default 1%). Set dry_run=true to preview it first.',
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
    description: 'Swap exact quote asset for base asset on a DeepBook pool (pool must be in ALLOWED_POOLS). Uses wallet coins directly. DEEP fees are taken from the deepAmount parameter. Without min_base_out, the minimum is set from a live quote minus MAX_SLIPPAGE_PCT (default 1%). Set dry_run=true to preview it first.',
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
  swap_base_for_quote: swapBaseForQuoteHandler,
  swap_quote_for_base: swapQuoteForBaseHandler,
};
