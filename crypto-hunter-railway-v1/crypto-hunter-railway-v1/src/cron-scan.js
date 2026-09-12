import { initDb, listTokens, pool } from "./db.js";
import { scanToken } from "./scanner.js";

async function main() {
  await initDb();
  const tokens = await listTokens(true);

  console.log(`[SCAN] active tokens=${tokens.length}`);

  let ok = 0;
  let failed = 0;

  for (const token of tokens) {
    try {
      const r = await scanToken(token.address, token.chain);
      ok++;
      console.log(
        `[SCAN] ${r.symbol} ${r.decision} ` +
        `LP=${r.pairLpUsd} live=${r.tradablePairCount}/${r.pairCount} signal=${r.signal}`
      );
    } catch (err) {
      failed++;
      console.error(`[SCAN] ${token.address} FAILED`, err?.message || err);
    }
  }

  console.log(`[SCAN] COMPLETE ok=${ok} failed=${failed}`);
  await pool.end();
}

main().catch(async err => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
