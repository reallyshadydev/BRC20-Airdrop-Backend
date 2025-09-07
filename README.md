## DRC-20 Airdrop Backend

Dogecoin DRC-20 airdrop support is available via CLI and REST.

Setup

- Copy `.env.example` to `.env` and set Dogecoin RPC credentials
- Run a Dogecoin full node with RPC enabled
- Create a Doge wallet if needed: `npm run doge -- wallet new`

CLI

- Deploy: `npm run doge -- doge20 deploy <inscribeToAddress> <TICK> <max> <limit> [decimals]`
- Mint: `npm run doge -- doge20 mint <inscribeToAddress> <TICK> <amount> [repeat]`
- Transfer: `npm run doge -- doge20 transfer <inscribeToAddress> <TICK> <amount> <toAddress> [repeat]`
- Wallet: `npm run doge -- wallet balance|sync|split|send ...`

REST Airdrop

POST `/api/doge/airdrop`

Body example:

```
{
  "fromAddress": "Dxxxxx...",
  "ticker": "TEST",
  "amount": "1000",
  "recipients": ["Daddr1", "Daddr2"],
  "op": "transfer",
  "repeat": 1
}
```

Returns a per-recipient log summary.