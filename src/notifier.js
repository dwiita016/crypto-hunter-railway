import { config } from "./config.js";


const ALERT_STATES =
  new Set([
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


/* =========================================================
 * HELPERS
 * ========================================================= */

function esc(v) {

  return String(
    v ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    );
}


function money(v) {

  const n =
    Number(v);


  if (
    !Number.isFinite(n)
  ) {

    return "—";
  }


  if (
    Math.abs(n) >=
    1_000_000
  ) {

    return (
      `$${(
        n /
        1_000_000
      ).toFixed(2)}M`
    );
  }


  if (
    Math.abs(n) >=
    1_000
  ) {

    return (
      `$${(
        n /
        1_000
      ).toFixed(1)}K`
    );
  }


  return (
    `$${n.toFixed(2)}`
  );
}


function num(
  v,
  digits = 2
) {

  const n =
    Number(v);


  return Number.isFinite(n)
    ? n.toFixed(digits)
    : "—";
}


function stateOf(result) {

  return String(
    result?.decision ||
    result?.signal ||
    result?.entryState ||
    ""
  )
    .trim()
    .toUpperCase();
}


function previousScanState(
  history
) {

  if (
    !Array.isArray(history) ||
    history.length === 0
  ) {

    return "";
  }


  const h =
    history[0] ||
    {};


  const snapshot =
    h.snapshot ||
    {};


  return String(
    h.decision ||
    snapshot.decision ||
    snapshot.signal ||
    snapshot.entryState ||
    ""
  )
    .trim()
    .toUpperCase();
}


/* =========================================================
 * CONFIG STATUS
 * ========================================================= */

export function telegramConfigStatus() {

  return {

    configured:
      Boolean(
        config.telegramBotToken &&
        config.telegramChatId
      ),

    botTokenPresent:
      Boolean(
        config.telegramBotToken
      ),

    chatIdPresent:
      Boolean(
        config.telegramChatId
      ),

    chatIdPreview:
      config.telegramChatId
        ? (
          `${String(
            config.telegramChatId
          ).slice(0, 4)}…${String(
            config.telegramChatId
          ).slice(-4)}`
        )
        : null

  };
}


/* =========================================================
 * ALERT GATE
 *
 * Suppression based on LAST SUCCESSFULLY DELIVERED state.
 * ========================================================= */

function shouldAlert(
  result,
  history,
  sentState = null
) {

  if (
    !config.telegramBotToken ||
    !config.telegramChatId
  ) {

    return {
      send: false,
      reason:
        "TELEGRAM_NOT_CONFIGURED"
    };
  }


  const current =
    stateOf(
      result
    );


  const previous =
    previousScanState(
      history
    );


  const lastSent =
    String(
      sentState ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    !ALERT_STATES.has(
      current
    )
  ) {

    return {
      send: false,
      reason:
        "STATE_NOT_ALERTABLE",
      current,
      previous,
      lastSent
    };
  }


  /*
   * Same state is suppressed only when it was ACTUALLY
   * delivered successfully before.
   */
  if (
    current ===
    lastSent
  ) {

    return {
      send: false,
      reason:
        "STATE_ALREADY_DELIVERED",
      current,
      previous,
      lastSent
    };
  }


  /*
   * Avoid spam for a token whose first ever scan = SKIP.
   */
  if (
    !previous &&
    current ===
      "SKIP"
  ) {

    return {
      send: false,
      reason:
        "FIRST_SCAN_SKIP_SUPPRESSED",
      current,
      previous,
      lastSent
    };
  }


  return {

    send: true,

    reason:
      current ===
      "BUY"

        ? "BUY_NOT_YET_DELIVERED"

        : "STATE_NOT_YET_DELIVERED",

    current,
    previous,
    lastSent

  };
}


/* =========================================================
 * MESSAGE
 * ========================================================= */

function buildMessage(
  result,
  current,
  previous
) {

  const symbol =
    esc(
      result.symbol ||
      "?"
    );


  const transition =
    previous

      ? (
        `${esc(previous)} → ` +
        `<b>${esc(current)}</b>`
      )

      : (
        `<b>${esc(current)}</b>`
      );


  const risk =
    esc(
      result.risk ||
      "—"
    );


  const trajectory =
    esc(
      result.trajectory ||
      "—"
    );


  const signal =
    esc(
      result.signal ||
      "—"
    );


  const reason =
    esc(
      result.reason ||
      "—"
    );


  return [

    "🔎 <b>Crypto Hunter</b>",

    "",

    `<b>${symbol}</b>`,

    `State: ${transition}`,

    `Score: <b>${num(
      result.score
    )}</b>`,

    `Risk: ${risk}`,

    `Trajectory: ${trajectory}`,

    `Signal: ${signal}`,

    "",

    `LP: ${money(
      result.pairLpUsd
    )}`,

    `MC: ${money(
      result.marketCapUsd
    )}`,

    `BR 5M: ${num(
      result.buyRatio5m
    )}x`,

    `BR 1H: ${num(
      result.buyRatio1h
    )}x`,

    (
      `Live/All: ` +
      `${result.tradablePairCount ?? "—"}` +
      `/` +
      `${result.pairCount ?? "—"}`
    ),

    "",

    `Reason: ${reason}`,

    "",

    "<b>Source: Railway</b>"

  ].join("\n");
}


/* =========================================================
 * STATE CHANGE ALERT
 * ========================================================= */

export async function sendStateChangeAlert(
  result,
  history = [],
  lastSentState = null
) {

  const gate =
    shouldAlert(
      result,
      history,
      lastSentState
    );


  if (
    !gate.send
  ) {

    return {

      sent:
        false,

      reason:
        gate.reason,

      current:
        gate.current ||
        stateOf(result),

      previous:
        gate.previous ||
        previousScanState(history)

    };
  }


  const text =
    buildMessage(
      result,
      gate.current,
      gate.previous
    );


  const response =
    await fetch(
      (
        "https://api.telegram.org/bot" +
        `${config.telegramBotToken}` +
        "/sendMessage"
      ),
      {

        method:
          "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({

            chat_id:
              config.telegramChatId,

            text,

            parse_mode:
              "HTML",

            disable_web_page_preview:
              true

          })

      }
    );


  let body =
    null;


  try {

    body =
      await response.json();

  } catch {

    body =
      null;

  }


  if (
    !response.ok ||
    body?.ok === false
  ) {

    const detail =
      body?.description ||
      `HTTP ${response.status}`;


    throw new Error(
      `Telegram alert failed: ${detail}`
    );
  }


  return {

    sent:
      true,

    reason:
      gate.reason,

    current:
      gate.current,

    previous:
      gate.previous,

    messageId:
      body?.result?.message_id ??
      null,

    deliveredState:
      gate.current

  };
}


