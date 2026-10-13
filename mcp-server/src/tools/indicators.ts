/**
 * Technical analysis MCP tool.
 * Fetches OHLCV candles from DeepBook Indexer and computes indicators.
 */

import { isPoolAllowed } from '../config.js';
import type { AppState } from '../client.js';
import type { Candle } from '../utils/indicators.js';
import { rsi, macd, bollingerBands, ema } from '../utils/indicators.js';

// Common handler signature for consistency with other tools
export type IndicatorHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

// Volume normalisation scalars by pool
const VOLUME_SCALARS: Record<string, number> = {
  SUI_USDC: 9,  // SUI has 9 decimal places
  DEEP_USDC: 6, // DEEP has 6 decimal places
};

// Allowed intervals
const ALLOWED_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

/**
 * Validate interval parameter
 */
function validateInterval(interval: string): void {
  if (!ALLOWED_INTERVALS.includes(interval)) {
    throw new Error(
      `Invalid interval: "${interval}". Allowed intervals: ${ALLOWED_INTERVALS.join(', ')}`
    );
  }
}

/**
 * Get volume scalar for a pool
 */
function getVolumeScalar(pool: string): number {
  return VOLUME_SCALARS[pool] || 9; // Default to 9 if pool not in map
}

/**
 * Convert raw candle array to Candle object with volume normalisation
 */
function rawCandleToCandle(rawCandle: number[], pool: string): Candle {
  const scalar = getVolumeScalar(pool);
  const scalarFactor = Math.pow(10, scalar);

  return {
    timestamp: rawCandle[0],           // Unix seconds
    open: rawCandle[1],                // Already human-readable float
    high: rawCandle[2],
    low: rawCandle[3],
    close: rawCandle[4],
    volume: rawCandle[5] / scalarFactor, // Normalise volume
  };
}

/**
 * Fetch candles from DeepBook Indexer
 */
async function fetchCandles(pool: string, interval: string): Promise<Candle[]> {
  const baseUrl = 'https://deepbook-indexer.mainnet.mystenlabs.com';
  const url = `${baseUrl}/ohclv/${pool}?interval=${interval}&limit=200`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Indexer request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.candles || !Array.isArray(data.candles)) {
    throw new Error('Invalid response format from indexer');
  }

  // Convert raw candle arrays to Candle objects
  return data.candles.map((rawCandle: number[]) => rawCandleToCandle(rawCandle, pool));
}

// Main tool handler
async function getTechnicalAnalysisHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    // Client not used in this tool (fetches from HTTP API), but signature must be consistent
    const pool = args.pool as string;
    const interval = (args.interval as string) || '1h';

    // Validate pool against allowed list
    if (!isPoolAllowed(pool)) {
      throw new Error(`Pool '${pool}' is not in the allowed pools list.`);
    }

    // Validate interval
    validateInterval(interval);

    // Fetch candles from indexer
    const candles = await fetchCandles(pool, interval);

    if (candles.length === 0) {
      throw new Error('No candle data available from indexer');
    }

    // Sort candles by timestamp (oldest to newest)
    candles.sort((a, b) => a.timestamp - b.timestamp);

    // Latest close price
    const latestClose = candles[candles.length - 1].close;

    // Compute indicators
    const rsi14 = rsi(candles, 14);
    const macdResult = macd(candles);
    const bbResult = bollingerBands(candles, 20);
    const ema20 = ema(candles, 20);
    const ema50 = ema(candles, 50);
    const ema200 = ema(candles, 200);

    // Construct result object
    const result = {
      pool,
      interval,
      candle_count: candles.length,
      latest_close: latestClose,
      // Start time of the newest candle; if it is far behind fetched_at, the indexer data is stale
      latest_candle_at: new Date(candles[candles.length - 1].timestamp * 1000).toISOString(),
      rsi_14: rsi14,
      macd: macdResult,
      bollinger_bands: bbResult,
      ema_20: ema20,
      ema_50: ema50,
      ema_200: ema200,
      fetched_at: new Date().toISOString(),
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
    throw new Error(`get_technical_analysis failed for pool '${args.pool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool definition
export const indicatorTools = [
  {
    name: 'get_technical_analysis',
    description: 'Fetch OHLCV candles from the DeepBook Indexer and compute RSI, MACD, Bollinger Bands, and 20/50/200 EMAs for a pool.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: {
          type: 'string',
          description: 'Pool key e.g. SUI_USDC or DEEP_USDC',
        },
        interval: {
          type: 'string',
          description: 'Candle interval — one of "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"',
          default: '1h',
        },
      },
      required: ['pool'],
    },
  },
];

// Handler mapping
export const indicatorHandlers: Record<string, IndicatorHandler> = {
  get_technical_analysis: getTechnicalAnalysisHandler,
};