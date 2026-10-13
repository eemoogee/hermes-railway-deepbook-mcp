// Safety tests for the tools that move funds. Run with `npm test` (builds first).
import { makeState, thinBook, text, sdkCall } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const validate = await import('../dist/utils/validate.js');
const { orderHandlers } = await import('../dist/tools/orders.js');
const { swapHandlers } = await import('../dist/tools/swaps.js');
const { conditionalOrderHandlers } = await import('../dist/tools/conditionalOrders.js');
const { flashLoanHandlers } = await import('../dist/tools/flashLoans.js');
const { accountHandlers } = await import('../dist/tools/account.js');
const { executeTransaction } = await import('../dist/utils/tx-executor.js');

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('requireBoolean never coerces the string "false" to true', () => {
  assert.equal(validate.requireBoolean('is_bid', false), false);
  assert.equal(validate.requireBoolean('is_bid', 'false'), false);
  assert.equal(validate.requireBoolean('is_bid', ' TRUE '), true);
  for (const bad of ['yes', 'sell', 1, 0, null, undefined, '']) {
    assert.throws(() => validate.requireBoolean('is_bid', bad), /must be true or false/);
  }
});

test('requirePositiveNumber rejects zero, negatives, NaN and junk', () => {
  assert.equal(validate.requirePositiveNumber('q', 1.5), 1.5);
  assert.equal(validate.requirePositiveNumber('q', '2'), 2);
  for (const bad of [0, -1, '0', 'abc', NaN, Infinity, null, undefined, '', {}]) {
    assert.throws(() => validate.requirePositiveNumber('q', bad), /must be a positive number/);
  }
});

test('requireOrderId keeps u128 IDs exact and refuses lossy numbers', () => {
  const id = '170141183460469231731687303715884105727';
  assert.equal(validate.requireOrderId('order_id', id), id);
  assert.equal(validate.requireOrderId('order_id', 42), '42');
  assert.throws(() => validate.requireOrderId('order_id', 1.7e38), /too large/);
  assert.throws(() => validate.requireOrderId('order_id', '12abc'), /numeric order ID/);
});

test('requireAllowedPool enforces ALLOWED_POOLS', () => {
  assert.equal(validate.requireAllowedPool('SUI_USDC'), 'SUI_USDC');
  assert.throws(() => validate.requireAllowedPool('WAL_USDC'), /not in the allowed pools list/);
});

