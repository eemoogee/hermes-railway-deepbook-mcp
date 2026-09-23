import { Transaction } from '@mysten/sui/transactions';
import { executeTransaction } from '../utils/tx-executor.js';
import { config } from '../config.js';
import type { AppState } from '../client.js';

// Common handler signature for all margin account tools
export type MarginAccountHandler = (
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

// Tool 1: deposit_margin
async function depositMarginHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('deposit_margin');
    if (!state.keypair) {
      throw new Error('deposit_margin requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const coin_type = args.coin_type as string;
    const amount = args.amount as number;
    const mm = (state.client.deepbook as any).marginManager;

    if (coin_type !== 'SUI' && coin_type !== 'USDC') {
      throw new Error(`Invalid coin_type: '${coin_type}'. Must be SUI or USDC.`);
    }

    const tx = new Transaction();
    if (coin_type === 'SUI') {
      tx.add(mm.depositBase({ managerKey: MARGIN_KEY, amount }));
    } else {
      tx.add(mm.depositQuote({ managerKey: MARGIN_KEY, amount }));
    }

    const result = await executeTransaction(tx, state);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, tx_digest: result.tx_digest, coin_type, amount }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('check_price_is_fresh') || message.includes('pyth::check_price_is_fresh')) {
      throw new Error(
        `deposit_margin failed: the on-chain Pyth price oracle for this pool is stale. ` +
        `This is a shared, external oracle refreshed by market activity — it usually ` +
        `resolves within a few minutes on an active pool. Wait and retry.`
      );
    }
    throw new Error(`deposit_margin failed: ${message}`);
  }
}

// Tool 2: withdraw_margin
async function withdrawMarginHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('withdraw_margin');
    if (!state.keypair) {
      throw new Error('withdraw_margin requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const coin_type = args.coin_type as string;
    const amount = args.amount as number;
    const mm = (state.client.deepbook as any).marginManager;

    if (coin_type !== 'SUI' && coin_type !== 'USDC') {
      throw new Error(`Invalid coin_type: '${coin_type}'. Must be SUI or USDC.`);
    }

    const address = state.keypair!.toSuiAddress();
    const tx = new Transaction();
    if (coin_type === 'SUI') {
      const coin = mm.withdrawBase(MARGIN_KEY, amount)(tx);
      tx.transferObjects([coin], tx.pure.address(address));
    } else {
      const coin = mm.withdrawQuote(MARGIN_KEY, amount)(tx);
      tx.transferObjects([coin], tx.pure.address(address));
    }

    const result = await executeTransaction(tx, state);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, tx_digest: result.tx_digest, coin_type, amount }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('check_price_is_fresh') || message.includes('pyth::check_price_is_fresh')) {
      throw new Error(
        `withdraw_margin failed: the on-chain Pyth price oracle for this pool is stale. ` +
        `This is a shared, external oracle refreshed by market activity — it usually ` +
        `resolves within a few minutes on an active pool. Wait and retry.`
      );
    }
    throw new Error(`withdraw_margin failed: ${message}`);
  }
}

// Tool 3: get_margin_balances
async function getMarginBalancesHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('get_margin_balances');

    const result = await (state.client.deepbook as any).getMarginManagerState(MARGIN_KEY);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value, 2),
      }],
    };
  } catch (err) {
    throw new Error(`get_margin_balances failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 4: get_margin_orders
async function getMarginOrdersHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('get_margin_orders');

    const ids = await (state.client.deepbook as any).getConditionalOrderIds(MARGIN_KEY);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ conditional_order_ids: ids }, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value, 2),
      }],
    };
  } catch (err) {
    throw new Error(`get_margin_orders failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 5: borrow_base
async function borrowBaseHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('borrow_base');
    if (!state.keypair) {
      throw new Error('borrow_base requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const amount = args.amount as number;
    const mm = (state.client.deepbook as any).marginManager;

    const tx = new Transaction();
    mm.borrowBase(MARGIN_KEY, amount)(tx);

    const result = await executeTransaction(tx, state);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, tx_digest: result.tx_digest, asset: 'SUI', amount }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('check_price_is_fresh') || message.includes('pyth::check_price_is_fresh')) {
      throw new Error(
        `borrow_base failed: the on-chain Pyth price oracle for this pool is stale. ` +
        `This is a shared, external oracle refreshed by market activity — it usually ` +
        `resolves within a few minutes on an active pool. Wait and retry.`
      );
    }
    throw new Error(`borrow_base failed: ${message}`);
  }
}

