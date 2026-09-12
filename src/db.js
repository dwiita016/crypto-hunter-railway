import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      address TEXT PRIMARY KEY,
      chain TEXT NOT NULL DEFAULT 'solana',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      address TEXT PRIMARY KEY REFERENCES tokens(address) ON DELETE CASCADE,
      chain TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      pair_address TEXT,
      pair_count INTEGER NOT NULL DEFAULT 0,
      tradable_pair_count INTEGER NOT NULL DEFAULT 0,
      pair_lp_usd DOUBLE PRECISION,
      total_lp_usd DOUBLE PRECISION,
      market_cap_usd DOUBLE PRECISION,
      volume_24h_usd DOUBLE PRECISION,
      buy_ratio_5m DOUBLE PRECISION,
      buy_ratio_1h DOUBLE PRECISION,
      buy_ratio_6h DOUBLE PRECISION,
      buy_ratio_24h DOUBLE PRECISION,
      price_change_5m DOUBLE PRECISION,
      price_change_1h DOUBLE PRECISION,
      price_change_6h DOUBLE PRECISION,
      price_change_24h DOUBLE PRECISION,
      score DOUBLE PRECISION,
      risk TEXT,
      entry_state TEXT,
      trajectory TEXT,
      signal TEXT,
      decision TEXT,
      reason TEXT,
      raw JSONB,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id BIGSERIAL PRIMARY KEY,
      address TEXT NOT NULL,
      chain TEXT NOT NULL,
      decision TEXT,
      signal TEXT,
      pair_address TEXT,
      pair_lp_usd DOUBLE PRECISION,
      market_cap_usd DOUBLE PRECISION,
      volume_24h_usd DOUBLE PRECISION,
      score DOUBLE PRECISION,
      snapshot JSONB,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_scan_history_address_time
      ON scan_history(address, scanned_at DESC);

    CREATE TABLE IF NOT EXISTS gmgn_basic (
      address TEXT PRIMARY KEY,
      chain TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      price_usd DOUBLE PRECISION,
      market_cap_usd DOUBLE PRECISION,
      liquidity_usd DOUBLE PRECISION,
      holder_count INTEGER,
      smart_wallets INTEGER,
      kol_wallets INTEGER,
      top10_rate DOUBLE PRECISION,
      bundler_rate DOUBLE PRECISION,
      rat_rate DOUBLE PRECISION,
      dev_status TEXT,
      buy_ratio_5m DOUBLE PRECISION,
      buy_ratio_1h DOUBLE PRECISION,
      buy_usd_ratio_5m DOUBLE PRECISION,
      buy_usd_ratio_1h DOUBLE PRECISION,
      volume_5m_usd DOUBLE PRECISION,
      volume_1h_usd DOUBLE PRECISION,
      age_hours DOUBLE PRECISION,
      quick_score DOUBLE PRECISION,
      quick_verdict TEXT,
      quick_reason TEXT,
      twitter TEXT,
      website TEXT,
      telegram TEXT,
      gmgn_url TEXT,
      raw JSONB,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function upsertToken(address, chain = "solana") {
  const a = String(address || "").trim();
  if (!a) throw new Error("Token address is required.");

  await pool.query(`
    INSERT INTO tokens(address, chain, enabled)
    VALUES ($1, $2, TRUE)
    ON CONFLICT(address)
    DO UPDATE SET
      chain = EXCLUDED.chain,
      enabled = TRUE,
      updated_at = NOW()
  `, [a, String(chain || "solana").toLowerCase()]);

  return { address: a, chain };
}

export async function disableToken(address) {
  await pool.query(
    `UPDATE tokens SET enabled = FALSE, updated_at = NOW() WHERE address = $1`,
    [address]
  );
  await pool.query(`DELETE FROM scan_results WHERE address = $1`, [address]);
}

export async function listTokens(enabledOnly = false) {
  const { rows } = await pool.query(`
    SELECT address, chain, enabled, created_at, updated_at
    FROM tokens
    ${enabledOnly ? "WHERE enabled = TRUE" : ""}
    ORDER BY created_at ASC
  `);
  return rows;
}

export async function getHistory(address, limit = 4) {
  const n = Math.max(1, Math.min(20, Number(limit) || 4));
  const { rows } = await pool.query(`
    SELECT snapshot, decision, signal, score, pair_lp_usd, market_cap_usd, scanned_at
    FROM scan_history
    WHERE address = $1
    ORDER BY scanned_at DESC
    LIMIT $2
  `, [address, n]);
  return rows;
}

export async function saveResult(result) {
  const r = result;

  await pool.query(`
    INSERT INTO scan_results(
      address, chain, symbol, name, pair_address,
      pair_count, tradable_pair_count,
      pair_lp_usd, total_lp_usd, market_cap_usd, volume_24h_usd,
      buy_ratio_5m, buy_ratio_1h, buy_ratio_6h, buy_ratio_24h,
      price_change_5m, price_change_1h, price_change_6h, price_change_24h,
      score, risk, entry_state, trajectory, signal, decision, reason, raw, scanned_at
    )
    VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW()
    )
    ON CONFLICT(address)
    DO UPDATE SET
      chain = EXCLUDED.chain,
      symbol = EXCLUDED.symbol,
      name = EXCLUDED.name,
      pair_address = EXCLUDED.pair_address,
      pair_count = EXCLUDED.pair_count,
      tradable_pair_count = EXCLUDED.tradable_pair_count,
      pair_lp_usd = EXCLUDED.pair_lp_usd,
      total_lp_usd = EXCLUDED.total_lp_usd,
      market_cap_usd = EXCLUDED.market_cap_usd,
      volume_24h_usd = EXCLUDED.volume_24h_usd,
      buy_ratio_5m = EXCLUDED.buy_ratio_5m,
      buy_ratio_1h = EXCLUDED.buy_ratio_1h,
      buy_ratio_6h = EXCLUDED.buy_ratio_6h,
      buy_ratio_24h = EXCLUDED.buy_ratio_24h,
      price_change_5m = EXCLUDED.price_change_5m,
      price_change_1h = EXCLUDED.price_change_1h,
      price_change_6h = EXCLUDED.price_change_6h,
      price_change_24h = EXCLUDED.price_change_24h,
      score = EXCLUDED.score,
      risk = EXCLUDED.risk,
      entry_state = EXCLUDED.entry_state,
      trajectory = EXCLUDED.trajectory,
      signal = EXCLUDED.signal,
      decision = EXCLUDED.decision,
      reason = EXCLUDED.reason,
      raw = EXCLUDED.raw,
      scanned_at = NOW()
  `, [
    r.address, r.chain, r.symbol, r.name, r.pairAddress,
    r.pairCount, r.tradablePairCount,
    r.pairLpUsd, r.totalLpUsd, r.marketCapUsd, r.volume24hUsd,
    r.buyRatio5m, r.buyRatio1h, r.buyRatio6h, r.buyRatio24h,
    r.priceChange5m, r.priceChange1h, r.priceChange6h, r.priceChange24h,
    r.score, r.risk, r.entryState, r.trajectory, r.signal, r.decision, r.reason,
    r.raw
  ]);

  await pool.query(`
    INSERT INTO scan_history(
      address, chain, decision, signal, pair_address,
      pair_lp_usd, market_cap_usd, volume_24h_usd, score, snapshot
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [
    r.address, r.chain, r.decision, r.signal, r.pairAddress,
    r.pairLpUsd, r.marketCapUsd, r.volume24hUsd, r.score, r
  ]);
}

export async function getResults() {
  const { rows } = await pool.query(`
    SELECT *
    FROM scan_results
    ORDER BY
      CASE decision
        WHEN 'BUY' THEN 1
        WHEN 'STRONG_WATCH' THEN 2
        WHEN 'EARLY_WATCH' THEN 3
        WHEN 'WATCH' THEN 4
        WHEN 'WAIT' THEN 5
        ELSE 6
      END,
      score DESC NULLS LAST,
      scanned_at DESC
  `);
  return rows;
}

export async function saveGmgnBasic(x) {
  await pool.query(`
    INSERT INTO gmgn_basic(
      address, chain, symbol, name,
      price_usd, market_cap_usd, liquidity_usd, holder_count,
      smart_wallets, kol_wallets, top10_rate, bundler_rate, rat_rate,
      dev_status, buy_ratio_5m, buy_ratio_1h, buy_usd_ratio_5m, buy_usd_ratio_1h,
      volume_5m_usd, volume_1h_usd, age_hours,
      quick_score, quick_verdict, quick_reason,
      twitter, website, telegram, gmgn_url, raw, scanned_at
    )
    VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW()
    )
    ON CONFLICT(address)
    DO UPDATE SET
      chain=EXCLUDED.chain, symbol=EXCLUDED.symbol, name=EXCLUDED.name,
      price_usd=EXCLUDED.price_usd, market_cap_usd=EXCLUDED.market_cap_usd,
      liquidity_usd=EXCLUDED.liquidity_usd, holder_count=EXCLUDED.holder_count,
      smart_wallets=EXCLUDED.smart_wallets, kol_wallets=EXCLUDED.kol_wallets,
      top10_rate=EXCLUDED.top10_rate, bundler_rate=EXCLUDED.bundler_rate,
      rat_rate=EXCLUDED.rat_rate, dev_status=EXCLUDED.dev_status,
      buy_ratio_5m=EXCLUDED.buy_ratio_5m, buy_ratio_1h=EXCLUDED.buy_ratio_1h,
      buy_usd_ratio_5m=EXCLUDED.buy_usd_ratio_5m, buy_usd_ratio_1h=EXCLUDED.buy_usd_ratio_1h,
      volume_5m_usd=EXCLUDED.volume_5m_usd, volume_1h_usd=EXCLUDED.volume_1h_usd,
      age_hours=EXCLUDED.age_hours, quick_score=EXCLUDED.quick_score,
      quick_verdict=EXCLUDED.quick_verdict, quick_reason=EXCLUDED.quick_reason,
      twitter=EXCLUDED.twitter, website=EXCLUDED.website, telegram=EXCLUDED.telegram,
      gmgn_url=EXCLUDED.gmgn_url, raw=EXCLUDED.raw, scanned_at=NOW()
  `, [
    x.address, x.chain, x.symbol, x.name,
    x.priceUsd, x.marketCapUsd, x.liquidityUsd, x.holderCount,
    x.smartWallets, x.kolWallets, x.top10Rate, x.bundlerRate, x.ratRate,
    x.devStatus, x.buyRatio5m, x.buyRatio1h, x.buyUsdRatio5m, x.buyUsdRatio1h,
    x.volume5mUsd, x.volume1hUsd, x.ageHours,
    x.quickScore, x.quickVerdict, x.quickReason,
    x.twitter, x.website, x.telegram, x.gmgnUrl, x.raw
  ]);
}

export async function getGmgnBasic() {
  const { rows } = await pool.query(`
    SELECT *
    FROM gmgn_basic
    ORDER BY
      CASE quick_verdict
        WHEN 'REVIEW_NOW' THEN 1
        WHEN 'REVIEW' THEN 2
        WHEN 'LOW_PRIORITY' THEN 3
        ELSE 4
      END,
      quick_score DESC NULLS LAST,
      scanned_at DESC
  `);
  return rows;
}