/* =========================================================
 * TELEGRAM TEST
 * ========================================================= */

export async function sendTelegramTest() {

  const status =
    telegramConfigStatus();


  if (
    !status.configured
  ) {

    throw new Error(
      (
        "Telegram belum configured. " +
        `botTokenPresent=${status.botTokenPresent}, ` +
        `chatIdPresent=${status.chatIdPresent}`
      )
    );
  }


  const response =
    await fetch(
      (
        "https://api.telegram.org/bot" +
        `${config.telegramBotToken}` +
        "/sendMessage"
      ),
      {

        method:
          "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify({

            chat_id:
              config.telegramChatId,

            text:
              (
                "✅ <b>Crypto Hunter Telegram Test</b>\n\n" +
                "Railway berhasil terhubung ke Telegram.\n" +
                "<b>Source: Railway V3.1</b>"
              ),

            parse_mode:
              "HTML",

            disable_web_page_preview:
              true

          })

      }
    );


  let body =
    null;


  try {

    body =
      await response.json();

  } catch {

    body =
      null;

  }


  if (
    !response.ok ||
    body?.ok === false
  ) {

    throw new Error(
      (
        "Telegram test failed: " +
        (
          body?.description ||
          `HTTP ${response.status}`
        )
      )
    );
  }


  return {

    ok:
      true,

    messageId:
      body?.result?.message_id ??
      null,

    chatId:
      body?.result?.chat?.id ??
      null,

    chatType:
      body?.result?.chat?.type ??
      null

  };
}
