## DRC-20 Airdrop Backend

Dogecoin DRC-20 airdrop support via CLI and REST API, with background processing and retry logic.

### Prerequisites

- Node.js 18+
- MongoDB (local or hosted)
- Dogecoin full node with RPC enabled (recommended). Testnet is supported.

### Quick Start

1) Install dependencies

```
npm install
```

2) Configure environment

```
cp .env.example .env
# Edit .env with your MongoDB and Dogecoin RPC credentials
```

3) Start the API server

```
npm run dev
# or
npm start
```

The server runs on port 5000 by default and exposes REST endpoints under `/api`.

### Environment Variables

See `.env.example` for a complete reference. Key settings:

- `MONGO_URI`: MongoDB connection string
- `DOGE_AIRDROP_CONCURRENCY`: Max parallel recipients processed per tick
- `DOGE_AIRDROP_MAX_RETRIES`: Max retries per recipient before marking failed
- `TESTNET`: Set to `true` to use Dogecoin testnet in CLI
- `NODE_RPC_URL`, `NODE_RPC_USER`, `NODE_RPC_PASS`: Dogecoin node RPC
- `WALLET`: Wallet file used by CLI (created by `wallet new`)
- `DYNAMIC_FEES`, `FEE_PER_KB`: Fee settings for CLI transactions

### Wallet Setup (CLI)

Create a wallet file used by CLI and airdrop operations:

```
npm run doge -- wallet new
```

Then sync UTXOs from your Dogecoin node (or ORD API fallback):

```
npm run doge -- wallet sync
```

Check balance:

```
npm run doge -- wallet balance
```

If you plan to send many outputs, consider splitting UTXOs:

```
npm run doge -- wallet split <count> [amount_per_split]
```

### CLI Commands (DRC-20)

- Deploy: `npm run doge -- doge20 deploy <inscribeToAddress> <TICK> <max> <limit> [decimals]`
- Mint: `npm run doge -- doge20 mint <inscribeToAddress> <TICK> <amount> [repeat]`
- Transfer: `npm run doge -- doge20 transfer <inscribeToAddress> <TICK> <amount> <toAddress> [repeat]`

Notes:
- `<TICK>` must be 3-4 letters. Amounts are strings.
- Ensure your wallet has confirmed, spendable UTXOs and sufficient fees.

### REST API: Airdrop

The REST airdrop feature schedules and processes large airdrops in the background, executing `doge.cjs` transfers for each recipient with configurable concurrency and retries.

Endpoint: `POST /api/doge/airdrop`

Request body:

```
{
  "fromAddress": "Dxxxxx...",
  "ticker": "TEST",
  "amount": "1000",
  "recipients": ["Daddr1", "Daddr2"],
  "op": "transfer",    // or "mint"
  "repeat": 1
}
```

Response:

```
{
  "jobId": "<mongo_id>",
  "total": 2
}
```

Status: `GET /api/doge/airdrop/{jobId}` returns:

```
{
  "jobId": "<id>",
  "status": "queued|processing|completed|failed|cancelled",
  "stats": { "total": 2, "processed": 1, "success": 1, "failed": 0 },
  "updatedAt": "...",
  "createdAt": "..."
}
```

Processing:
- Background worker runs every 5 seconds (`node-cron` in `index.js`).
- Per-tick concurrency is `DOGE_AIRDROP_CONCURRENCY`.
- Failures are retried up to `DOGE_AIRDROP_MAX_RETRIES` per recipient.

#### cURL examples

Create an airdrop job:

```
curl -s -X POST http://localhost:5000/api/doge/airdrop \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "DxxxxxxxFrom",
    "ticker": "TEST",
    "amount": "1000",
    "recipients": ["DxxxxxxxTo1","DxxxxxxxTo2"],
    "op": "transfer",
    "repeat": 1
  }'
```

Poll job status:

```
curl -s http://localhost:5000/api/doge/airdrop/<jobId>
```

### How it Works

- `controller.js` stores a `DogeAirdropJob` with recipients and stats.
- A cron task invokes `processDogeAirdrops()` which:
  - Selects queued/failed recipients up to concurrency.
  - Spawns `npm run doge -- doge20 <op> <from> <ticker> <amount> <to> <repeat>` per recipient.
  - Records stdout, `txid` (if detected), errors, and updates per-recipient status.
  - Marks job `completed` when all recipients are success/failed.

### Deployment Notes

- Port: the app listens on `5000`.
- Vercel: `vercel.json` routes `/(.*)` to `index.js` but long-running cron workers may not be suitable for serverless. Prefer a Node VM/container for background jobs.
- Ensure MongoDB is reachable from your environment.

### Troubleshooting

- Airdrop stuck in `queued`:
  - Ensure the server is running and cron is active (`index.js` outputs processor tick errors if any).
  - Verify `npm run doge` works locally: `npm run doge -- wallet balance`.
  - Check `MONGO_URI` and that `DogeAirdropJob` documents are changing.

- CLI reports `No confirmed spendable UTXOs available`:
  - Wait for confirmations, then `npm run doge -- wallet sync`.
  - Consider `wallet split` to create spendable UTXOs.

- RPC errors like `401` or `ECONNREFUSED`:
  - Verify `NODE_RPC_URL`, `NODE_RPC_USER`, `NODE_RPC_PASS` and Dogecoin node RPC is enabled and reachable.

- High fees or mempool chain warnings:
  - Use `DYNAMIC_FEES=true` and adjust `FEE_PER_KB` in `.env`.

### Security

- Keep your wallet file private. Use dedicated RPC credentials with least privilege.
- Review environment variables before deploying to production.