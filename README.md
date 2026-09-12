# Crypto Hunter Railway V2

V2 adds two things on top of the Railway V1 live-pair scanner:

1. **Multi-scan Trajectory** — decisions use recent scan history, not only one snapshot.
2. **GMGN Basic Info tab** — a separate quick-screening view using the official `gmgn-cli token info` command.

## Scanner flow

`Live Pair Gate → Base Score → Scan History → Trajectory → Decision`

Important behavior:
- `NO_TRADABLE_PAIR` stays a hard SKIP.
- First scan is only a baseline.
- STRONG_WATCH requires confirmation across scans.
- BUY is deliberately conservative: current strong conditions + two prior STRONG_WATCH confirmations.
- Material LP / buy-pressure deterioration can downgrade to WARNING_PULLBACK or SKIP.

## GMGN Basic Info tab

This is a **quick review shortlist**, not a buy signal and not a full security audit.

It uses GMGN Token Basic Info fields such as:
- liquidity / market cap / holder count
- Smart Money and KOL wallet counts
- top-10 holder concentration
- bundler / rat-trader concentration
- dev holding status
- buy/sell transaction ratios
- buy/sell USD ratios
- token age and social links

Quick verdicts:
- `REVIEW_NOW`
- `REVIEW`
- `LOW_PRIORITY`
- `SKIP_QUICK`

## Railway variables

Existing:
- `DATABASE_URL`
- `CHAIN=solana`
- `MIN_TRADABLE_LP_USD=5000`
- `YOUNG_PAIR_HOURS=6`
- `REQUEST_TIMEOUT_MS=12000`

New for GMGN:
- `GMGN_API_KEY=<your own GMGN API key>`

Create a GMGN API key from: https://gmgn.ai/ai

Do not put the key in source code or GitHub.

## Deploy update

Replace the current GitHub repo contents with this V2 project (or commit the changed files).
Railway will redeploy the API service automatically.

For the scanner cron service, because it uses the same GitHub repo:
- keep Start Command: `npm run scan`
- keep Cron: `*/5 * * * *`
- keep the same `DATABASE_URL`

No extra cron is required for GMGN Basic Info in V2; GMGN screening is manual from its own tab to avoid unnecessary API usage/rate limits.

## Health

`GET /health` now includes:

```json
{
  "ok": true,
  "gmgnConfigured": true
}
```

If `gmgnConfigured` is false, add `GMGN_API_KEY` to the API service's Railway Variables.
