import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  initDb,
  upsertToken,
  disableToken,
  listTokens,
  getResults,
  getPublicHistory,
  getCalibration,
  saveGmgnBasic,
  saveGmgnSecurity,
  getGmgnBasic
} from "./db.js";

import { scanToken } from "./scanner.js";

import {
  fetchGmgnBasic,
  fetchGmgnSecurity
} from "./providers/gmgn.js";

import { config } from "./config.js";
import { buildCalibration } from "./calibration.js";

import {
  telegramConfigStatus,
  sendTelegramTest
} from "./notifier.js";


const app = express();

app.use(
  express.json({
    limit: "1mb"
  })
);


const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );


app.use(
  express.static(
    path.join(
      __dirname,
      "..",
      "public"
    )
  )
);


/* =========================================================
 * HEALTH
 * ========================================================= */

app.get(
  "/health",
  (_req, res) => {

    res.json({
      ok: true,

      service:
        "crypto-hunter-railway",

      gmgnConfigured:
        Boolean(
          config.gmgnApiKey
        ),

      telegramConfigured:
        Boolean(
          config.telegramBotToken &&
          config.telegramChatId
        ),

      telegram:
        telegramConfigStatus(),

      time:
        new Date().toISOString()
    });
  }
);


/* =========================================================
 * TELEGRAM
 * ========================================================= */

app.get(
  "/api/telegram/status",
  (_req, res) => {

    res.json({
      ok: true,

      telegram:
        telegramConfigStatus()
    });
  }
);


