/**
 * DeepBook account tools for BalanceManager queries.
 * Read-only account state queries on Sui mainnet.
 */

import { Transaction } from '@mysten/sui/transactions';
import { executeTransaction } from '../utils/tx-executor.js';
import { config, isPoolAllowed } from '../config.js';
import { requirePositiveNumber } from '../utils/validate.js';
import { SUPPORTED_COINS, networkCoins, requireNetworkCoin } from '../utils/coins.js';
import type { AppState } from '../client.js';

// Common handler signature for all account tools
export type AccountHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

// Manager key is always 'MANAGER_1' per SDK configuration
const MANAGER_KEY = 'MANAGER_1';

/**
 * Shared prerequisite checks for withdrawal tools
 */
async function performWithdrawalChecks(state: AppState): Promise<void> {
  if (!config.balanceManagerAddress) {
    throw new Error('Withdrawal tools require BALANCE_MANAGER_ADDRESS to be configured.');
  }
  if (!state.keypair) {
    throw new Error('Cannot withdraw: MCP server is in read-only mode.');
  }
}

function requireBalanceManager(toolName: string): void {
  if (!config.balanceManagerAddress) {
    throw new Error(`${toolName} requires BALANCE_MANAGER_ADDRESS to be configured.`);
  }
}

// Tool 1: get_balances
async function getBalancesHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireBalanceManager('get_balances');

    const { client } = state;

    const coinKeys = networkCoins().map((c) => c.key);
    const balancePromises = coinKeys.map(coinKey =>
      client.deepbook.checkManagerBalance(MANAGER_KEY, coinKey)
    );

    const balanceResults = await Promise.all(balancePromises);

    const balances = coinKeys.map((coinKey, index) => ({
      coin: coinKey,
      coinType: balanceResults[index].coinType,
      balance: balanceResults[index].balance,
    }));

    const result = { balances };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_balances failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 2: get_open_orders
