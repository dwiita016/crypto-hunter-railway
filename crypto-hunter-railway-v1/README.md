# Crypto Hunter Railway V1

Railway-native replacement for the Google Apps Script runtime.

## Architecture

- API service: persistent Express service.
- Scanner cron service: same repo, start command `npm run scan`.
- PostgreSQL: shared persistence.
- Dashboard: served by the API service from `/`.
- DexScreener: canonical live market source for V1.

## Railway setup

1. Push this folder to GitHub.
2. Create a Railway project and deploy the repo.
3. Add PostgreSQL to the same Railway project.
4. Set `DATABASE_URL` in the API service from the PostgreSQL service.
5. Create a second service from the same repo:
   - Start command: `npm run scan`
   - Cron schedule: `*/5 * * * *`
   - Give it the same `DATABASE_URL`.
6. Generate a public domain for the API service.
7. Open the domain and add token addresses.

## Important behavior

A token can only reach WATCH/BUY-compatible states if at least one pair is currently tradable.

For pairs younger than 6 hours:
- LP >= MIN_TRADABLE_LP_USD
- current 5-minute activity must exist

For older pairs:
- LP >= MIN_TRADABLE_LP_USD
- current 5-minute activity OR meaningful 1-hour activity must exist

If no pair passes:
- `decision = SKIP`
- `signal = NO_TRADABLE_PAIR`

This prevents stale 24h liquidity/volume from creating a false EARLY_WATCH like CATMETA.

## API

- `GET /health`
- `GET /api/results`
- `GET /api/tokens`
- `POST /api/tokens` body `{ "address": "...", "chain": "solana" }`
- `DELETE /api/tokens/:address`
- `POST /api/scan` body `{ "address": "..." }` for one token
- `POST /api/scan-all`
