function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function ratio(now, prev) {
  const a = n(now), b = n(prev);
  if (a === null || b === null || b <= 0) return null;
  return a / b;
}

function snap(row) {
  return row?.snapshot || {};
}

const watchStates = new Set(["EARLY_WATCH", "STRONG_WATCH", "BUY"]);

export function applyTrajectory(current, base, history = []) {
  if (base.decision === "SKIP") return { ...base, trajectory: base.trajectory || "SKIP" };

  const p1 = history[0] ? snap(history[0]) : null;
  const p2 = history[1] ? snap(history[1]) : null;

  if (!p1) {
    return {
      ...base,
      trajectory: base.decision === "EARLY_WATCH" ? "EARLY_WATCH" : "BASELINE",
      reason: `${base.reason} Baseline pertama; tunggu konfirmasi scan berikutnya.`
    };
  }

  const scoreDelta = (n(current.score) ?? 0) - (n(p1.score) ?? 0);
  const lpRatio = ratio(current.pairLpUsd, p1.pairLpUsd);
  const mcRatio = ratio(current.marketCapUsd, p1.marketCapUsd);
  const br5 = n(current.buyRatio5m) ?? 0;
  const br1 = n(current.buyRatio1h) ?? 0;
  const prevDecision = String(p1.decision || history[0]?.decision || "");
  const prev2Decision = p2 ? String(p2.decision || history[1]?.decision || "") : "";

  // Structural deterioration overrides a prior watch state.
  if ((lpRatio !== null && lpRatio < 0.60) || br5 < 0.70) {
    return {
      ...base,
      risk: "HIGH",
      entryState: "SKIP",
      trajectory: "MOMENTUM_BREAK",
      signal: "EXIT_WARNING",
      decision: "SKIP",
      reason: `Trajectory memburuk: ${lpRatio !== null && lpRatio < 0.60 ? "LP turun >40%" : "buy pressure 5M <0.70x"}.`
    };
  }

  if (watchStates.has(prevDecision) && (scoreDelta <= -10 || (lpRatio !== null && lpRatio < 0.75))) {
    return {
      ...base,
      entryState: "WAIT",
      trajectory: "WARNING_PULLBACK",
      signal: "WARNING_PULLBACK",
      decision: "WAIT",
      reason: "Kandidat sebelumnya melemah; entry ditahan sampai ada recovery."
    };
  }

  const improving =
    scoreDelta >= 3 &&
    (lpRatio === null || lpRatio >= 0.90) &&
    br5 >= 1.10;

  const strongNow =
    current.score >= 72 &&
    br5 >= 1.35 &&
    br1 >= 1.20 &&
    (lpRatio === null || lpRatio >= 0.90);

  if (strongNow && ["EARLY_WATCH", "STRONG_WATCH"].includes(prevDecision)) {
    // BUY needs two prior confirmations; one spike is not enough.
    if (
      current.score >= 80 &&
      br5 >= 1.50 &&
      br1 >= 1.30 &&
      prevDecision === "STRONG_WATCH" &&
      prev2Decision === "STRONG_WATCH" &&
      (mcRatio === null || mcRatio < 1.80)
    ) {
      return {
        ...base,
        risk: "LOW",
        entryState: "BUY",
        trajectory: "RECOVERY_CONFIRMED",
        signal: "BUY_CONFIRMED_3_SCAN",
        decision: "BUY",
        reason: "Momentum kuat terkonfirmasi pada 3 scan; LP tetap sehat dan tidak terlihat lonjakan MC ekstrem."
      };
    }

    return {
      ...base,
      risk: "LOW",
      entryState: "STRONG_WATCH",
      trajectory: "MOMENTUM_BUILDING",
      signal: "STRONG_WATCH_CONFIRMED",
      decision: "STRONG_WATCH",
      reason: "Momentum kuat terkonfirmasi minimal 2 scan; tunggu konfirmasi lanjutan sebelum BUY."
    };
  }

  if (improving && ["WAIT", "EARLY_WATCH"].includes(prevDecision)) {
    return {
      ...base,
      entryState: "EARLY_WATCH",
      trajectory: "MOMENTUM_BUILDING",
      signal: "EARLY_WATCH_CONFIRMED",
      decision: "EARLY_WATCH",
      reason: "Score dan buy pressure membaik dibanding scan sebelumnya; kandidat layak dipantau."
    };
  }

  if (watchStates.has(prevDecision) && scoreDelta >= -4 && br5 >= 1.0) {
    return {
      ...base,
      entryState: prevDecision === "BUY" ? "STRONG_WATCH" : prevDecision,
      trajectory: "STABLE",
      signal: "WATCH_HOLD",
      decision: prevDecision === "BUY" ? "STRONG_WATCH" : prevDecision,
      reason: "Kondisi relatif stabil; belum ada konfirmasi baru untuk upgrade."
    };
  }

  return {
    ...base,
    trajectory: "STABLE",
    reason: `${base.reason} Belum ada trajectory confirmation.`
  };
}
