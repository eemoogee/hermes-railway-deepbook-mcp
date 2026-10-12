/**
 * DeepBook order placement tools.
 * Place limit and market orders on Sui mainnet.
 */

import { Transaction } from '@mysten/sui/transactions';
import { OrderType } from '@mysten/deepbook-v3';
import { executeTransaction, simulateTransaction } from '../utils/tx-executor.js';
import { config } from '../config.js';
import {
  requireAllowedPool, requirePositiveNumber, requireBoolean, optionalBoolean,
  requireOneOf, requireOrderId, maxSlippagePct,
} from '../utils/validate.js';
import { checkMarketOrderSlippage } from '../utils/slippage.js';
import type { AppState } from '../client.js';

// Handler signature
export type OrderHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

// Manager key is always 'MANAGER_1' per SDK configuration
const MANAGER_KEY = 'MANAGER_1';

// Order type mapping
const ORDER_TYPE_MAP: Record<string, OrderType> = {
  NO_RESTRICTION: OrderType.NO_RESTRICTION,
  IMMEDIATE_OR_CANCEL: OrderType.IMMEDIATE_OR_CANCEL,
  FILL_OR_KILL: OrderType.FILL_OR_KILL,
  POST_ONLY: OrderType.POST_ONLY,
};

/**
 * Shared prerequisite checks for all order tools
 */
async function performPrerequisiteChecks(state: AppState): Promise<void> {
  if (!config.balanceManagerAddress) {
    throw new Error('Account tools require BALANCE_MANAGER_ADDRESS to be configured.');
  }
  if (!state.keypair) {
    throw new Error('Cannot place order: MCP server is in read-only mode.');
  }
}