test('maxSlippagePct defaults to 1 and honours MAX_SLIPPAGE_PCT', () => {
  assert.equal(validate.maxSlippagePct(), 1);
  process.env.MAX_SLIPPAGE_PCT = '2.5';
  try {
    assert.equal(validate.maxSlippagePct(), 2.5);
    process.env.MAX_SLIPPAGE_PCT = '90';
    assert.throws(() => validate.maxSlippagePct(), /between 0 and 50/);
  } finally {
    delete process.env.MAX_SLIPPAGE_PCT;
  }
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

test('place_limit_order: "false" is a sell, not a buy', async () => {
  const { state, calls } = makeState();
  const res = text(await orderHandlers.place_limit_order({ pool: 'SUI_USDC', price: 1.2, quantity: 5, is_bid: 'false' }, state));
  assert.equal(sdkCall(calls, 'placeLimitOrder').args[0].isBid, false);
  assert.equal(res.side, 'sell');
  assert.equal(calls.executed.length, 1);
});

test('place_limit_order rejects disallowed pools and bad numbers without sending anything', async () => {
  const { state, calls } = makeState();
  await assert.rejects(orderHandlers.place_limit_order({ pool: 'WAL_USDC', price: 1, quantity: 1, is_bid: true }, state), /not in the allowed pools list/);
  await assert.rejects(orderHandlers.place_limit_order({ pool: 'SUI_USDC', price: -1, quantity: 1, is_bid: true }, state), /price must be a positive number/);
  await assert.rejects(orderHandlers.place_limit_order({ pool: 'SUI_USDC', price: 1, quantity: 'lots', is_bid: true }, state), /quantity must be a positive number/);
  await assert.rejects(orderHandlers.place_limit_order({ pool: 'SUI_USDC', price: 1, quantity: 1, is_bid: true, order_type: 'GTD' }, state), /order_type must be one of/);
  assert.equal(calls.executed.length, 0);
});

test('place_limit_order dry_run simulates and never signs', async () => {
  const { state, calls } = makeState();
  const res = text(await orderHandlers.place_limit_order({ pool: 'SUI_USDC', price: 1, quantity: 1, is_bid: true, dry_run: true }, state));
  assert.equal(res.dry_run, true);
  assert.equal(res.simulation.would_succeed, true);
  assert.deepEqual(res.simulation.balance_changes, [{ coin_type: '0x2::sui::SUI', amount_raw: '-1000000000' }]);
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.simulated.length, 1);
});

test('place_market_order fills on a deep book and reports the expected price', async () => {
  const { state, calls } = makeState();
  const res = text(await orderHandlers.place_market_order({ pool: 'SUI_USDC', quantity: 100, is_bid: false }, state));
  assert.equal(calls.executed.length, 1);
  assert.ok(res.price_check.slippage_pct <= 1);
  assert.ok(Math.abs(res.price_check.expected_avg_price - 0.999) < 1e-9);
});

test('place_market_order refuses a fill far from mid on a thin book', async () => {
  for (const is_bid of [true, false]) {
    const { state, calls } = makeState({ book: thinBook() });
    await assert.rejects(
      orderHandlers.place_market_order({ pool: 'SUI_USDC', quantity: 500, is_bid }, state),
      /worse than the mid price|more than 1% above the mid price/,
    );
    assert.equal(calls.executed.length, 0);
  }
});

test('place_market_order refuses when the book cannot fill the size', async () => {
  const { state, calls } = makeState();
  await assert.rejects(orderHandlers.place_market_order({ pool: 'SUI_USDC', quantity: 5000, is_bid: false }, state), /Not enough liquidity/);
  assert.equal(calls.executed.length, 0);
});

test('cancel_order and modify_order pass the exact u128 order ID string', async () => {
  const id = '170141183460469231731687303715884105727';
  const { state, calls } = makeState();
  await orderHandlers.cancel_order({ pool: 'SUI_USDC', order_id: id }, state);
  await orderHandlers.modify_order({ pool: 'SUI_USDC', order_id: id, new_quantity: 2 }, state);
  assert.equal(sdkCall(calls, 'cancelOrder').args[2], id);
  assert.equal(sdkCall(calls, 'modifyOrder').args[2], id);
});

test('deposit validates coin and amount', async () => {
  const { state, calls } = makeState();
  await assert.rejects(orderHandlers.deposit({ coin_key: 'BTC', amount: 1 }, state), /coin_key must be one of/);
  await assert.rejects(orderHandlers.deposit({ coin_key: 'SUI', amount: 0 }, state), /amount must be a positive number/);
  await orderHandlers.deposit({ coin_key: 'USDC', amount: '25' }, state);
  assert.deepEqual(sdkCall(calls, 'depositIntoManager').args, ['MANAGER_1', 'USDC', 25]);
});

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

test('swap without a minimum gets one from the quote minus 1%', async () => {
  const { state, calls } = makeState();
  const res = text(await swapHandlers.swap_base_for_quote({ pool: 'SUI_USDC', base_amount: 100 }, state));
  const minOut = sdkCall(calls, 'swapExactBaseForQuote').args[0].minOut;
  assert.ok(Math.abs(minOut - 99.9 * 0.99) < 1e-9, `minOut was ${minOut}`);
  assert.equal(res.min_quote_out, minOut);
  assert.match(res.min_out_source, /quote minus 1% slippage/);
});

test('swap respects an explicit minimum and MAX_SLIPPAGE_PCT', async () => {
  const { state, calls } = makeState();
  await swapHandlers.swap_quote_for_base({ pool: 'SUI_USDC', quote_amount: 50, min_base_out: 49 }, state);
  assert.equal(sdkCall(calls, 'swapExactQuoteForBase').args[0].minOut, 49);

  process.env.MAX_SLIPPAGE_PCT = '3';
  try {
    const second = makeState();
    await swapHandlers.swap_base_for_quote({ pool: 'SUI_USDC', base_amount: 10 }, second.state);
    const minOut = sdkCall(second.calls, 'swapExactBaseForQuote').args[0].minOut;
    assert.ok(Math.abs(minOut - 9.99 * 0.97) < 1e-9);
  } finally {
    delete process.env.MAX_SLIPPAGE_PCT;
  }
});

test('swap treats min_out 0 as "not given" so protection cannot be switched off by accident', async () => {
  const { state, calls } = makeState();
  await swapHandlers.swap_base_for_quote({ pool: 'SUI_USDC', base_amount: 100, min_quote_out: 0 }, state);
  assert.ok(sdkCall(calls, 'swapExactBaseForQuote').args[0].minOut > 0);
});

test('swap refuses when the book cannot absorb the input, and dry_run never signs', async () => {
  const { state, calls } = makeState();
  await assert.rejects(swapHandlers.swap_base_for_quote({ pool: 'SUI_USDC', base_amount: 5000 }, state), /Not enough liquidity/);
  await assert.rejects(swapHandlers.swap_base_for_quote({ pool: 'NS_USDC', base_amount: 1 }, state), /not in the allowed pools list/);
  const res = text(await swapHandlers.swap_base_for_quote({ pool: 'SUI_USDC', base_amount: 1, dry_run: 'true' }, state));
  assert.equal(res.dry_run, true);
  assert.equal(calls.executed.length, 0);
});

// ---------------------------------------------------------------------------
// Conditional orders
// ---------------------------------------------------------------------------

test('add_conditional_order keeps trigger direction and side exact', async () => {
  const { state, calls } = makeState();
  await conditionalOrderHandlers.add_conditional_order(
    { trigger_price: 0.9, trigger_below: 'false', order_type: 'market', quantity: 3, is_bid: 'false' },
    state,
  );
  const params = sdkCall(calls, 'addConditionalOrder').args[0];
  assert.equal(params.triggerBelowPrice, false);
  assert.equal(params.pendingOrder.isBid, false);
  await assert.rejects(
    conditionalOrderHandlers.add_conditional_order({ trigger_price: 0.9, trigger_below: 'below', order_type: 'market', quantity: 3, is_bid: true }, state),
    /trigger_below must be true or false/,
  );
});

// ---------------------------------------------------------------------------
// Flash loans
// ---------------------------------------------------------------------------

const flashArgs = {
  pool: 'SUI_USDC',
  borrow_side: 'quote',
  borrow_amount: 100,
  operations: [{ type: 'swap_quote_for_base', pool: 'SUI_USDC', pct: 100 }, { type: 'swap_base_for_quote', pool: 'DEEP_USDC', pct: 100, amount: 10 }],
};

test('execute_flash_loan enforces the pool allowlist on every hop', async () => {
  const { state, calls } = makeState();
  await assert.rejects(
    flashLoanHandlers.execute_flash_loan({ ...flashArgs, operations: [{ type: 'swap_quote_for_base', pool: 'NS_USDC', pct: 100 }] }, state),
    /not in the allowed pools list/,
  );
  assert.equal(calls.executed.length, 0);
});

test('execute_flash_loan enforces min_profit on-chain by splitting it off the remainder', async () => {
  const { state, calls } = makeState();
  await flashLoanHandlers.execute_flash_loan({ ...flashArgs, min_profit: 0.5 }, state);
  const commands = calls.executed[0].getData().commands;
  const inputs = calls.executed[0].getData().inputs;
  const splitAmounts = commands
    .filter((c) => c.SplitCoins)
    .flatMap((c) => c.SplitCoins.amounts.map((a) => inputs[a.Input]?.Pure?.bytes));
  // 0.5 USDC = 500000 raw units, encoded as a little-endian u64
  const expected = Buffer.from(new BigUint64Array([500000n]).buffer).toString('base64');
  assert.ok(splitAmounts.includes(expected), 'min_profit split not found');

  const noFloor = makeState();
  await flashLoanHandlers.execute_flash_loan(flashArgs, noFloor.state);
  assert.equal(noFloor.calls.executed[0].getData().commands.filter((c) => c.SplitCoins).length, commands.filter((c) => c.SplitCoins).length - 1);
});

// ---------------------------------------------------------------------------
// Account and executor
// ---------------------------------------------------------------------------

test('swap picks the pool and direction from sell_coin and buy_coin', async () => {
  // Buying the base coin (SUI) spends the quote coin: swapExactQuoteForBase
  const buySui = makeState();
  const res = text(await swapHandlers.swap({ sell_coin: 'usdc', buy_coin: 'SUI', amount: 2 }, buySui.state));
  assert.equal(res.pool, 'SUI_USDC');
  assert.deepEqual(res.sell, { coin: 'USDC', amount: 2 });
  assert.equal(res.buy.coin, 'SUI');
  assert.equal(sdkCall(buySui.calls, 'swapExactQuoteForBase').args[0].amount, 2);
  assert.equal(sdkCall(buySui.calls, 'swapExactBaseForQuote'), undefined);
  assert.match(res.summary, /^Swap sent: sell 2 USDC for about [\d.]+ SUI on SUI_USDC.* Network fee 0\.00151 SUI\.$/);
  assert.equal(res.gas_fee_sui, 0.00151);

  // Selling the base coin: swapExactBaseForQuote
  const sellSui = makeState();
  await swapHandlers.swap({ sell_coin: 'SUI', buy_coin: 'USDC', amount: 3 }, sellSui.state);
  assert.equal(sdkCall(sellSui.calls, 'swapExactBaseForQuote').args[0].amount, 3);
  assert.equal(sdkCall(sellSui.calls, 'swapExactQuoteForBase'), undefined);
});

test('swap refuses pairs outside the allowed pools and mismatched pools', async () => {
  const { state, calls } = makeState();
  // DEEP_SUI exists on DeepBook but is not in ALLOWED_POOLS
  await assert.rejects(swapHandlers.swap({ sell_coin: 'SUI', buy_coin: 'DEEP', amount: 1 }, state), /No allowed pool trades SUI and DEEP/);
  await assert.rejects(swapHandlers.swap({ sell_coin: 'SUI', buy_coin: 'USDC', amount: 1, pool: 'DEEP_USDC' }, state), /trades DEEP\/USDC, not SUI\/USDC/);
  await assert.rejects(swapHandlers.swap({ sell_coin: 'SUI', buy_coin: 'SUI', amount: 1 }, state), /must be different/);
  assert.equal(calls.executed.length, 0);
});

test('a swap dry run summary names both coins and the simulation result', async () => {
  const { state, calls } = makeState();
  const res = text(await swapHandlers.swap({ sell_coin: 'USDC', buy_coin: 'SUI', amount: 2, dry_run: true }, state));
  assert.match(res.summary, /^Dry run, nothing was sent: sell 2 USDC for about [\d.]+ SUI on SUI_USDC \(minimum [\d.]+ SUI\); the simulation says it would succeed, network fee about 0\.00151 SUI\.$/);
  assert.equal(res.simulation.gas_fee_sui, 0.00151);
  assert.equal(res.simulation.gas_used_mist.computationCost, '750000');
  assert.equal(calls.executed.length, 0);
});

test('a swap remainder smaller than one lot is returned, not treated as missing liquidity', async () => {
  // The live case: 2 USDSUI buys 1.8 SUI in 0.1 SUI lots at 1.075, leaving 0.065 USDSUI
  const lotBook = {
    mid: 1.075,
    lotSize: 0.1,
    quoteOut: (qty) => ({ quoteOut: qty * 1.07, baseOut: 0 }),
    baseOut: (quote) => {
      const base = Math.floor(quote / 1.075 / 0.1 + 1e-9) * 0.1;
      return { baseOut: base, quoteOut: quote - base * 1.075 };
    },
  };
  const { state, calls } = makeState({ book: lotBook });
  const res = text(await swapHandlers.swap_quote_for_base({ pool: 'SUI_USDC', quote_amount: 2 }, state));
  assert.ok(Math.abs(res.expected_out - 1.8) < 1e-9);
  assert.ok(Math.abs(res.input_returned - 0.065) < 1e-9);
  assert.ok(Math.abs(sdkCall(calls, 'swapExactQuoteForBase').args[0].minOut - 1.8 * 0.99) < 1e-9);

  // More than one lot left over is still a thin book
  const thin = makeState({ book: { ...lotBook, baseOut: (quote) => ({ baseOut: 0.5, quoteOut: quote - 0.5 * 1.075 }) } });
  await assert.rejects(swapHandlers.swap_quote_for_base({ pool: 'SUI_USDC', quote_amount: 2 }, thin.state), /Not enough liquidity/);

  // An amount below one minimum-size fill says so instead of blaming liquidity
  const tiny = makeState({ book: { ...lotBook, baseOut: (quote) => ({ baseOut: 0, quoteOut: quote }) } });
  await assert.rejects(swapHandlers.swap_quote_for_base({ pool: 'SUI_USDC', quote_amount: 0.5 }, tiny.state), /minimum of 1 base/);
});

test('get_wallet_balance reports whole coins next to raw units', async () => {
  const { state } = makeState();
  const res = text(await accountHandlers.get_wallet_balance({}, state));
  const sui = res.balances.find((b) => b.coin === 'SUI');
  const usdc = res.balances.find((b) => b.coin === 'USDC');
  assert.equal(sui.balance, 2.5);
  assert.equal(sui.balance_raw, '2500000000');
  assert.equal(usdc.balance, 7);
});

test('get_wallet_balance includes USDSUI with its mainnet type and 6 decimals', async () => {
  const { state } = makeState();
  const res = text(await accountHandlers.get_wallet_balance({}, state));
  assert.deepEqual(res.balances.map((b) => b.coin), ['SUI', 'USDC', 'DEEP', 'USDSUI']);
  const usdsui = res.balances.find((b) => b.coin === 'USDSUI');
  assert.equal(usdsui.coinType, '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI');
  assert.equal(usdsui.balance, 7.49301);
  assert.equal(usdsui.balance_raw, '7493010');
});

test('USDSUI can be deposited and withdrawn; unknown coins cannot', async () => {
  const { state, calls } = makeState();
  await orderHandlers.deposit({ coin_key: 'USDSUI', amount: 5 }, state);
  assert.deepEqual(sdkCall(calls, 'depositIntoManager').args, ['MANAGER_1', 'USDSUI', 5]);
  await accountHandlers.withdraw_from_balance_manager({ coin_type: 'USDSUI', amount: 2 }, state);
  assert.deepEqual(sdkCall(calls, 'withdrawFromManager').args.slice(0, 3), ['MANAGER_1', 'USDSUI', 2]);
  await assert.rejects(accountHandlers.withdraw_from_balance_manager({ coin_type: 'WAL', amount: 1 }, state), /coin_type must be one of SUI, USDC, DEEP, USDSUI/);
});

test('deposit_all deposits whole coins, keeping 0.5 SUI for gas', async () => {
  const usdsui = makeState();
  text(await orderHandlers.deposit_all({ coin_key: 'USDSUI' }, usdsui.state));
  assert.deepEqual(sdkCall(usdsui.calls, 'depositIntoManager').args, ['MANAGER_1', 'USDSUI', 7]);
  const sui = makeState();
  text(await orderHandlers.deposit_all({ coin_key: 'SUI' }, sui.state));
  // 2.5 SUI held, 0.5 reserved, 2 deposited
  assert.deepEqual(sdkCall(sui.calls, 'depositIntoManager').args, ['MANAGER_1', 'SUI', 2]);
});

test('withdraw_from_balance_manager validates amount and pays only the own wallet', async () => {
  const { state, calls } = makeState();
  await assert.rejects(accountHandlers.withdraw_from_balance_manager({ coin_type: 'SUI', amount: -5 }, state), /positive number/);
  await accountHandlers.withdraw_from_balance_manager({ coin_type: 'SUI', amount: 1 }, state);
  assert.deepEqual(sdkCall(calls, 'withdrawFromManager').args.slice(0, 3), ['MANAGER_1', 'SUI', 1]);
  // The only address in the transaction is the wallet's own
  const own = Buffer.from(state.keypair.toSuiAddress().slice(2), 'hex').toString('base64');
  const pureInputs = calls.executed[0].getData().inputs.map((i) => i.Pure?.bytes).filter(Boolean);
  assert.deepEqual(pureInputs, [own]);
});

test('executeTransaction reports the digest and reason of an on-chain failure', async () => {
  const { state } = makeState({ failTx: true });
  const { Transaction } = await import('@mysten/sui/transactions');
  await assert.rejects(executeTransaction(new Transaction(), state), /Digest: FAILED_DIGEST\. Reason: .*MoveAbort 7/);
});
