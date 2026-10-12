import { Transaction } from '@mysten/sui/transactions';
import { executeTransaction } from '../utils/tx-executor.js';
import { config } from '../config.js';
import { requirePositiveNumber, requireBoolean, optionalBoolean, requireOneOf, requireOrderId } from '../utils/validate.js';
import type { AppState } from '../client.js';

// Handler signature
export type ConditionalOrderHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

// Margin manager key per SDK configuration
const MARGIN_KEY = 'MARGIN_1';

function requireMarginManager(toolName: string): void {
  if (!config.marginManagerAddress) {
    throw new Error(`${toolName} requires MARGIN_MANAGER_ADDRESS to be configured.`);
  }
}

function requireSigningKey(state: AppState, toolName: string): void {
  if (!state.keypair) {
    throw new Error(`${toolName} requires signing mode (SUI_PRIVATE_KEY configured).`);
  }
}

// Tool 1: add_conditional_order handler
async function addConditionalOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('add_conditional_order');
    requireSigningKey(state, 'add_conditional_order');

    // Extract and validate required parameters
    const trigger_price = requirePositiveNumber('trigger_price', args.trigger_price);
    const trigger_below = requireBoolean('trigger_below', args.trigger_below);
    const order_type = requireOneOf('order_type', args.order_type, ['limit', 'market'] as const);
    const quantity = requirePositiveNumber('quantity', args.quantity);
    const is_bid = requireBoolean('is_bid', args.is_bid);

    // Extract optional parameters with defaults
    const pay_with_deep = optionalBoolean('pay_with_deep', args.pay_with_deep, true);

    // Validate price for limit orders
    if (order_type === 'limit' && (args.price === undefined || args.price === null)) {
      throw new Error('price is required for limit orders');
    }
    const price = order_type === 'limit' ? requirePositiveNumber('price', args.price) : undefined;

    // Generate IDs
    const conditionalOrderId = Date.now();
    const clientOrderId = Date.now();

    // Build pendingOrder based on order_type
    let pendingOrder: any;
    if (order_type === 'limit') {
      pendingOrder = {
        clientOrderId,
        price: price!,
        quantity,
        isBid: is_bid,
        payWithDeep: pay_with_deep,
      };
    } else {
      // market order
      pendingOrder = {
        clientOrderId,
        quantity,
        isBid: is_bid,
        payWithDeep: pay_with_deep,
      };
    }

    // Build transaction
    const tx = new Transaction();
    const marginTSPSL = (state.client.deepbook as any).marginTPSL;
    marginTSPSL.addConditionalOrder({
      marginManagerKey: MARGIN_KEY,
      conditionalOrderId,
      triggerBelowPrice: trigger_below,
      triggerPrice: trigger_price,
      pendingOrder,
    })(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      conditional_order_id: conditionalOrderId,
      trigger_price,
      trigger_below,
      order_type,
      quantity,
      is_bid,
      price: order_type === 'limit' ? price : undefined,
      pay_with_deep,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2),
      }],
    };
  } catch (err) {
    throw new Error(`add_conditional_order failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 2: cancel_conditional_order handler
async function cancelConditionalOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('cancel_conditional_order');
    requireSigningKey(state, 'cancel_conditional_order');

    // Extract parameters
    const conditional_order_id = requireOrderId('conditional_order_id', args.conditional_order_id);

    // Build transaction
    const tx = new Transaction();
    const marginTSPSL = (state.client.deepbook as any).marginTPSL;
    marginTSPSL.cancelConditionalOrder(MARGIN_KEY, conditional_order_id)(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
      conditional_order_id,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2),
      }],
    };
  } catch (err) {
    throw new Error(`cancel_conditional_order failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 3: cancel_all_conditional_orders handler
async function cancelAllConditionalOrdersHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('cancel_all_conditional_orders');
    requireSigningKey(state, 'cancel_all_conditional_orders');

    // Build transaction
    const tx = new Transaction();
    const marginTSPSL = (state.client.deepbook as any).marginTPSL;
    marginTSPSL.cancelAllConditionalOrders(MARGIN_KEY)(tx);

    // Execute transaction
    const result = await executeTransaction(tx, state);

    // Return success response
    const response = {
      success: true,
      tx_digest: result.tx_digest,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2),
      }],
    };
  } catch (err) {
    throw new Error(`cancel_all_conditional_orders failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool definitions
export const conditionalOrderTools = [
  {
    name: 'add_conditional_order',
    description: 'Adds a take profit or stop loss conditional order to the MarginManager.',
    inputSchema: {
      type: 'object',
      properties: {
        trigger_price: {
          type: 'number',
          description: 'Price level that triggers the order (human-readable)',
        },
        trigger_below: {
          type: 'boolean',
          description: 'true = stop loss (trigger when price falls below), false = take profit (trigger when price rises above)',
        },
        order_type: {
          type: 'string',
          description: 'Type of order to execute when triggered — limit or market',
          enum: ['limit', 'market'],
        },
        quantity: {
          type: 'number',
          description: 'Order quantity in human-readable units',
        },
        is_bid: {
          type: 'boolean',
          description: 'true = buy order, false = sell order',
        },
        price: {
          type: 'number',
          description: 'Limit price (required if order_type is limit)',
        },
        pay_with_deep: {
          type: 'boolean',
          description: 'Whether to pay fees with DEEP tokens (default: true)',
          default: true,
        },
      },
      required: ['trigger_price', 'trigger_below', 'order_type', 'quantity', 'is_bid'],
    },
  },
  {
    name: 'cancel_conditional_order',
    description: 'Cancels a specific conditional order by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        conditional_order_id: {
          type: 'number',
          description: 'The ID returned when the conditional order was created',
        },
      },
      required: ['conditional_order_id'],
    },
  },
  {
    name: 'cancel_all_conditional_orders',
    description: 'Cancels all conditional orders on the MarginManager.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Handler mapping
export const conditionalOrderHandlers: Record<string, ConditionalOrderHandler> = {
  add_conditional_order: addConditionalOrderHandler,
  cancel_conditional_order: cancelConditionalOrderHandler,
  cancel_all_conditional_orders: cancelAllConditionalOrdersHandler,
};