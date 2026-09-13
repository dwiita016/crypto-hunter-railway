function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function snap(row) {
  return row?.snapshot || {};
}

function decisionOf(row) {
  const s = snap(row);
  return String(
    row?.decision ||
    s.decision ||
    s.entryState ||
    ""
  ).trim().toUpperCase();
}

function firstBuyBaseline(history) {
  if (!Array.isArray(history)) return null;

  /*
   * history arrives newest -> oldest.
   * Find the most recent BUY and use that snapshot as the entry baseline.
   */
  for (const row of history) {
    if (decisionOf(row) === "BUY") {
      const s = snap(row);
      return {
        row,
        score: n(row.score ?? s.score),
        pairLpUsd: n(row.pair_lp_usd ?? s.pairLpUsd),
        marketCapUsd: n(row.market_cap_usd ?? s.marketCapUsd),
        volume24hUsd: n(row.volume_24h_usd ?? s.volume24hUsd),
        buyRatio5m: n(s.buyRatio5m),
        buyRatio1h: n(s.buyRatio1h),
        priceChange5m: n(s.priceChange5m),
        priceChange1h: n(s.priceChange1h),
        scannedAt: row.scanned_at || null
      };
    }
  }

  return null;
}

function ratio(now, base) {
  const a = n(now), b = n(base);
  if (a === null || b === null || b <= 0) return null;
  return a / b;
}

function previousDecision(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return decisionOf(history[0]);
}

function wasWarningState(state) {
  return [
    "WARNING_PULLBACK",
    "EXIT_WARNING",
    "EXIT_NOW"
  ].includes(String(state || "").toUpperCase());
}

export function applyPostEntryMonitor(current, classified, history = []) {
  const baseline = firstBuyBaseline(history);

  // Not post-entry yet; leave pre-entry trajectory logic untouched.
  if (!baseline) {
    return {
      ...classified,
      postEntryActive: false,
      entryBaseline: null
    };
  }

  const prev = previousDecision(history);

  const lpVsBuy = ratio(current.pairLpUsd, baseline.pairLpUsd);
  const mcVsBuy = ratio(current.marketCapUsd, baseline.marketCapUsd);

  const br5 = n(current.buyRatio5m) ?? 0;
  const br1 = n(current.buyRatio1h) ?? 0;
  const p5 = n(current.priceChange5m) ?? 0;
  const p1 = n(current.priceChange1h) ?? 0;

  const metrics = {
    lpVsBuy,
    mcVsBuy,
    buyRatio5m: br5,
    buyRatio1h: br1,
    priceChange5m: p5,
    priceChange1h: p1
  };

  /*
   * EXIT_NOW:
   * Structural breakdown, not a small pullback.
   * Any one severe condition is enough.
   */
  const exitNow =
    current.noTradablePair === true ||
    (lpVsBuy !== null && lpVsBuy < 0.50) ||
    (br5 < 0.45 && br1 < 0.70) ||
    (p5 <= -18) ||
    (p1 <= -35);

  if (exitNow) {
    return {
      ...classified,
      risk: "HIGH",
      entryState: "EXIT_NOW",
      trajectory: "MOMENTUM_BREAK",
      signal: "EXIT_NOW",
      decision: "EXIT_NOW",
      reason:
        "Post-entry breakdown: liquidity/momentum melemah tajam dibanding baseline BUY. Prioritaskan exit manual.",
      postEntryActive: true,
      entryBaseline: baseline,
      postEntryMetrics: metrics
    };
  }

  /*
   * EXIT_WARNING:
   * Continued weakening after entry. Still not auto-sell.
   */
  const exitWarning =
    (lpVsBuy !== null && lpVsBuy < 0.70) ||
    (br5 < 0.70 && br1 < 0.90) ||
    (p5 <= -10 && p1 <= -15);

  if (exitWarning) {
    return {
      ...classified,
      risk: "HIGH",
      entryState: "EXIT_WARNING",
      trajectory: "SHARP_PULLBACK",
      signal: "EXIT_WARNING",
      decision: "EXIT_WARNING",
      reason:
        "Post-entry melemah berlanjut. Belum auto-sell; siapkan exit manual jika scan berikutnya tidak pulih.",
      postEntryActive: true,
      entryBaseline: baseline,
      postEntryMetrics: metrics
    };
  }

  /*
   * WARNING_PULLBACK:
   * First meaningful deterioration while structure still survives.
   */
  const warningPullback =
    (lpVsBuy !== null && lpVsBuy < 0.85) ||
    br5 < 0.90 ||
    p5 <= -6 ||
    p1 <= -10;

  if (warningPullback) {
    return {
      ...classified,
      risk: "MEDIUM",
      entryState: "WARNING_PULLBACK",
      trajectory: "WARNING_PULLBACK",
      signal: "WARNING_PULLBACK",
      decision: "WARNING_PULLBACK",
      reason:
        "Post-entry pullback terdeteksi, tetapi belum breakdown. Pantau scan berikutnya sebelum mengambil keputusan exit.",
      postEntryActive: true,
      entryBaseline: baseline,
      postEntryMetrics: metrics
    };
  }

  /*
   * RECOVERY:
   * Previous scan was warning/exit-warning but current structure recovers.
   */
  const recovery =
    wasWarningState(prev) &&
    (lpVsBuy === null || lpVsBuy >= 0.85) &&
    br5 >= 1.05 &&
    br1 >= 1.00 &&
    p5 > -3;

  if (recovery) {
    return {
      ...classified,
      risk: "LOW",
      entryState: "RECOVERY",
      trajectory: "RECOVERY_CONFIRMED",
      signal: "RECOVERY",
      decision: "RECOVERY",
      reason:
        "Momentum pulih setelah pullback; liquidity tetap sehat dan buy pressure kembali mendukung.",
      postEntryActive: true,
      entryBaseline: baseline,
      postEntryMetrics: metrics
    };
  }

  /*
   * HOLD:
   * Default healthy post-entry state.
   */
  return {
    ...classified,
    risk: "LOW",
    entryState: "HOLD",
    trajectory: "POST_ENTRY_HEALTHY",
    signal: "HOLD",
    decision: "HOLD",
    reason:
      "Post-entry masih sehat: belum ada breakdown liquidity atau momentum yang memerlukan exit.",
    postEntryActive: true,
    entryBaseline: baseline,
    postEntryMetrics: metrics
  };
}
