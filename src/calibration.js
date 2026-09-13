function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pctDiff(a, b) {
  const x = n(a), y = n(b);
  if (x === null || y === null || x === 0 || y === 0) return null;
  return Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y));
}

function ratioDiff(a, b) {
  const x = n(a), y = n(b);
  if (x === null || y === null) return null;
  return Math.abs(x - y);
}

export function buildCalibration(row) {
  if (!row) {
    return {
      status: "NO_SCANNER_DATA",
      severity: "INFO",
      flags: [],
      metrics: {}
    };
  }

  const flags = [];
  const lpDiff = pctDiff(row.pair_lp_usd, row.gmgn_liquidity_usd);
  const mcDiff = pctDiff(row.market_cap_usd, row.gmgn_market_cap_usd);
  const br5Diff = ratioDiff(row.buy_ratio_5m, row.gmgn_buy_ratio_5m);
  const br1Diff = ratioDiff(row.buy_ratio_1h, row.gmgn_buy_ratio_1h);

  if (row.gmgn_symbol == null) {
    flags.push({
      code: "NO_GMGN_DATA",
      severity: "INFO",
      message: "Belum ada GMGN Basic Info untuk token ini."
    });
  }

  if (lpDiff !== null && lpDiff > 0.35) {
    flags.push({
      code: "LP_DIVERGENCE",
      severity: "HIGH",
      message: `Pair LP berbeda ${(lpDiff * 100).toFixed(0)}% antara Scanner dan GMGN.`
    });
  } else if (lpDiff !== null && lpDiff > 0.20) {
    flags.push({
      code: "LP_VARIANCE",
      severity: "MEDIUM",
      message: `Pair LP berbeda ${(lpDiff * 100).toFixed(0)}%.`
    });
  }

  if (mcDiff !== null && mcDiff > 0.40) {
    flags.push({
      code: "MC_DIVERGENCE",
      severity: "HIGH",
      message: `Market Cap berbeda ${(mcDiff * 100).toFixed(0)}% antara Scanner dan GMGN.`
    });
  } else if (mcDiff !== null && mcDiff > 0.25) {
    flags.push({
      code: "MC_VARIANCE",
      severity: "MEDIUM",
      message: `Market Cap berbeda ${(mcDiff * 100).toFixed(0)}%.`
    });
  }

  if (br5Diff !== null && br5Diff > 1.00) {
    flags.push({
      code: "BR5M_DIVERGENCE",
      severity: "MEDIUM",
      message: `Buy Ratio 5M berbeda ${br5Diff.toFixed(2)}x.`
    });
  }

  if (br1Diff !== null && br1Diff > 0.75) {
    flags.push({
      code: "BR1H_DIVERGENCE",
      severity: "MEDIUM",
      message: `Buy Ratio 1H berbeda ${br1Diff.toFixed(2)}x.`
    });
  }

  const scannerPositive =
    ["EARLY_WATCH", "STRONG_WATCH", "BUY", "HOLD", "RECOVERY"]
      .includes(String(row.decision || "").toUpperCase());

  const gmgnPositive =
    ["REVIEW", "REVIEW_NOW"]
      .includes(String(row.quick_verdict || "").toUpperCase());

  if (scannerPositive && row.security_status === "BLOCK") {
    flags.push({
      code: "SECURITY_CONFLICT",
      severity: "CRITICAL",
      message: "Scanner positif tetapi GMGN Security = BLOCK."
    });
  }

  if (scannerPositive && row.security_status === "CAUTION") {
    flags.push({
      code: "SECURITY_CAUTION_CONFLICT",
      severity: "HIGH",
      message: "Scanner positif tetapi GMGN Security = CAUTION."
    });
  }

  if (scannerPositive && row.gmgn_symbol != null && !gmgnPositive) {
    flags.push({
      code: "DECISION_GAP",
      severity: "MEDIUM",
      message: `Scanner = ${row.decision}, GMGN = ${row.quick_verdict || "—"}.`
    });
  }

  if (!scannerPositive && gmgnPositive) {
    flags.push({
      code: "OPPORTUNITY_GAP",
      severity: "INFO",
      message: `GMGN = ${row.quick_verdict}, Scanner = ${row.decision}.`
    });
  }

  const rank = { INFO: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const topSeverity = flags.reduce(
    (best, x) => rank[x.severity] > rank[best] ? x.severity : best,
    "INFO"
  );

  let status = "MATCH";
  if (flags.some(x => x.severity === "CRITICAL")) status = "BLOCK_CONFLICT";
  else if (flags.some(x => x.severity === "HIGH")) status = "REVIEW_GAP";
  else if (flags.some(x => x.severity === "MEDIUM")) status = "CHECK_VARIANCE";
  else if (flags.some(x => x.code === "NO_GMGN_DATA")) status = "DATA_GAP";

  return {
    status,
    severity: topSeverity,
    flags,
    metrics: {
      lpDiffPct: lpDiff === null ? null : lpDiff * 100,
      mcDiffPct: mcDiff === null ? null : mcDiff * 100,
      buyRatio5mDiff: br5Diff,
      buyRatio1hDiff: br1Diff
    }
  };
}
