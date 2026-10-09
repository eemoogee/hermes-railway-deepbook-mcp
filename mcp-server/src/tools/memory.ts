import type { AppState } from '../client.js';

// Common handler signature for all memory tools
export type MemoryHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

// MemWal is optional — without credentials the memory tools are not registered
const memwalConfigured = Boolean(process.env.MEMWAL_PRIVATE_KEY && process.env.MEMWAL_ACCOUNT_ID);
if (!memwalConfigured) {
  console.error('[memory] MEMWAL_PRIVATE_KEY/MEMWAL_ACCOUNT_ID not set — memory tools disabled');
}

// Declare memwal variable - actual initialization happens in async context
// We use any type since @mysten-incubation/memwal package types may not be available
let memwal: any = null;

// Async function to initialize memwal
async function initializeMemWal(): Promise<void> {
  try {
    // Dynamic import to avoid compile-time errors if package is not installed
    const { MemWal } = await import('@mysten-incubation/memwal');
    memwal = MemWal.create({
      key: process.env.MEMWAL_PRIVATE_KEY!,
      accountId: process.env.MEMWAL_ACCOUNT_ID!,
      serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
    });
  } catch (err) {
    console.error('[memory] Failed to initialize MemWal client:', err);
    throw new Error('[memory] MemWal client initialization failed');
  }
}

// Initialize immediately but don't block module load
// Handlers will check if memwal is initialized
if (memwalConfigured) {
  initializeMemWal().catch(err => {
    console.error('[memory] MemWal initialization failed:', err);
  });
}

// Helper to ensure memwal is initialized
async function ensureMemWalInitialized(): Promise<any> {
  if (!memwal) {
    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!memwal) {
      throw new Error('MemWal client not initialized');
    }
  }
  return memwal;
}

// Tool 1: memory_write
async function memoryWriteHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const text = args.text as string;
    const namespace = args.namespace as string;

    if (!text || typeof text !== 'string') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'text parameter is required and must be a string'
          }, null, 2)
        }]
      };
    }

    if (!namespace || typeof namespace !== 'string') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'namespace parameter is required and must be a string'
          }, null, 2)
        }]
      };
    }

    const client = await ensureMemWalInitialized();

    // Write with 30 second timeout
    // We'll call the method with appropriate parameters
    // The actual API signature will be determined at runtime
    const result = await client.rememberAndWait(text, namespace, { timeoutMs: 30000 });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          blob_id: result.blobId || result.blob_id,
          namespace: result.namespace || namespace,
          owner: result.owner || 'unknown'
        }, null, 2)
      }]
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `memory_write failed: ${err instanceof Error ? err.message : String(err)}`
        }, null, 2)
      }]
    };
  }
}

// Tool 2: memory_recall
async function memoryRecallHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const query = args.query as string;
    const namespace = args.namespace as string;
    const limit = args.limit as number ?? 5;
    const maxDistance = args.max_distance as number ?? 0.6;

    if (!query || typeof query !== 'string') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'query parameter is required and must be a string'
          }, null, 2)
        }]
      };
    }

    if (!namespace || typeof namespace !== 'string') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'namespace parameter is required and must be a string'
          }, null, 2)
        }]
      };
    }

    const client = await ensureMemWalInitialized();

    const response = await client.recall({ query, namespace, limit });

    const resultsArray = Array.isArray(response) ? response : (response?.results ?? []);

    const filteredResults = resultsArray
      .filter((result: any) => result.distance <= maxDistance)
      .map((result: any) => ({
        text: result.text,
        distance: result.distance,
        blob_id: result.blobId || result.blob_id
      }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          results: filteredResults,
          total: filteredResults.length,
          namespace
        }, null, 2)
      }]
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `memory_recall failed: ${err instanceof Error ? err.message : String(err)}`
        }, null, 2)
      }]
    };
  }
}

// Tool 3: memory_health
async function memoryHealthHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  try {
    const client = await ensureMemWalInitialized();
    const health = await client.health();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: health.status || 'unknown',
          version: health.version || 'unknown'
        }, null, 2)
      }]
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `memory_health failed: ${err instanceof Error ? err.message : String(err)}`
        }, null, 2)
      }]
    };
  }
}

// Tool definitions
const memoryToolDefinitions = [
  {
    name: 'memory_write',
    description: 'Write a memory to Walrus Memory. Use this to log trade decisions, market observations, and strategy performance. text should be a distilled, factual statement — not a raw dump. namespace organises the memory by type (e.g. trades, strategies, market). Writes are append-only — avoid writing duplicate or redundant entries.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The memory to store. Should be a distilled factual statement.',
        },
        namespace: {
          type: 'string',
          description: 'The namespace to write to.',
        },
      },
      required: ['text', 'namespace'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall memories from Walrus Memory by semantic similarity. Use this on demand when prior context is relevant to the current task — not on every message. Be economical: use a specific query, keep limit low (3-5), and trust the distance filter. Results with distance < 0.25 are near-duplicates. Results with distance 0.25-0.55 are clearly related. Results above 0.6 are filtered out by default.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query describing what to recall.',
        },
        namespace: {
          type: 'string',
          description: 'Namespace to search within.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 5).',
          default: 5,
        },
        max_distance: {
          type: 'number',
          description: 'Maximum cosine distance. Results above this threshold are discarded (default: 0.6).',
          default: 0.6,
        },
      },
      required: ['query', 'namespace'],
    },
  },
  {
    name: 'memory_health',
    description: 'Check that the Walrus Memory relayer is reachable and healthy. Call this at the start of any session where memory will be relied upon.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const memoryTools = memwalConfigured ? memoryToolDefinitions : [];

// Handler mapping
export const memoryHandlers: Record<string, MemoryHandler> = {
  memory_write: memoryWriteHandler,
  memory_recall: memoryRecallHandler,
  memory_health: memoryHealthHandler,
};