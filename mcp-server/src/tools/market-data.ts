/**
 * DeepBook market data MCP tools.
 * 8 read-only tools for querying pool data.
 */

import { config, isPoolAllowed } from '../config.js';
import type { AppState } from '../client.js';

// Common handler signature for all tools
export type MarketDataHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

/**
 * Validate pool key is in allowed list
 */
function validatePool(pool: string): void {
  if (!isPoolAllowed(pool)) {
    throw new Error(`Pool '${pool}' is not in the allowed pools list. Allowed: ${config.allowedPools.join(', ')}`);
  }
}

// Tool 1: get_mid_price
async function getMidPriceHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    validatePool(pool);

    const midPrice = await client.deepbook.midPrice(pool);

    const result = {
      pool,
      mid_price: midPrice,
      timestamp: new Date().toISOString(),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_mid_price failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 2: get_orderbook_depth
async function getOrderbookDepthHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    const ticks = (args.ticks as number) || 10;

    validatePool(pool);

    const level2Data = await client.deepbook.getLevel2TicksFromMid(pool, ticks);

    // Zip bid prices with quantities
    const bids = level2Data.bid_prices.map((price: number, index: number) => ({
      price,
      quantity: level2Data.bid_quantities[index],
    }));

    // Zip ask prices with quantities
    const asks = level2Data.ask_prices.map((price: number, index: number) => ({
      price,
      quantity: level2Data.ask_quantities[index],
    }));

    const result = {
      pool,
      bids,
      asks,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_orderbook_depth failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 3: get_quote_for_base
async function getQuoteForBaseHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    const baseQuantity = args.base_quantity as number;

    validatePool(pool);

    const quoteData = await client.deepbook.getQuoteQuantityOut(pool, baseQuantity);

    const result = {
      pool,
      base_quantity: quoteData.baseQuantity,
      quote_out: quoteData.quoteOut,
      deep_required: quoteData.deepRequired,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_quote_for_base failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 4: get_base_for_quote
async function getBaseForQuoteHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    const quoteQuantity = args.quote_quantity as number;

    validatePool(pool);

    const baseData = await client.deepbook.getBaseQuantityOut(pool, quoteQuantity);

    const result = {
      pool,
      quote_quantity: baseData.quoteQuantity,
      base_out: baseData.baseOut,
      deep_required: baseData.deepRequired,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_base_for_quote failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 5: get_pool_trade_params
async function getPoolTradeParamsHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    validatePool(pool);

    const tradeParams = await client.deepbook.poolTradeParams(pool);

    const result = {
      pool,
      taker_fee: tradeParams.takerFee,
      maker_fee: tradeParams.makerFee,
      stake_required: tradeParams.stakeRequired,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_pool_trade_params failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 6: get_pool_book_params
async function getPoolBookParamsHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    validatePool(pool);

    const bookParams = await client.deepbook.poolBookParams(pool);

    const bookParamsAny = bookParams as any;
    const result = {
      pool,
      tick_size: bookParamsAny.tickSize,
      lot_size: bookParamsAny.lotSize,
      min_size: bookParamsAny.minSize,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_pool_book_params failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 7: get_pool_deep_price
async function getPoolDeepPriceHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client } = state;
    const pool = args.pool as string;
    validatePool(pool);

    const deepPrice = await client.deepbook.getPoolDeepPrice(pool);

    const deepPriceAny = deepPrice as any;
    const deepPerAsset: number = deepPriceAny.deep_per_base !== undefined
      ? deepPriceAny.deep_per_base
      : deepPriceAny.deep_per_quote;

    // Pool keys are BASE_QUOTE, so name the asset the rate is measured against
    const [baseCoin, quoteCoin] = pool.split('_');
    const asset = deepPriceAny.asset_is_base ? baseCoin : quoteCoin;
    const assetPerDeep = deepPerAsset > 0 ? 1 / deepPerAsset : null;
    const fmt = (n: number) => Number(n.toPrecision(6));

    // Spell out both directions so the rate can't be read upside down
    const result = {
      pool,
      asset,
      asset_is_base: deepPriceAny.asset_is_base,
      deep_per_asset: deepPerAsset,
      asset_per_deep: assetPerDeep === null ? null : fmt(assetPerDeep),
      summary: assetPerDeep === null
        ? `DEEP conversion rate unavailable for ${pool}`
        : `1 ${asset} = ${fmt(deepPerAsset)} DEEP; 1 DEEP = ${fmt(assetPerDeep)} ${asset}`,
      note: 'Pool DEEP conversion rate used to calculate trading fees paid in DEEP, not a live DEEP market price.',
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_pool_deep_price failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 8: list_supported_pools
async function listSupportedPoolsHandler(
  _args: Record<string, unknown>,
  _state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const result = {
      pools: config.allowedPools.map(key => ({ key })),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`list_supported_pools failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool definitions array
export const marketDataTools = [
  {
    name: 'get_mid_price',
    description: 'Get the current mid price for a DeepBook pool.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
      },
      required: ['pool'],
    },
  },
  {
    name: 'get_orderbook_depth',
    description: 'Get level 2 order book depth around the mid price.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        ticks: {
          type: 'number',
          description: 'Number of price levels to return on each side',
          default: 10,
        },
      },
      required: ['pool'],
    },
  },
  {
    name: 'get_quote_for_base',
    description: 'Dry-run: get the quote quantity out for a given base quantity.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        base_quantity: {
          type: 'number',
          description: 'Base quantity to quote for',
        },
      },
      required: ['pool', 'base_quantity'],
    },
  },
  {
    name: 'get_base_for_quote',
    description: 'Dry-run: get the base quantity out for a given quote quantity.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        quote_quantity: {
          type: 'number',
          description: 'Quote quantity to base for',
        },
      },
      required: ['pool', 'quote_quantity'],
    },
  },
  {
    name: 'get_pool_trade_params',
    description: 'Get taker fee, maker fee, and stake required for a pool.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
      },
      required: ['pool'],
    },
  },
  {
    name: 'get_pool_book_params',
    description: 'Get tick size, lot size, and minimum order size for a pool.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
      },
      required: ['pool'],
    },
  },
  {
    name: 'get_pool_deep_price',
    description: 'Get the pool\'s DEEP conversion rate (used for fees paid in DEEP). Returns both directions: deep_per_asset (DEEP per 1 unit of asset) and asset_per_deep (asset per 1 DEEP), plus a plain-language summary. Not a live DEEP market price.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
      },
      required: ['pool'],
    },
  },
  {
    name: 'list_supported_pools',
    description: 'List all pools available through this MCP server.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Handler mapping
export const marketDataHandlers: Record<string, MarketDataHandler> = {
  get_mid_price: getMidPriceHandler,
  get_orderbook_depth: getOrderbookDepthHandler,
  get_quote_for_base: getQuoteForBaseHandler,
  get_base_for_quote: getBaseForQuoteHandler,
  get_pool_trade_params: getPoolTradeParamsHandler,
  get_pool_book_params: getPoolBookParamsHandler,
  get_pool_deep_price: getPoolDeepPriceHandler,
  list_supported_pools: listSupportedPoolsHandler,
};