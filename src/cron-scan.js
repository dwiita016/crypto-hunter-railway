import { initDb, listTokens, pool } from "./db.js";
import { scanToken } from "./scanner.js";
import { config } from "./config.js";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scanOne(token, label = "SCAN") {
  const r = await scanToken(token.address, token.chain);

  console.log(
    `[${label}] ${r.symbol} ${r.decision} ` +
    `LP=${r.pairLpUsd} live=${r.tradablePairCount}/${r.pairCount} signal=${r.signal}`
  );

  return r;
}

async function main() {
  await initDb();
  const tokens = await listTokens(true);

  console.log(`[SCAN] active tokens=${tokens.length}`);

  let ok = 0;
  let failed = 0;
  const fastConfirm = [];

  for (const token of tokens) {
    try {
      const r = await scanOne(token, "SCAN");
      ok++;

      if (r.decision === "STRONG_WATCH") {
        fastConfirm.push(token);
      }
    } catch (err) {
      failed++;
      console.error(`[SCAN] ${token.address} FAILED`, err?.message || err);
    }
  }

  if (fastConfirm.length > 0) {
    const waitSeconds = Math.max(
      30,
      Number(config.strongWatchRecheckSeconds || 120)
    );

    console.log(
      `[FAST_CONFIRM] ${fastConfirm.length} STRONG_WATCH token(s). ` +
      `Recheck in ${waitSeconds}s.`
    );

    await sleep(waitSeconds * 1000);

    for (const token of fastConfirm) {
      try {
        await scanOne(token, "FAST_CONFIRM");
      } catch (err) {
        console.error(
          `[FAST_CONFIRM] ${token.address} FAILED`,
          err?.message || err
        );
      }
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
