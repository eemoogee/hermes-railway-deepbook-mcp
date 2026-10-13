// Test fixtures: a fake AppState whose DeepBook SDK and Sui client record what the tools ask for.
// Must be imported before any dist/ module so config reads these env values.
process.env.ALLOWED_POOLS = 'SUI_USDC,DEEP_USDC';
process.env.SUI_NETWORK = 'mainnet';
process.env.BALANCE_MANAGER_ADDRESS = '0x' + 'a'.repeat(64);
process.env.MARGIN_MANAGER_ADDRESS = '0x' + 'b'.repeat(64);
delete process.env.MAX_SLIPPAGE_PCT;

const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');

/**
 * book: { mid, quoteOut(baseQty) -> { quoteOut, baseOut }, baseOut(quoteQty) -> { baseOut, quoteOut } }
 */
export function makeState({ book = defaultBook(), failTx = false } = {}) {
  const calls = { sdk: [], executed: [], simulated: [] };
  const record = (name) => (...args) => {
    calls.sdk.push({ name, args });
    return () => {};
  };
  const swapRecorder = (name) => (params) => {
    calls.sdk.push({ name, args: [params] });
    return (tx) => {
      const [a, b, c] = tx.splitCoins(tx.gas, [1, 2, 3]);
      return [a, b, c];
    };
  };

  const deepbook = {
    midPrice: async () => book.mid,
    poolBookParams: async () => ({ tickSize: 0.00001, lotSize: book.lotSize ?? 0.1, minSize: book.minSize ?? 1 }),
    getQuoteQuantityOut: async (pool, qty) => ({ baseQuantity: qty, ...book.quoteOut(qty) }),
    getBaseQuantityOut: async (pool, qty) => ({ quoteQuantity: qty, ...book.baseOut(qty) }),
    deepBook: {
      placeLimitOrder: (p) => record('placeLimitOrder')(p),
      placeMarketOrder: (p) => record('placeMarketOrder')(p),
      cancelOrder: record('cancelOrder'),
      cancelAllOrders: record('cancelAllOrders'),
      modifyOrder: record('modifyOrder'),
      withdrawSettledAmounts: record('withdrawSettledAmounts'),
      swapExactBaseForQuote: swapRecorder('swapExactBaseForQuote'),
      swapExactQuoteForBase: swapRecorder('swapExactQuoteForBase'),
    },
    balanceManager: {
      depositIntoManager: record('depositIntoManager'),
      withdrawFromManager: (...args) => { calls.sdk.push({ name: 'withdrawFromManager', args }); return () => {}; },
    },
    marginTPSL: {
      addConditionalOrder: (p) => record('addConditionalOrder')(p),
      cancelConditionalOrder: record('cancelConditionalOrder'),
    },
    flashLoans: {
      borrowBaseAsset: (pool, amount) => { calls.sdk.push({ name: 'borrowBaseAsset', args: [pool, amount] }); return (tx) => tx.splitCoins(tx.gas, [1, 2]); },
      borrowQuoteAsset: (pool, amount) => { calls.sdk.push({ name: 'borrowQuoteAsset', args: [pool, amount] }); return (tx) => tx.splitCoins(tx.gas, [1, 2]); },
      returnBaseAsset: (...args) => { calls.sdk.push({ name: 'returnBaseAsset', args }); return (tx) => tx.splitCoins(tx.gas, [1])[0]; },
      returnQuoteAsset: (...args) => { calls.sdk.push({ name: 'returnQuoteAsset', args }); return (tx) => tx.splitCoins(tx.gas, [1])[0]; },
    },
  };

  const keypair = new Ed25519Keypair();
  const core = {
    signAndExecuteTransaction: async ({ transaction }) => {
      calls.executed.push(transaction);
      return failTx
        ? { $kind: 'FailedTransaction', FailedTransaction: { digest: 'FAILED_DIGEST', status: { success: false, error: { message: 'MoveAbort 7' } } } }
        : { $kind: 'Transaction', Transaction: { digest: 'TEST_DIGEST', status: { success: true } } };
    },
    simulateTransaction: async ({ transaction }) => {
      calls.simulated.push(transaction);
      return {
        $kind: 'Transaction',
        Transaction: {
          status: { success: true },
          balanceChanges: [
            { coinType: '0x2::sui::SUI', address: keypair.toSuiAddress(), amount: '-1000000000' },
            { coinType: '0x2::sui::SUI', address: '0x' + 'c'.repeat(64), amount: '1000000000' },
          ],
          effects: { gasUsed: { computationCost: '1000' } },
        },
      };
    },
  };

  const client = {
    deepbook,
    core,
    getBalance: async ({ coinType }) => ({
      balance: {
        coinType,
        balance: coinType.endsWith('::sui::SUI') ? '2500000000' : coinType.endsWith('::usdsui::USDSUI') ? '7493010' : '7000000',
      },
    }),
  };
  return { state: { client, keypair }, calls };
}

/** A book with a mid of 1.00 and a 0.1% spread, deep enough for ~1,000 base units. */
export function defaultBook() {
  return {
    mid: 1.0,
    quoteOut: (qty) => (qty <= 1000 ? { quoteOut: qty * 0.999, baseOut: 0 } : { quoteOut: 999, baseOut: qty - 1000 }),
    baseOut: (quote) => {
      const base = quote / 1.001;
      return base <= 1000 ? { baseOut: base, quoteOut: 0 } : { baseOut: 1000, quoteOut: quote - 1001 };
    },
  };
}

/** A thin book: selling more than 10 units moves the price 5%. */
export function thinBook() {
  return {
    mid: 1.0,
    quoteOut: (qty) => ({ quoteOut: Math.min(qty, 10) * 0.999 + Math.max(0, qty - 10) * 0.9, baseOut: 0 }),
    baseOut: (quote) => ({ baseOut: Math.min(quote, 10) / 1.001 + Math.max(0, quote - 10) / 1.1, quoteOut: 0 }),
  };
}

export const text = (res) => JSON.parse(res.content[0].text);
export const sdkCall = (calls, name) => calls.sdk.find((c) => c.name === name);