app.post(
  "/api/telegram/test",
  async (_req, res, next) => {

    try {

      const result =
        await sendTelegramTest();

      res.json({
        ok: true,
        result
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * RESULTS
 * ========================================================= */

app.get(
  "/api/results",
  async (_req, res, next) => {

    try {

      res.json({
        ok: true,
        results:
          await getResults()
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * CALIBRATION
 * ========================================================= */

app.get(
  "/api/calibration/:address",
  async (req, res, next) => {

    try {

      const address =
        String(
          req.params.address ||
          ""
        ).trim();

      if (!address) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "address required"
          });
      }


      const row =
        await getCalibration(
          address
        );


      const calibration =
        buildCalibration(
          row
        );


      res.json({
        ok: true,
        address,
        row,
        calibration
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * HISTORY
 * ========================================================= */

app.get(
  "/api/history/:address",
  async (req, res, next) => {

    try {

      const address =
        String(
          req.params.address ||
          ""
        ).trim();


      const limit =
        Number(
          req.query.limit ||
          20
        );


      if (!address) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "address required"
          });
      }


      res.json({
        ok: true,
        address,

        history:
          await getPublicHistory(
            address,
            limit
          )
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * TOKENS
 * ========================================================= */

app.get(
  "/api/tokens",
  async (_req, res, next) => {

    try {

      res.json({
        ok: true,

        tokens:
          await listTokens(
            false
          )
      });

    } catch (e) {

      next(e);

    }
  }
);


app.post(
  "/api/tokens",
  async (req, res, next) => {

    try {

      const address =
        String(
          req.body?.address ||
          ""
        ).trim();


      const chain =
        String(
          req.body?.chain ||
          config.chain
        ).toLowerCase();


      if (!address) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "address required"
          });
      }


      await upsertToken(
        address,
        chain
      );


      const result =
        await scanToken(
          address,
          chain
        );


      res.json({
        ok: true,
        result
      });

    } catch (e) {

      next(e);

    }
  }
);


app.delete(
  "/api/tokens/:address",
  async (req, res, next) => {

    try {

      await disableToken(
        req.params.address
      );


      res.json({
        ok: true
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * SINGLE SCAN
 * ========================================================= */

app.post(
  "/api/scan",
  async (req, res, next) => {

    try {

      const address =
        String(
          req.body?.address ||
          ""
        ).trim();


      const chain =
        String(
          req.body?.chain ||
          config.chain
        ).toLowerCase();


      if (!address) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "address required"
          });
      }


      await upsertToken(
        address,
        chain
      );


      const result =
        await scanToken(
          address,
          chain
        );


      res.json({
        ok: true,
        result
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * ACTIVE SCAN
 * ========================================================= */

app.post(
  "/api/scan-all",
  async (_req, res, next) => {

    try {

      const tokens =
        await listTokens(
          true
        );


      const results = [];


      for (const token of tokens) {

        try {

          const result =
            await scanToken(
              token.address,
              token.chain
            );


          results.push(
            result
          );

        } catch (e) {

          results.push({
            address:
              token.address,

            chain:
              token.chain,

            decision:
              "ERROR",

            signal:
              "SCAN_FAILED",

            reason:
              e?.message ||
              String(e)
          });

        }
      }


      res.json({
        ok: true,
        results
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * GMGN BASIC INFO
 * ========================================================= */

app.get(
  "/api/gmgn/basic",
  async (_req, res, next) => {

    try {

      res.json({
        ok: true,

        configured:
          Boolean(
            config.gmgnApiKey
          ),

        results:
          await getGmgnBasic()
      });

    } catch (e) {

      next(e);

    }
  }
);


app.post(
  "/api/gmgn/basic",
  async (req, res, next) => {

    try {

      const address =
        String(
          req.body?.address ||
          ""
        ).trim();


      const chain =
        String(
          req.body?.chain ||
          config.chain
        ).toLowerCase();


      if (!address) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "address required"
          });
      }


      const result =
        await fetchGmgnBasic(
          address,
          chain
        );


      await saveGmgnBasic(
        result
      );


      res.json({
        ok: true,
        result
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * GMGN SCREEN ACTIVE
 * ========================================================= */

app.post(
  "/api/gmgn/screen-active",
  async (_req, res, next) => {

    try {

      const tokens =
        await listTokens(
          true
        );


      const results = [];


      for (const token of tokens) {

        try {

          const result =
            await fetchGmgnBasic(
              token.address,
              token.chain
            );


          await saveGmgnBasic(
            result
          );


          results.push(
            result
          );

        } catch (e) {

          results.push({
            address:
              token.address,

            chain:
              token.chain,

            quickVerdict:
              "ERROR",

            quickReason:
              e?.message ||
              String(e)
          });

        }
      }


      res.json({
        ok: true,
        results
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * GMGN CHECK & ADD + SECURITY
 * ========================================================= */

app.post(
  "/api/gmgn/check-add",
  async (req, res, next) => {

    try {

      const address =
        String(
          req.body?.address ||
          ""
        ).trim();


      const chain =
        String(
          req.body?.chain ||
          config.chain
        ).toLowerCase();


      if (!address) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "address required"
          });
      }


      /* -----------------------------------------
       * 1. BASIC INFO RE-CHECK
       * ----------------------------------------- */

      const gmgn =
        await fetchGmgnBasic(
          address,
          chain
        );


      await saveGmgnBasic(
        gmgn
      );


      const basicAllowed =
        gmgn.quickVerdict ===
          "REVIEW_NOW" ||
        gmgn.quickVerdict ===
          "REVIEW";


      if (!basicAllowed) {

        return res.json({
          ok: true,

          added:
            false,

          stage:
            "BASIC_INFO",

          gmgn,

          security:
            null,

          reason:
            `Tidak masuk Scanner karena verdict Basic Info terbaru = ${gmgn.quickVerdict}.`
        });
      }


      /* -----------------------------------------
       * 2. SECURITY GATE
       * ----------------------------------------- */

      const security =
        await fetchGmgnSecurity(
          address,
          chain
        );


      await saveGmgnSecurity(
        address,
        security
      );


      if (
        !security
          .securityAutoAddAllowed
      ) {

        return res.json({
          ok: true,

          added:
            false,

          stage:
            "SECURITY",

          gmgn,
          security,

          reason:
            `Tidak masuk Scanner. Security = ${security.securityStatus}: ${security.securityReason}`
        });
      }


      /* -----------------------------------------
       * 3. ADD TO SCANNER
       * ----------------------------------------- */

      await upsertToken(
        address,
        chain
      );


      const scanner =
        await scanToken(
          address,
          chain
        );


      return res.json({
        ok: true,

        added:
          true,

        stage:
          "SCANNER",

        gmgn,
        security,
        scanner,

        reason:
          "Lolos GMGN Basic Info + Security Gate dan sudah dimasukkan ke Scanner."
      });

    } catch (e) {

      next(e);

    }
  }
);


/* =========================================================
 * ERROR HANDLER
 * ========================================================= */

app.use(
  (err, _req, res, _next) => {

    console.error(
      err
    );


    res
      .status(500)
      .json({
        ok: false,

        error:
          err?.message ||
          "Internal error"
      });
  }
);


/* =========================================================
 * START
 * ========================================================= */

await initDb();


app.listen(
  config.port,
  "0.0.0.0",
  () => {

    console.log(
      `Crypto Hunter Railway V3.1 listening on ${config.port}`
    );

  }
);
