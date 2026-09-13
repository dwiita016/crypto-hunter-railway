import { config } from "./config.js";

const ALERT_STATES = new Set([
  "EARLY_WATCH",
  "STRONG_WATCH",
  "BUY",
  "HOLD",
  "RECOVERY",
  "WARNING_PULLBACK",
  "EXIT_WARNING",
  "EXIT_NOW",
  "SKIP"
]);

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function num(v, d = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function stateOf(result) {
  return String(
    result?.decision ||
    result?.signal ||
    result?.entryState ||
    ""
  ).trim().toUpperCase();
}

function previousState(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const h = history[0] || {};
  const s = h.snapshot || {};
  return String(
    h.decision ||
    s.decision ||
    s.signal ||
    s.entryState ||
    ""
  ).trim().toUpperCase();
}

function shouldAlert(result, history) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return { send: false, reason: "TELEGRAM_NOT_CONFIGURED" };
  }

  const current = stateOf(result);
  const previous = previousState(history);

  if (!ALERT_STATES.has(current)) {
    return { send: false, reason: "STATE_NOT_ALERTABLE", current, previous };
  }

  if (current === previous) {
    return { send: false, reason: "STATE_UNCHANGED", current, previous };
  }

  /*
   * Avoid noisy first-scan SKIP alerts.
   * First-scan positive states remain alertable.
   */
  if (!previous && current === "SKIP") {
    return { send: false, reason: "FIRST_SCAN_SKIP_SUPPRESSED", current, previous };
  }

  return { send: true, reason: "STATE_CHANGED", current, previous };
}

function buildMessage(result, current, previous) {
  const symbol = esc(result.symbol || "?");
  const transition = previous
    ? `${esc(previous)} → <b>${esc(current)}</b>`
    : `<b>${esc(current)}</b>`;

  const risk = esc(result.risk || "—");
  const trajectory = esc(result.trajectory || "—");
  const signal = esc(result.signal || "—");
  const reason = esc(result.reason || "—");

  return [
    `🔎 <b>Crypto Hunter</b>`,
    ``,
    `<b>${symbol}</b>`,
    `State: ${transition}`,
    `Score: <b>${num(result.score)}</b>`,
    `Risk: ${risk}`,
    `Trajectory: ${trajectory}`,
    `Signal: ${signal}`,
    ``,
    `LP: ${money(result.pairLpUsd)}`,
    `MC: ${money(result.marketCapUsd)}`,
    `BR 5M: ${num(result.buyRatio5m)}x`,
    `BR 1H: ${num(result.buyRatio1h)}x`,
    `Live/All: ${result.tradablePairCount ?? "—"}/${result.pairCount ?? "—"}`,
    ``,
    `Reason: ${reason}`,
    ``,
    `<b>Source: Railway</b>`
  ].join("\n");
}

export async function sendStateChangeAlert(result, history = []) {
  const gate = shouldAlert(result, history);

  if (!gate.send) {
    return {
      sent: false,
      reason: gate.reason,
      current: gate.current || stateOf(result),
      previous: gate.previous || previousState(history)
    };
  }

  const text = buildMessage(result, gate.current, gate.previous);

  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(config.telegramBotToken)}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    }
  );

  let body = null;
  try { body = await res.json(); } catch {}

  if (!res.ok || body?.ok === false) {
    const detail = body?.description || `HTTP ${res.status}`;
    throw new Error(`Telegram alert failed: ${detail}`);
  }

  return {
    sent: true,
    reason: "STATE_CHANGED",
    current: gate.current,
    previous: gate.previous,
    messageId: body?.result?.message_id ?? null
  };
}
