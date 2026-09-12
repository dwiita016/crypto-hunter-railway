import {
  fetchDexPairs,
  selectCanonicalPair,
  normalizePair
} from "./providers/dexscreener.js";
import { saveResult } from "./db.js";

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function scoreCoin(c) {
  if (c.noTradablePair) return 0;

  let s = 35;

  if (c.pairLpUsd >= 100000) s += 18;
  else if (c.pairLpUsd >= 50000) s += 13;
  else if (c.pairLpUsd >= 20000) s += 8;
  else if (c.pairLpUsd >= 5000) s += 3;

  if (c.volume24hUsd >= 1000000) s += 12;
  else if (c.volume24hUsd >= 250000) s += 8;
  else if (c.volume24hUsd >= 50000) s += 4;

  const br5 = c.buyRatio5m ?? 0;
  const br1 = c.buyRatio1h ?? 0;

  if (br5 >= 1.5) s += 10;
  else if (br5 >= 1.15) s += 5;

  if (br1 >= 1.4) s += 8;
  else if (br1 >= 1.1) s += 4;

  if ((c.priceChange1h ?? 0) <= -20) s -= 18;
  if ((c.priceChange24h ?? 0) <= -40) s -= 15;
  if ((c.priceChange5m ?? 0) <= -10) s -= 12;

  return Math.round(clamp(s, 0, 100) * 100) / 100;
}

function classify(c) {
  if (c.noTradablePair) {
    return {
      risk: "HIGH",
      entryState: "SKIP",
      trajectory: "SKIP",
      signal: "NO_TRADABLE_PAIR",
      decision: "SKIP",
      reason: "Tidak ada pool dengan liquidity dan aktivitas trading live yang memenuhi minimum tradable."
    };
  }

  // Hard negative momentum guard.
  if ((c.priceChange1h ?? 0) <= -20 && (c.priceChange5m ?? 0) <= 0) {
    return {
      risk: "HIGH",
      entryState: "SKIP",
      trajectory: "BREAKDOWN",
      signal: "NEGATIVE_MOMENTUM",
      decision: "SKIP",
      reason: "Momentum 1H turun tajam dan belum ada pemulihan 5M."
    };
  }

  const score = scoreCoin(c);
  const br5 = c.buyRatio5m ?? 0;
  const br1 = c.buyRatio1h ?? 0;

  if (score >= 78 && br5 >= 1.5 && br1 >= 1.3) {
    return {
      risk: "LOW",
      entryState: "STRONG_WATCH",
      trajectory: "MOMENTUM_BUILDING",
      signal: "STRONG_WATCH",
      decision: "STRONG_WATCH",
      reason: "Liquidity live sehat dan tekanan buy multi-timeframe cukup kuat."
    };
  }

  if (score >= 58 && br5 >= 1.15) {
    return {
      risk: "LOW",
      entryState: "EARLY_WATCH",
      trajectory: "EARLY_WATCH",
      signal: "POTENTIAL_EARLY_ENTRY",
      decision: "EARLY_WATCH",
      reason: "Kandidat awal; butuh konfirmasi scan berikutnya sebelum entry."
    };
  }

  return {
    risk: score >= 45 ? "MEDIUM" : "HIGH",
    entryState: "WAIT",
    trajectory: "WAIT",
    signal: "NO_ENTRY",
    decision: "WAIT",
    reason: "Belum cukup kuat untuk WATCH/BUY."
  };
}

export async function scanToken(address, chain = "solana", { persist = true } = {}) {
  const pairs = await fetchDexPairs(address);
  const selection = selectCanonicalPair(pairs, chain);
  const c = normalizePair(address, chain, selection, pairs);
  const score = scoreCoin(c);
  const cls = classify(c);

  const result = {
    ...c,
    score,
    ...cls,
    raw: {
      source: c.source,
      pairSelectionReason: c.pairSelectionReason,
      selectedPair: c.rawPair
    }
  };

  delete result.rawPair;

  if (persist) await saveResult(result);
  return result;
}