async function getOpenOrdersHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireBalanceManager('get_open_orders');

    const pool = args.pool as string;

    if (!isPoolAllowed(pool)) {
      throw new Error(`Pool '${pool}' is not in the allowed pools list.`);
    }

    const { client } = state;
    const openOrders = await client.deepbook.getAccountOrderDetails(pool, MANAGER_KEY);

    let result: Record<string, any>;
    if (openOrders.length === 0) {
      result = {
        pool,
        open_orders: [],
        message: 'No open orders',
      };
    } else {
      result = {
        pool,
        open_orders: openOrders,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_open_orders failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 3: get_order
async function getOrderHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireBalanceManager('get_order');

    const pool = args.pool as string;
    const orderId = args.order_id as string;

    if (!isPoolAllowed(pool)) {
      throw new Error(`Pool '${pool}' is not in the allowed pools list.`);
    }

    const { client } = state;
    const order = await client.deepbook.getOrderNormalized(pool, orderId);

    let result: Record<string, any>;
    if (order === null) {
      result = {
        pool,
        order_id: orderId,
        found: false,
      };
    } else {
      result = {
        pool,
        order,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    throw new Error(`get_order failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 4: get_account_state
async function getAccountStateHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireBalanceManager('get_account_state');

    const pool = args.pool as string;

    if (!isPoolAllowed(pool)) {
      throw new Error(`Pool '${pool}' is not in the allowed pools list.`);
    }

    const { client } = state;
    const accountState = await client.deepbook.account(pool, MANAGER_KEY);

    // Map SDK response to expected output format
    // The SDK returns snake_case fields based on the TypeScript error
    const accountStateAny = accountState as any;
    const result = {
      pool,
      epoch: accountStateAny.epoch,
      taker_volume: accountStateAny.taker_volume,
      maker_volume: accountStateAny.maker_volume,
      active_stake: accountStateAny.active_stake,
      unclaimed_rebates: {
        base: accountStateAny.unclaimed_rebates?.base ?? 0,
        quote: accountStateAny.unclaimed_rebates?.quote ?? 0,
        deep: accountStateAny.unclaimed_rebates?.deep ?? 0,
      },
      settled_balances: {
        base: accountStateAny.settled_balances?.base ?? 0,
        quote: accountStateAny.settled_balances?.quote ?? 0,
        deep: accountStateAny.settled_balances?.deep ?? 0,
      },
      owed_balances: {
        base: accountStateAny.owed_balances?.base ?? 0,
        quote: accountStateAny.owed_balances?.quote ?? 0,
        deep: accountStateAny.owed_balances?.deep ?? 0,
      },
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
    throw new Error(`get_account_state failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 5: get_locked_balance
async function getLockedBalanceHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    requireBalanceManager('get_locked_balance');

    const pool = args.pool as string;

    if (!isPoolAllowed(pool)) {
      throw new Error(`Pool '${pool}' is not in the allowed pools list.`);
    }

    const { client } = state;
    const lockedBalance = await client.deepbook.lockedBalance(pool, MANAGER_KEY);

    const result = {
      pool,
      base: lockedBalance.base,
      quote: lockedBalance.quote,
      deep: lockedBalance.deep,
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
    throw new Error(`get_locked_balance failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 6: get_wallet_balance
async function getWalletBalanceHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const { client, keypair } = state;

    if (!keypair) {
      throw new Error('get_wallet_balance requires signing mode (SUI_PRIVATE_KEY configured).');
    }

    const address = keypair.toSuiAddress();

    const balances: { coin: string; coinType: string; balance: number; balance_raw: string }[] = [];

    // On-chain balances are integers in the coin's smallest unit (1 SUI = 10^9, 1 USDC/DEEP/USDSUI = 10^6)
    for (const { key, type, scalar } of networkCoins()) {
      const suiClient = client as any;
      const response = await suiClient.getBalance({
        owner: address,
        coinType: type,
      });
      const rawBalance = response?.balance?.balance ?? '0';
      balances.push({
        coin: key,
        coinType: type,
        balance: Number(rawBalance) / scalar,
        balance_raw: rawBalance,
      });
    }

    const result = {
      address,
      balances,
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
    throw new Error(`get_wallet_balance failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 7: withdraw_from_balance_manager
async function withdrawFromBalanceManagerHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    await performWithdrawalChecks(state);

    const coin_type = requireNetworkCoin('coin_type', args.coin_type);
    const amount = requirePositiveNumber('amount', args.amount);

    const address = state.keypair!.toSuiAddress();
    const tx = new Transaction();

    // Call withdrawFromManager with MANAGER_1, coin_type, amount, recipient address
    tx.add(
      (state.client.deepbook.balanceManager as any).withdrawFromManager(
        MANAGER_KEY,
        coin_type,
        amount,
        tx.pure.address(address)
      )
    );

    const { tx_digest } = await executeTransaction(tx, state);

    const result = {
      success: true,
      tx_digest,
      coin_type,
      amount,
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
    throw new Error(`withdraw_from_balance_manager failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool 8: withdraw_all_from_balance_manager
async function withdrawAllFromBalanceManagerHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    await performWithdrawalChecks(state);

    const coin_type = requireNetworkCoin('coin_type', args.coin_type);

    const address = state.keypair!.toSuiAddress();
    const tx = new Transaction();

    // Call withdrawAllFromManager with MANAGER_1, coin_type, recipient address
    tx.add(
      (state.client.deepbook.balanceManager as any).withdrawAllFromManager(
        MANAGER_KEY,
        coin_type,
        tx.pure.address(address)
      )
    );

    const { tx_digest } = await executeTransaction(tx, state);

    const result = {
      success: true,
      tx_digest,
      coin_type,
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
    throw new Error(`withdraw_all_from_balance_manager failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const accountTools = [
  {
    name: 'get_balances',
    description: 'Get SUI, USDC, DEEP and USDSUI balances from the BalanceManager.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_open_orders',
    description: 'Get all open orders for a pool from the BalanceManager.',
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
    name: 'get_order',
    description: 'Get details of a specific order by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key, e.g. SUI_USDC or DEEP_USDC',
        },
        order_id: {
          type: 'string',
          description: 'Order ID to look up',
        },
      },
      required: ['pool', 'order_id'],
    },
  },
  {
    name: 'get_account_state',
    description: 'Get full account state for a pool (epoch, volumes, stake, balances).',
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
    name: 'get_locked_balance',
    description: 'Get locked base, quote, and DEEP balances for a pool.',
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
    name: 'get_wallet_balance',
    description: 'Get SUI, USDC, DEEP and USDSUI balances from the raw wallet address (on-chain, not BalanceManager). Returns the total balance for each coin type owned by the wallet: balance is in whole coins, balance_raw in the coin\'s smallest on-chain unit.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'withdraw_from_balance_manager',
    description: 'Withdraw a specific amount of a coin from the BalanceManager to the wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_type: {
          type: 'string',
          description: 'Coin type to withdraw: SUI, USDC, DEEP or USDSUI',
          enum: [...SUPPORTED_COINS],
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
    name: 'withdraw_all_from_balance_manager',
    description: 'Withdraw the entire balance of a coin from the BalanceManager to the wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        coin_type: {
          type: 'string',
          description: 'Coin type to withdraw: SUI, USDC, DEEP or USDSUI',
          enum: [...SUPPORTED_COINS],
        },
      },
      required: ['coin_type'],
    },
  },
];

// Handler mapping
export const accountHandlers: Record<string, AccountHandler> = {
  get_balances: getBalancesHandler,
  get_open_orders: getOpenOrdersHandler,
  get_order: getOrderHandler,
  get_account_state: getAccountStateHandler,
  get_locked_balance: getLockedBalanceHandler,
  get_wallet_balance: getWalletBalanceHandler,
  withdraw_from_balance_manager: withdrawFromBalanceManagerHandler,
  withdraw_all_from_balance_manager: withdrawAllFromBalanceManagerHandler,
};