/**
 * Price protection for swaps and market orders, based on DeepBook's own quote queries.
 */

import type { AppState } from '../client.js';

/** A fill this close to complete counts as complete (float dust from the quote maths). */
const FILL_EPSILON = 1e-9;

export interface SwapGuard {
  expected_out: number;
  min_out: number;
  max_slippage_pct: number;
}

/**
 * Expected output of a swap and the minimum to accept: expected * (1 - slippage).
 * Throws if the book cannot absorb the whole input.
 */
export async function swapMinOut(
  state: AppState,
  pool: string,
  direction: 'base_for_quote' | 'quote_for_base',
  amountIn: number,
  maxSlippagePct: number,
): Promise<SwapGuard> {
  const deepbook = state.client.deepbook;
  let expected: number;
  let unfilled: number;
  if (direction === 'base_for_quote') {
    const q = await deepbook.getQuoteQuantityOut(pool, amountIn);
    expected = q.quoteOut;
    unfilled = q.baseOut;
  } else {
    const q = await deepbook.getBaseQuantityOut(pool, amountIn);
    expected = q.baseOut;
    unfilled = q.quoteOut;
  }
  if (!(expected > 0)) {
    throw new Error(`No liquidity: a swap of ${amountIn} on ${pool} would return nothing.`);
  }
  if (unfilled > FILL_EPSILON * Math.max(1, amountIn)) {
    throw new Error(`Not enough liquidity on ${pool}: ${unfilled} of the ${amountIn} input would not be swapped.`);
  }
  return {
    expected_out: expected,
    min_out: expected * (1 - maxSlippagePct / 100),
    max_slippage_pct: maxSlippagePct,
  };
}

export interface MarketOrderGuard {
  mid_price: number;
  expected_avg_price: number;
  slippage_pct: number;
  max_slippage_pct: number;
}

/**
 * Estimate the average fill price of a market order for `quantity` base units and
 * throw if it is more than maxSlippagePct worse than the mid price (or the book is too thin).
 */
export async function checkMarketOrderSlippage(
  state: AppState,
  pool: string,
  isBid: boolean,
  quantity: number,
  maxSlippagePct: number,
): Promise<MarketOrderGuard> {
  const deepbook = state.client.deepbook;
  const mid = await deepbook.midPrice(pool);
  if (!(mid > 0)) {
    throw new Error(`Cannot price a market order on ${pool}: no mid price.`);
  }

  let avg: number;
  if (isBid) {
    // Budget the quote needed at the worst accepted price; if that buys less than `quantity`, the fill is too expensive
    const budget = quantity * mid * (1 + maxSlippagePct / 100);
    const q = await deepbook.getBaseQuantityOut(pool, budget);
    if (q.baseOut + FILL_EPSILON < quantity) {
      throw new Error(
        `Market buy of ${quantity} on ${pool} would cost more than ${maxSlippagePct}% above the mid price ${mid} ` +
        `(only ${q.baseOut} fillable within that budget). Use a smaller size or a limit order.`,
      );
    }
    avg = (budget - q.quoteOut) / q.baseOut;
  } else {
    const q = await deepbook.getQuoteQuantityOut(pool, quantity);
    const filled = quantity - q.baseOut;
    if (filled + FILL_EPSILON < quantity || !(q.quoteOut > 0)) {
      throw new Error(`Not enough liquidity on ${pool} to sell ${quantity} (only ${filled} fillable).`);
    }
    avg = q.quoteOut / filled;
  }

  const slippage = isBid ? (avg - mid) / mid * 100 : (mid - avg) / mid * 100;
  if (slippage > maxSlippagePct) {
    throw new Error(
      `Market ${isBid ? 'buy' : 'sell'} of ${quantity} on ${pool} would fill around ${avg}, ` +
      `${slippage.toFixed(2)}% worse than the mid price ${mid} (limit ${maxSlippagePct}%). Use a smaller size or a limit order.`,
    );
  }
  return {
    mid_price: mid,
    expected_avg_price: avg,
    slippage_pct: Number(slippage.toFixed(4)),
    max_slippage_pct: maxSlippagePct,
  };
}
