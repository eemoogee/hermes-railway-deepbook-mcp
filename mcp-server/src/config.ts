/**
 * Configuration module for DeepBook MCP server.
 * Reads environment variables and exports a validated config object.
 * Validation errors are thrown at config construction time.
 */

// Define type for network
export type Network = 'mainnet' | 'testnet';

// Define type for log level
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Configuration interface
export interface Config {
  network: Network;
  rpcUrl: string;
  allowedPools: string[];
  logLevel: LogLevel;
  suiKeyFile: string | null;
  balanceManagerAddress: string | null;
  marginManagerAddress: string | null;
}

/**
 * Parse ALLOWED_POOLS environment variable.
 * Comma-separated string, trim whitespace, filter empty strings.
 * Returns default if empty or undefined.
 */
function parseAllowedPools(envValue: string | undefined): string[] {
  if (!envValue) {
    return ['SUI_USDC', 'DEEP_USDC'];
  }

  const pools = envValue
    .split(',')
    .map(pool => pool.trim())
    .filter(pool => pool.length > 0);

  return pools.length > 0 ? pools : ['SUI_USDC', 'DEEP_USDC'];
}

/**
 * Validate SUI_NETWORK environment variable.
 * Throws Error if invalid.
 */
function validateNetwork(envValue: string | undefined): Network {
  const defaultValue: Network = 'mainnet';

  if (!envValue) {
    return defaultValue;
  }

  if (envValue !== 'mainnet' && envValue !== 'testnet') {
    throw new Error(
      `Invalid SUI_NETWORK value: "${envValue}". Must be "mainnet" or "testnet".`
    );
  }

  return envValue as Network;
}

/**
 * Validate LOG_LEVEL environment variable.
 * Throws Error if invalid.
 */
function validateLogLevel(envValue: string | undefined): LogLevel {
  const defaultValue: LogLevel = 'info';

  if (!envValue) {
    return defaultValue;
  }

  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(envValue as LogLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL value: "${envValue}". Must be one of: ${validLevels.join(', ')}.`
    );
  }

  return envValue as LogLevel;
}

/**
 * Validate SUI_RPC_URL environment variable.
 * Returns default if empty or undefined.
 */
function validateRpcUrl(envValue: string | undefined): string {
  const defaultValue = 'https://fullnode.mainnet.sui.io:443';

  if (!envValue || envValue.trim().length === 0) {
    return defaultValue;
  }

  return envValue.trim();
}

// Internal validated configuration cache
let validatedConfig: Config | null = null;

/**
 * Read an environment variable, treating an unexpanded "${VAR}" placeholder as unset.
 * Hermes passes MCP config env values through literally when the referenced variable is not set.
 */
export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value && /^\$\{[^}]+\}$/.test(value.trim())) {
    return undefined;
  }
  return value;
}


/**
 * Validate BALANCE_MANAGER_ADDRESS environment variable.
 * Must be a 0x-prefixed 64-character hex string if set.
 * Returns null if not set.
 */
function validateBalanceManagerAddress(envValue: string | undefined): string | null {
  if (!envValue || envValue.trim().length === 0) {
    return null;
  }
  const addr = envValue.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(addr)) {
    throw new Error(
      'Invalid BALANCE_MANAGER_ADDRESS: must be a 0x-prefixed 64-character hex string.'
    );
  }
  return addr;
}

/**
 * Parse SUI_KEY_FILE environment variable.
 * Returns trimmed value or null if empty.
 */
function parseSuiKeyFile(envValue: string | undefined): string | null {
  if (!envValue || envValue.trim().length === 0) {
    return null;
  }
  return envValue.trim();
}


/**
 * Get the validated configuration.
 * Throws Error if validation fails.
 * This is called lazily on first access.
 */
function getValidatedConfig(): Config {
  if (validatedConfig) {
    return validatedConfig;
  }

  try {
    validatedConfig = {
      network: validateNetwork(readEnv('SUI_NETWORK')),
      rpcUrl: validateRpcUrl(readEnv('SUI_RPC_URL')),
      allowedPools: parseAllowedPools(readEnv('ALLOWED_POOLS')),
      logLevel: validateLogLevel(readEnv('LOG_LEVEL')),
      suiKeyFile: parseSuiKeyFile(readEnv('SUI_KEY_FILE')),
      balanceManagerAddress: validateBalanceManagerAddress(readEnv('BALANCE_MANAGER_ADDRESS')),
      marginManagerAddress: readEnv('MARGIN_MANAGER_ADDRESS')?.trim() || null,
    };
    return validatedConfig;
  } catch (error) {
    throw new Error(`Configuration error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Configuration object.
 * Uses getters to defer validation until first access.
 * This allows main() to catch validation errors.
 */
export const config: Config = {
  get network(): Network {
    return getValidatedConfig().network;
  },
  get rpcUrl(): string {
    return getValidatedConfig().rpcUrl;
  },
  get allowedPools(): string[] {
    return getValidatedConfig().allowedPools;
  },
  get logLevel(): LogLevel {
    return getValidatedConfig().logLevel;
  },
  get suiKeyFile(): string | null {
    return getValidatedConfig().suiKeyFile;
  },
  get balanceManagerAddress(): string | null {
    return getValidatedConfig().balanceManagerAddress;
  },
  get marginManagerAddress(): string | null {
    return getValidatedConfig().marginManagerAddress;
  },
};

/**
 * Check if a pool key is in the allowed pools list.
 * Case-sensitive match.
 */
export function isPoolAllowed(poolKey: string): boolean {
  return config.allowedPools.includes(poolKey);
}