/**
 * Utility to sign and submit Sui Programmable Transaction Blocks (PTBs),
 * or simulate them without signing (dry run).
 * Formats results for MCP tool responses.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { AppState } from '../client.js';

/**
 * Execute a signed Sui transaction and return formatted result.
 * @param tx The transaction to execute
 * @param state Application state containing client and keypair
 * @returns Transaction digest and status
 * @throws Error if transaction fails or server is in read-only mode
 */
export async function executeTransaction(
  tx: Transaction,
  state: AppState
): Promise<{ tx_digest: string; status: string }> {
  if (!state.keypair) {
    throw new Error(
      'Cannot execute transaction: MCP server is in read-only mode. SUI_PRIVATE_KEY is not configured.'
    );
  }

  const result = await state.client.core.signAndExecuteTransaction({
    transaction: tx,
    signer: state.keypair,
    include: { effects: true },
  });

  // A transaction that executed but aborted on-chain comes back as FailedTransaction (gas is still spent)
  const executed = result.Transaction ?? result.FailedTransaction;
  const digest = executed?.digest ?? 'unknown';
  if (!result.Transaction?.status?.success) {
    const status = executed?.status as { error?: unknown } | undefined;
    const reason = status?.error ? ` Reason: ${JSON.stringify(status.error)}` : '';
    throw new Error(`Transaction failed. Digest: ${digest}.${reason}`);
  }

  return {
    tx_digest: digest,
    status: 'success',
  };
}

export interface SimulationResult {
  would_succeed: boolean;
  error: unknown;
  /** Net balance change per coin type for this wallet, in raw on-chain units (negative = leaves the wallet) */
  balance_changes: { coin_type: string; amount_raw: string }[];
  gas_used: unknown;
}

/**
 * Simulate a transaction as this wallet without signing or submitting it.
 * Nothing moves on-chain; used for dry_run previews.
 */
export async function simulateTransaction(tx: Transaction, state: AppState): Promise<SimulationResult> {
  if (!state.keypair) {
    throw new Error('Cannot simulate: MCP server is in read-only mode. SUI_PRIVATE_KEY is not configured.');
  }
  const address = state.keypair.toSuiAddress();
  tx.setSenderIfNotSet(address);

  const result = await state.client.core.simulateTransaction({
    transaction: tx,
    include: { effects: true, balanceChanges: true },
  });
  const executed = result.Transaction ?? result.FailedTransaction;
  const status = executed?.status as { success?: boolean; error?: unknown } | undefined;

  return {
    would_succeed: Boolean(result.Transaction?.status?.success),
    error: status?.error ?? null,
    balance_changes: (executed?.balanceChanges ?? [])
      .filter((c) => c.address === address)
      .map((c) => ({ coin_type: c.coinType, amount_raw: c.amount })),
    gas_used: executed?.effects?.gasUsed ?? null,
  };
}
