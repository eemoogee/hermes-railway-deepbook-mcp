/**
 * Input validation shared by the tools that move funds.
 * Tool arguments come from an LLM, so they are checked here rather than trusted:
 * a string "false" must not become a truthy value, and a missing amount must not
 * become NaN or 0 in a transaction.
 */

import { config, isPoolAllowed, readEnv } from '../config.js';

export const DEFAULT_MAX_SLIPPAGE_PCT = 1;

/** Pool key that is in ALLOWED_POOLS, or throws. */
export function requireAllowedPool(value: unknown, name = 'pool'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  const pool = value.trim();
  if (!isPoolAllowed(pool)) {
    throw new Error(`Pool '${pool}' is not in the allowed pools list. Allowed: ${config.allowedPools.join(', ')}`);
  }
  return pool;
}

/** Finite number > 0 from a number or numeric string, or throws. */
export function requirePositiveNumber(name: string, value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number. Got: ${JSON.stringify(value)}`);
  }
  return n;
}

/** Like requirePositiveNumber, but missing means `fallback` and 0 is allowed. */
export function optionalNonNegativeNumber(name: string, value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number. Got: ${JSON.stringify(value)}`);
  }
  return n;
}

/** true/false, also accepting the strings "true"/"false" — anything else throws instead of being coerced. */
export function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  throw new Error(`${name} must be true or false. Got: ${JSON.stringify(value)}`);
}

export function optionalBoolean(name: string, value: unknown, fallback: boolean): boolean {
  return value === undefined || value === null ? fallback : requireBoolean(name, value);
}

export function requireOneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${name} must be one of ${allowed.join(', ')}. Got: ${JSON.stringify(value)}`);
}

/**
 * DeepBook order IDs are u128 values; a JS number cannot hold them exactly, so the
 * ID is kept as a string of digits (as returned by get_open_orders).
 */
export function requireOrderId(name: string, value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error(`${name} is too large to pass as a number without losing digits; pass it as a string exactly as returned by get_open_orders.`);
  }
  const id = typeof value === 'number' ? String(value) : value;
  if (typeof id !== 'string' || !/^\d+$/.test(id.trim())) {
    throw new Error(`${name} must be the numeric order ID string from get_open_orders. Got: ${JSON.stringify(value)}`);
  }
  return id.trim();
}

/** Maximum accepted price slippage in percent, from MAX_SLIPPAGE_PCT (default 1%). */
export function maxSlippagePct(): number {
  const raw = readEnv('MAX_SLIPPAGE_PCT');
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_SLIPPAGE_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 50) {
    throw new Error(`MAX_SLIPPAGE_PCT must be a number between 0 and 50. Got: ${raw}`);
  }
  return n;
}
