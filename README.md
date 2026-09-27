# Hermes DeepBook Agent

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/hermes-railway-template?referralCode=uTN7AS&utm_medium=integration&utm_source=template&utm_campaign=generic)

Deploy a chat-based trading agent that talks to Sui's [DeepBook V3](https://docs.sui.io/standards/deepbook) exchange over Telegram, Discord, or Slack. The container bundles two processes: the [Hermes](https://github.com/NousResearch/hermes-agent) LLM gateway (chat, memory, scheduling) and a custom **DeepBook MCP server** that gives Hermes real trading and market-data tools on Sui.

This README focuses on the DeepBook MCP server — the TypeScript project actually developed in this repo. For Hermes gateway configuration, see the [upstream docs](https://github.com/NousResearch/hermes-agent).

This DeepBook MCP server can be configured to run with any agent or deployed locally or on any protocol. 

## How it fits together

```
Telegram / Discord / Slack
        ↓
Hermes gateway (Python, cloned from upstream at build time)
        ↓  stdio (MCP protocol)
DeepBook MCP server (mcp-server/, TypeScript — this repo)
        ↓
Sui gRPC + DeepBook V3 / NAVI / Cetus SDKs
        ↓
Sui mainnet or testnet
```

Hermes runs the chat model and decides when to call a tool. The MCP server is the thing that actually knows how to read Deepbook order books, place orders, manage margin positions, and move funds — all validated against a strict TypeScript config layer before anything touches the chain.

## What the DeepBook MCP server can do

The server registers its tools in two tiers depending on what's configured:

**Read-only (always available, no private key needed)**
- Live mid-price, order book depth, and quote conversions for allow-listed pools
- Pool trade/book parameters and DEEP token pricing
- Technical indicators — RSI(14), MACD(12/26/9), Bollinger Bands(20), EMA(20/50/200)
- DeFi research reports via the Muneo integration
- On-chain agent memory recall

**Trading (requires a signing key)**
- Place, modify, and cancel limit or market orders on DeepBook
- Deposit/withdraw balances and settle funds through a Balance Manager
- Conditional (trigger) orders
- Atomic flash loans (borrow + repay in one transaction)
- Direct base/quote swaps
- Margin account deposits, borrows, repayments, and balance/position queries
- Cetus AMM liquidity management (open/close positions, add/remove liquidity, collect rewards)

Read-only mode is the safe default: without a private key, only market-data and indicator tools are exposed, so the agent can quote prices and analyze the market without ever being able to move funds.

## Repository layout

```
mcp-server/            DeepBook MCP server (TypeScript) — the core of this repo
  src/index.ts          entry point: registers tools, connects via stdio
  src/client.ts          Sui client + keypair singleton (read-only or signing mode)
  src/config.ts          env var validation (network, RPC URL, pool allowlist, addresses)
  src/tools/             one module per tool group (market data, orders, swaps, margin, ...)
  src/utils/             transaction builder/executor, indicator math
scripts/entrypoint.sh   bootstraps Hermes state and launches the gateway
Dockerfile              builds both processes into a single container
railway.toml            Railway service defaults
```

## Running the MCP server locally

```bash
cd mcp-server
npm install
npm run build
npm start
```

There's no test suite — TypeScript's strict mode is the primary correctness check (`npm run build` will fail on type errors).

To smoke-test the full container (Hermes + MCP server) locally:

```bash
docker build -t hermes-railway-template .

docker run --rm \
  -e OPENROUTER_API_KEY=sk-or-xxx \
  -e TELEGRAM_BOT_TOKEN=123456:ABC \
  -e TELEGRAM_ALLOWED_USERS=123456789 \
  -v "$(pwd)/.tmpdata:/data" \
  hermes-railway-template
```

## Configuring the MCP server

Set these as Railway (or local) environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SUI_NETWORK` | `mainnet` | `mainnet` or `testnet` |
| `SUI_RPC_URL` | fullnode.mainnet.sui.io | Sui gRPC endpoint |
| `ALLOWED_POOLS` | `SUI_USDC,DEEP_USDC` | comma-separated pool allowlist |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `SUI_PRIVATE_KEY` | — | signing key; entrypoint writes it to a file and clears it from the env |
| `SUI_KEY_FILE` | — | path to a key file, if you're supplying one directly |
| `BALANCE_MANAGER_ADDRESS` | — | required for account, order, and conditional-order tools |
| `MARGIN_MANAGER_ADDRESS` | — | required for margin account tools |

Leave `SUI_PRIVATE_KEY` unset to run in read-only mode — market data and indicators still work, nothing can be traded.

## Railway deploy instructions

In Railway Template Composer:

1. Add a volume mounted at `/data` (Hermes persists its state there).
2. Deploy as a **worker** service (not web).
3. Configure the variables below.

Template defaults (already included in `railway.toml`):

- `HERMES_HOME=/data/.hermes`
- `HOME=/data`

### Required runtime variables

- At least one inference provider config:
  - `OPENROUTER_API_KEY`, or
  - `OPENAI_BASE_URL` + `OPENAI_API_KEY`, or
  - `ANTHROPIC_API_KEY`
- At least one messaging platform:
  - Telegram: `TELEGRAM_BOT_TOKEN`
  - Discord: `DISCORD_BOT_TOKEN`
  - Slack: `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`

Strongly recommended allowlists (comma-separated, no brackets, no quotes):

- `TELEGRAM_ALLOWED_USERS=123456789,987654321`
- `DISCORD_ALLOWED_USERS=123456789012345678,234567890123456789`
- `SLACK_ALLOWED_USERS=U01234ABCDE,U09876WXYZ`

Optional global controls:

- `GATEWAY_ALLOW_ALL_USERS=true` (not recommended)

If you set multiple provider keys, also set `HERMES_INFERENCE_PROVIDER` (e.g. `openrouter`) to avoid auto-selection surprises.

For the full and up-to-date Hermes variable list, see the [upstream repository](https://github.com/NousResearch/hermes-agent/blob/main/README.md).

## Using it after deploy

1. Start a chat with your bot on Telegram/Discord/Slack.
2. If using allowlists, make sure your user ID is included.
3. Ask it something market-related, e.g. "what's the mid price on SUI/USDC?"
4. To enable trading, set `SUI_PRIVATE_KEY` and `BALANCE_MANAGER_ADDRESS`, then ask it to place an order.

Helpful first checks:

- Gateway logs show a successful platform connection.
- The volume mount exists at `/data`.
- Provider variables are set and valid.
- `[deepbook-mcp] Server ready` appears in logs with the expected network and tool count.

## Running Hermes commands manually

To run `hermes ...` commands inside the deployed service (e.g. `hermes config`, `hermes model`, `hermes pairing list`), connect with [Railway SSH](https://docs.railway.com/cli/ssh):

```bash
hermes status
hermes config
hermes model
hermes pairing list
```

## Troubleshooting

- `401 Missing Authentication header`: provider/key mismatch (often wrong provider auto-selection or a missing API key for the selected provider).
- Bot connected but no replies: check allowlist variables and user IDs.
- Trading tools missing from the tool list: `SUI_PRIVATE_KEY`/`SUI_KEY_FILE` (and `BALANCE_MANAGER_ADDRESS` for account/order tools) aren't set — the server is running read-only.
- Data lost after redeploy: verify the Railway volume is mounted at `/data`.

## Build pinning

Docker build arg:

- `HERMES_GIT_REF` (default: `main`) — pin the Hermes gateway to a specific tag or commit.