// Tool 1: place_limit_order handler
async function placeLimitOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Prerequisite checks
    await performPrerequisiteChecks(state);

    // Extract and validate required parameters
    const pool = requireAllowedPool(args.pool);
    const price = requirePositiveNumber('price', args.price);
    const quantity = requirePositiveNumber('quantity', args.quantity);
    const is_bid = requireBoolean('is_bid', args.is_bid);
    const client_order_id = Date.now();

    // Extract optional parameters with defaults
    const order_type = args.order_type === undefined || args.order_type === null
      ? 'NO_RESTRICTION'
      : requireOneOf('order_type', args.order_type, Object.keys(ORDER_TYPE_MAP));
    const pay_with_deep = optionalBoolean('pay_with_deep', args.pay_with_deep, true);
    const dry_run = optionalBoolean('dry_run', args.dry_run, false);

    
    // Build transaction
    const tx = new Transaction();
    // SDK returns (tx) => void — call it directly on the tx builder
    const dbContract = state.client.deepbook.deepBook as any;
    dbContract.placeLimitOrder({
      poolKey: pool,
      balanceManagerKey: MANAGER_KEY,
      clientOrderId: client_order_id,
      price,
      quantity,
      isBid: is_bid,
      orderType: ORDER_TYPE_MAP[order_type],
      payWithDeep: pay_with_deep,
    })(tx);

    const order = { pool, side: is_bid ? 'buy' : 'sell', price, quantity, is_bid, order_type, client_order_id, pay_with_deep };
    if (dry_run) {
      const simulation = await simulateTransaction(tx, state);
      return { content: [{ type: 'text', text: JSON.stringify({ dry_run: true, ...order, simulation }, null, 2) }] };
    }

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      ...order,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`place_limit_order failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 2: place_market_order handler
async function placeMarketOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Prerequisite checks
    await performPrerequisiteChecks(state);

    // Extract and validate required parameters
    const pool = requireAllowedPool(args.pool);
    const quantity = requirePositiveNumber('quantity', args.quantity);
    const is_bid = requireBoolean('is_bid', args.is_bid);

    // Extract optional parameters with defaults
    const pay_with_deep = optionalBoolean('pay_with_deep', args.pay_with_deep, true);
    const dry_run = optionalBoolean('dry_run', args.dry_run, false);

    // Market orders fill at any price: refuse if the book would fill more than MAX_SLIPPAGE_PCT from mid
    const price_check = await checkMarketOrderSlippage(state, pool, is_bid, quantity, maxSlippagePct());

    
    // Generate client order ID
    const clientOrderId = Date.now();

    // Build transaction
    const tx = new Transaction();
    // SDK returns (tx) => void — call it directly on the tx builder
    const dbContract = state.client.deepbook.deepBook as any;
    dbContract.placeMarketOrder({
      poolKey: pool,
      balanceManagerKey: MANAGER_KEY,
      clientOrderId,
      quantity,
      isBid: is_bid,
      payWithDeep: pay_with_deep,
    })(tx);

    const order = { pool, side: is_bid ? 'buy' : 'sell', quantity, is_bid, pay_with_deep, price_check };
    if (dry_run) {
      const simulation = await simulateTransaction(tx, state);
      return { content: [{ type: 'text', text: JSON.stringify({ dry_run: true, ...order, simulation }, null, 2) }] };
    }

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      ...order,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`place_market_order failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 3: cancel_order handler
async function cancelOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Prerequisite checks
    await performPrerequisiteChecks(state);

    // Extract parameters
    const pool = requireAllowedPool(args.pool);
    const order_id = requireOrderId('order_id', args.order_id);

    // Build transaction
    const tx = new Transaction();
    // SDK returns (tx) => void — call it directly on the tx builder
    const dbContract = state.client.deepbook.deepBook as any;
    dbContract.cancelOrder(pool, MANAGER_KEY, order_id)(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      pool,
      order_id,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`cancel_order failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 4: cancel_all_orders handler
async function cancelAllOrdersHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Prerequisite checks
    await performPrerequisiteChecks(state);

    // Extract parameters
    const pool = requireAllowedPool(args.pool);

    // Build transaction
    const tx = new Transaction();
    // SDK returns (tx) => void — call it directly on the tx builder
    const dbContract = state.client.deepbook.deepBook as any;
    dbContract.cancelAllOrders(pool, MANAGER_KEY)(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      pool,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`cancel_all_orders failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 5: modify_order handler
async function modifyOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Prerequisite checks
    await performPrerequisiteChecks(state);

    // Extract parameters
    const pool = requireAllowedPool(args.pool);
    const order_id = requireOrderId('order_id', args.order_id);
    const new_quantity = requirePositiveNumber('new_quantity', args.new_quantity);

    // Build transaction
    const tx = new Transaction();
    // SDK takes positional args and returns (tx) => void
    const dbContract = state.client.deepbook.deepBook as any;
    dbContract.modifyOrder(pool, MANAGER_KEY, order_id, new_quantity)(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      pool,
      order_id,
      new_quantity,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`modify_order failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 6: withdraw_settled_amounts handler
async function withdrawSettledAmountsHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Prerequisite checks
    await performPrerequisiteChecks(state);

    // Extract parameters
    const pool = requireAllowedPool(args.pool);

    // Build transaction
    const tx = new Transaction();
    // SDK takes positional args and returns (tx) => void
    const dbContract = state.client.deepbook.deepBook as any;
    dbContract.withdrawSettledAmounts(pool, MANAGER_KEY)(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      pool,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`withdraw_settled_amounts failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 7: deposit handler
async function depositHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    await performPrerequisiteChecks(state);

    const coinKey = requireOneOf('coin_key', args.coin_key, ['SUI', 'USDC', 'DEEP'] as const);
    const amount = requirePositiveNumber('amount', args.amount);

    const tx = new Transaction();
    const balanceManager = state.client.deepbook.balanceManager as any;
    balanceManager.depositIntoManager(MANAGER_KEY, coinKey, amount)(tx);

    const result = await executeTransaction(tx, state);

    const response = {
      success: true,
      tx_digest: result.tx_digest,
      coin_key: coinKey,
      amount,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`deposit failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 8: deposit_all handler
async function depositAllHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    await performPrerequisiteChecks(state);

    const { client, keypair } = state;

    const coinKey = requireOneOf('coin_key', args.coin_key, ['SUI', 'USDC', 'DEEP'] as const);

    const COIN_TYPES: Record<string, string> = {
      SUI: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
      USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    };

    const address = keypair!.toSuiAddress();
    const suiClient = client as any;
    const balanceResp = await suiClient.getBalance({
      owner: address,
      coinType: COIN_TYPES[coinKey],
    });
    const rawBalance = balanceResp?.balance?.balance ?? '0';
    const balanceNum = parseFloat(rawBalance);

    let amountToDeposit: number;
    if (coinKey === 'SUI') {
      const gasReserve = 500_000_000;
      amountToDeposit = Math.max(0, Math.floor((balanceNum - gasReserve) / 1_000_000_000));
    } else {
      amountToDeposit = Math.floor(balanceNum / 1_000_000);
    }

    if (amountToDeposit <= 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            coin_key: coinKey,
            available_raw: rawBalance,
            message: 'No available balance to deposit after gas reserve.',
          }, null, 2)
        }]
      };
    }

    const tx = new Transaction();
    const balanceManager = state.client.deepbook.balanceManager as any;
    balanceManager.depositIntoManager(MANAGER_KEY, coinKey, amountToDeposit)(tx);

    const result = await executeTransaction(tx, state);

    const response = {
      success: true,
      tx_digest: result.tx_digest,
      coin_key: coinKey,
      amount: amountToDeposit,
      dry_run: false,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (err) {
    throw new Error(`deposit_all failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool definitions
export const orderTools = [
  {
    name: 'place_limit_order',
    description: 'Place a GTC limit order on a DeepBook pool (pool must be in ALLOWED_POOLS). Set dry_run=true to preview it first.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        price: {
          type: 'number',
          description: 'Limit price for the order',
        },
        quantity: {
          type: 'number',
          description: 'Order quantity in base asset units',
        },
        is_bid: {
          type: 'boolean',
          description: 'true for bid (buy), false for ask (sell)',
        },
        order_type: {
          type: 'string',
          description: 'Order type: NO_RESTRICTION, IMMEDIATE_OR_CANCEL, FILL_OR_KILL, POST_ONLY',
          enum: ['NO_RESTRICTION', 'IMMEDIATE_OR_CANCEL', 'FILL_OR_KILL', 'POST_ONLY'],
          default: 'NO_RESTRICTION',
        },
        pay_with_deep: {
          type: 'boolean',
          description: 'Pay taker fees with DEEP tokens (true) or base/quote assets (false)',
          default: true,
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, simulate the order and return the expected balance changes without sending it. Use this to show the user what will happen before they confirm.',
          default: false,
        },
      },
      required: ['pool', 'price', 'quantity', 'is_bid'],
    },
  },
  {
    name: 'place_market_order',
    description: 'Place a market order on a DeepBook pool (pool must be in ALLOWED_POOLS). Taker fees apply. Refused if the order book would fill it more than MAX_SLIPPAGE_PCT (default 1%) worse than the mid price; the expected average price is returned as price_check. Set dry_run=true to preview it first.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        quantity: {
          type: 'number',
          description: 'Order quantity in base asset units',
        },
        is_bid: {
          type: 'boolean',
          description: 'true for bid (buy), false for ask (sell)',
        },
        pay_with_deep: {
          type: 'boolean',
          description: 'Pay taker fees with DEEP tokens (true) or base/quote assets (false)',
          default: true,
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, simulate the order and return the expected balance changes without sending it. Use this to show the user what will happen before they confirm.',
          default: false,
        },
      },
      required: ['pool', 'quantity', 'is_bid'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel a single open order on a DeepBook pool.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        order_id: {
          type: 'string',
          description: 'Protocol order ID to cancel, as a string exactly as returned by get_open_orders (IDs are too large for a number)',
        },
      },
      required: ['pool', 'order_id'],
    },
  },
  {
    name: 'cancel_all_orders',
    description: 'Cancel all open orders in a DeepBook pool.',
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
    name: 'modify_order',
    description: 'Reduce the quantity of an open limit order. Cannot increase quantity — only reductions are permitted by the protocol.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        order_id: {
          type: 'string',
          description: 'Protocol order ID to modify, as a string exactly as returned by get_open_orders (IDs are too large for a number)',
        },
        new_quantity: {
          type: 'number',
          description: 'New quantity — must be less than the current order quantity',
        },
      },
      required: ['pool', 'order_id', 'new_quantity'],
    },
  },
  {
    name: 'withdraw_settled_amounts',
    description: 'Claim any settled base, quote, or DEEP amounts from a DeepBook pool back into the BalanceManager.',
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
    name: 'deposit',
    description: 'Deposit SUI, USDC, or DEEP from the wallet into the BalanceManager so it can be used for trading.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_key: {
          type: 'string',
          description: 'Coin key to deposit — one of SUI, USDC, DEEP',
          enum: ['SUI', 'USDC', 'DEEP'],
        },
        amount: {
          type: 'number',
          description: 'Amount to deposit in whole coin units',
        },
      },
      required: ['coin_key', 'amount'],
    },
  },
  {
    name: 'deposit_all',
    description: 'Deposit the entire available wallet balance of a coin into the BalanceManager (keeps 0.5 SUI for gas).',
    inputSchema: {
      type: 'object',
      properties: {
        coin_key: {
          type: 'string',
          description: 'Coin key to deposit — one of SUI, USDC, DEEP',
          enum: ['SUI', 'USDC', 'DEEP'],
        },
      },
      required: ['coin_key'],
    },
  },
];

// Handler mapping
export const orderHandlers: Record<string, OrderHandler> = {
  place_limit_order: placeLimitOrderHandler,
  place_market_order: placeMarketOrderHandler,
  cancel_order: cancelOrderHandler,
  cancel_all_orders: cancelAllOrdersHandler,
  modify_order: modifyOrderHandler,
  withdraw_settled_amounts: withdrawSettledAmountsHandler,
  deposit: depositHandler,
  deposit_all: depositAllHandler,
};