// Tool 6: borrow_quote
async function borrowQuoteHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('borrow_quote');
    if (!state.keypair) {
      throw new Error('borrow_quote requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const amount = args.amount as number;
    const mm = (state.client.deepbook as any).marginManager;

    const tx = new Transaction();
    mm.borrowQuote(MARGIN_KEY, amount)(tx);

    const result = await executeTransaction(tx, state);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, tx_digest: result.tx_digest, asset: 'USDC', amount }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('check_price_is_fresh') || message.includes('pyth::check_price_is_fresh')) {
      throw new Error(
        `borrow_quote failed: the on-chain Pyth price oracle for this pool is stale. ` +
        `This is a shared, external oracle refreshed by market activity — it usually ` +
        `resolves within a few minutes on an active pool. Wait and retry.`
      );
    }
    throw new Error(`borrow_quote failed: ${message}`);
  }
}

// Tool 7: repay_base
async function repayBaseHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('repay_base');
    if (!state.keypair) {
      throw new Error('repay_base requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const amount = args.amount as number | undefined;
    const mm = (state.client.deepbook as any).marginManager;

    const tx = new Transaction();
    tx.add(mm.repayBase(MARGIN_KEY, amount ?? null));

    const result = await executeTransaction(tx, state);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          tx_digest: result.tx_digest,
          asset: 'SUI',
          amount: amount ?? null
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('check_price_is_fresh') || message.includes('pyth::check_price_is_fresh')) {
      throw new Error(
        `repay_base failed: the on-chain Pyth price oracle for this pool is stale. ` +
        `This is a shared, external oracle refreshed by market activity — it usually ` +
        `resolves within a few minutes on an active pool. Wait and retry.`
      );
    }
    throw new Error(`repay_base failed: ${message}`);
  }
}

// Tool 8: repay_quote
async function repayQuoteHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireMarginManager('repay_quote');
    if (!state.keypair) {
      throw new Error('repay_quote requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const amount = args.amount as number | undefined;
    const mm = (state.client.deepbook as any).marginManager;

    const tx = new Transaction();
    tx.add(mm.repayQuote(MARGIN_KEY, amount ?? null));

    const result = await executeTransaction(tx, state);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          tx_digest: result.tx_digest,
          asset: 'USDC',
          amount: amount ?? null
        }, null, 2),
      }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('check_price_is_fresh') || message.includes('pyth::check_price_is_fresh')) {
      throw new Error(
        `repay_quote failed: the on-chain Pyth price oracle for this pool is stale. ` +
        `This is a shared, external oracle refreshed by market activity — it usually ` +
        `resolves within a few minutes on an active pool. Wait and retry.`
      );
    }
    throw new Error(`repay_quote failed: ${message}`);
  }
}

// Tool definitions
export const marginAccountTools = [
  {
    name: 'deposit_margin',
    description: 'Deposit SUI or USDC collateral into the MarginManager.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_type: {
          type: 'string',
          description: 'Coin to deposit — SUI or USDC',
          enum: ['SUI', 'USDC'],
        },
        amount: {
          type: 'number',
          description: 'Amount to deposit in human-readable units (e.g. 1.5 for 1.5 SUI)',
        },
      },
      required: ['coin_type', 'amount'],
    },
  },
  {
    name: 'withdraw_margin',
    description: 'Withdraw SUI or USDC collateral from the MarginManager. Subject to on-chain risk ratio limits.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_type: {
          type: 'string',
          description: 'Coin to withdraw — SUI or USDC',
          enum: ['SUI', 'USDC'],
        },
        amount: {
          type: 'number',
          description: 'Amount to withdraw in human-readable units',
        },
      },
      required: ['coin_type', 'amount'],
    },
  },
  {
    name: 'get_margin_balances',
    description: 'Query MarginManager state — deposited assets, outstanding debts, and current risk ratio.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_margin_orders',
    description: 'Query conditional order IDs currently registered on the MarginManager.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'borrow_base',
    description: 'Borrows SUI against deposited collateral.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to borrow in human-readable units (e.g. 1.0 for 1 SUI)',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'borrow_quote',
    description: 'Borrows USDC against deposited collateral.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to borrow in human-readable units',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'repay_base',
    description: 'Repays outstanding SUI debt on the MarginManager.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to repay. If omitted, repays full debt.',
        },
      },
      required: [],
    },
  },
  {
    name: 'repay_quote',
    description: 'Repays outstanding USDC debt on the MarginManager.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to repay. If omitted, repays full debt.',
        },
      },
      required: [],
    },
  },
];

// Handler mapping
export const marginAccountHandlers: Record<string, MarginAccountHandler> = {
  deposit_margin: depositMarginHandler,
  withdraw_margin: withdrawMarginHandler,
  get_margin_balances: getMarginBalancesHandler,
  get_margin_orders: getMarginOrdersHandler,
  borrow_base: borrowBaseHandler,
  borrow_quote: borrowQuoteHandler,
  repay_base: repayBaseHandler,
  repay_quote: repayQuoteHandler,
};
