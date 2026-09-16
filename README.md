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


## V2.2 — Security Gate tanpa tab baru

`CHECK & ADD` sekarang menjalankan:
`Basic Info re-check -> GMGN Security -> Scanner`

Automatic Scanner entry hanya jika:
- Basic = `REVIEW_NOW` / `REVIEW`
- Security = `SECURE`

`CAUTION` dan `BLOCK` tidak auto-add.

Hard stops:
- honeypot (BSC/Base)
- rug_ratio > 0.30
- sell_tax > 0.10
- top_10_holder_rate > 0.60
- Solana mint authority masih aktif
- Solana freeze authority masih aktif

Warnings yang menghasilkan `CAUTION`:
- wash trading
- creator masih hold
- konsentrasi dev/creator/insider tinggi
- bundler/rat-trader tinggi
- sniper_count >= 5


## V2.3 — Trajectory History UI

Scanner sekarang punya tombol `HISTORY` pada setiap token.

Drawer/modal history menampilkan sampai 20 scan terakhir:
- timestamp
- Decision
- Trajectory
- Score
- Pair LP
- Buy Ratio 5M / 1H
- Price Change 1H
- Reason

Perubahan state ditampilkan sebagai transition, contoh:

`WAIT → EARLY_WATCH → STRONG_WATCH`

Endpoint baru:
- `GET /api/history/:address?limit=20`

History memakai table PostgreSQL `scan_history` yang sudah ada, jadi tidak perlu database/variable Railway baru.


## V2.4 — Row Click History

Tombol `HISTORY` dihapus.

Sekarang pada tab SCANNER:
- klik area mana pun pada row token → buka Trajectory History
- tombol `DELETE` tetap hanya menghapus token dan tidak membuka history
- tidak ada tambahan kolom/button di row


## V2.5 — Telegram State-Change Alert

Telegram tidak dikirim setiap scan.

Alert hanya saat state berubah ke salah satu state penting:
- `EARLY_WATCH`
- `STRONG_WATCH`
- `BUY`
- `WARNING_PULLBACK`
- `EXIT_WARNING`
- `EXIT_NOW`
- `SKIP`

Contoh:
- `WAIT → EARLY_WATCH` → alert
- `EARLY_WATCH → STRONG_WATCH` → alert
- `STRONG_WATCH → STRONG_WATCH` → tidak alert
- first scan `SKIP` → tidak alert (supaya tidak spam)

Jika Telegram gagal, scanner tetap jalan; kegagalan alert tidak menggagalkan market scan.

Railway Variables baru:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

`/health` sekarang menampilkan `telegramConfigured: true/false`.


## V2.6 — Post-Entry Monitor

Setelah token pernah mencapai `BUY`, scanner otomatis beralih ke post-entry monitoring.

Lifecycle:
- `BUY`
- `HOLD`
- `WARNING_PULLBACK`
- `EXIT_WARNING`
- `EXIT_NOW`
- `RECOVERY`
- kembali `HOLD`

Post-entry membandingkan kondisi sekarang dengan baseline BUY:
- Pair LP vs BUY
- Market Cap vs BUY
- Buy Ratio 5M / 1H
- Price Change 5M / 1H
- live-pair availability

Guardrail utama:
- `EXIT_NOW`: no-tradable pair, LP turun >50%, buy pressure runtuh, atau dump tajam
- `EXIT_WARNING`: pelemahan lanjutan tetapi belum structural breakdown total
- `WARNING_PULLBACK`: pullback awal
- `RECOVERY`: kondisi pulih setelah warning
- `HOLD`: struktur post-entry masih sehat

Tidak ada auto-buy / auto-sell. Semua exit tetap manual.

Telegram V2.5 sekarang juga alert saat state berubah ke:
- `HOLD`
- `RECOVERY`
- `WARNING_PULLBACK`
- `EXIT_WARNING`
- `EXIT_NOW`

History modal menampilkan `LP vs BUY` dan `MC vs BUY` untuk token post-entry.


## V2.7 — Calibration / Benchmark

Tidak ada tab baru.

Klik row token pada SCANNER. Modal history sekarang punya section `CALIBRATION` yang membandingkan latest Scanner dengan latest GMGN Basic/Security.

Dibandingkan:
- Pair LP
- Market Cap
- Buy Ratio 5M
- Buy Ratio 1H
- Scanner Decision vs GMGN Quick Verdict
- Scanner positive state vs GMGN Security

Status:
- `MATCH` — cukup konsisten
- `DATA_GAP` — GMGN belum tersedia
- `CHECK_VARIANCE` — ada perbedaan menengah
- `REVIEW_GAP` — perbedaan besar
- `BLOCK_CONFLICT` — Scanner positif tetapi GMGN Security BLOCK

Penting:
V2.7 hanya **mengobservasi dan menandai gap**.
Calibration belum mengubah Score/BUY/EXIT threshold secara otomatis.
Tujuannya mengumpulkan benchmark terlebih dahulu sebelum tuning V2.8.


## V2.8 — Visual Refresh

Logic trading/scoring tidak diubah.

Visual refresh:
- premium dark terminal palette
- clearer hierarchy and card accents
- BUY/HOLD/RECOVERY = green
- STRONG WATCH = cyan
- EARLY WATCH = purple
- WAIT / pullback = yellow
- EXIT WARNING = orange
- EXIT NOW / SKIP = red
- score gradient styling
- LOW/MEDIUM/HIGH risk colors
- stronger hover state for clickable scanner rows
- updated modal styling
- footer/signature retained


## V2.9 — Telegram BUY Delivery Fix

Masalah:
Telegram sebelumnya membandingkan state sekarang dengan scan sebelumnya.
Kalau BUY sudah tersimpan tetapi run tersebut tidak berhasil mengirim Telegram,
scan berikutnya melihat BUY -> BUY dan menganggap alert tidak perlu dikirim lagi.

Fix:
- PostgreSQL table baru `telegram_state`
- suppression berdasarkan **last successfully delivered state**
- BUY akan terus eligible untuk alert sampai BUY benar-benar berhasil terkirim
- state baru dicatat setelah Telegram API mengembalikan success
- Telegram failure tidak menggagalkan scanner

Contoh:
- STRONG_WATCH terkirim → latch = STRONG_WATCH
- BUY terjadi, Telegram error → latch tetap STRONG_WATCH
- scan berikut BUY lagi → Telegram mencoba BUY lagi
- BUY berhasil → latch = BUY
- scan BUY berikutnya → suppressed sebagai already delivered

Tidak ada variable Railway baru.


## V3.0 — Fast STRONG_WATCH Confirmation

Problem:
STRONG_WATCH previously had to wait until the next 5-minute cron run before BUY could confirm.

Fix:
- regular cron remains every 5 minutes
- if a token becomes `STRONG_WATCH`, the same cron run keeps running
- after 120 seconds, only STRONG_WATCH tokens are scanned again
- BUY can confirm on that second strong scan

Flow:
`STRONG_WATCH -> wait 2 min -> FAST_CONFIRM -> BUY or remain STRONG_WATCH`

BUY is now 2-scan confirmation:
- current score >= 80
- BR 5M >= 1.50
- BR 1H >= 1.30
- previous decision = STRONG_WATCH
- no extreme MC jump

This does NOT make BUY instant from one snapshot.

Optional Railway variable:
`STRONG_WATCH_RECHECK_SECONDS=120`

Default is 120 seconds if the variable is not set.
