import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initDb,
  upsertToken,
  disableToken,
  listTokens,
  getResults
} from "./db.js";
import { scanToken } from "./scanner.js";
import { config } from "./config.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "crypto-hunter-railway", time: new Date().toISOString() });
});

app.get("/api/results", async (_req, res, next) => {
  try {
    res.json({ ok: true, results: await getResults() });
  } catch (e) { next(e); }
});

app.get("/api/tokens", async (_req, res, next) => {
  try {
    res.json({ ok: true, tokens: await listTokens(false) });
  } catch (e) { next(e); }
});

app.post("/api/tokens", async (req, res, next) => {
  try {
    const address = String(req.body?.address || "").trim();
    const chain = String(req.body?.chain || config.chain).toLowerCase();
    if (!address) return res.status(400).json({ ok: false, error: "address required" });

    await upsertToken(address, chain);
    const result = await scanToken(address, chain);
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

app.delete("/api/tokens/:address", async (req, res, next) => {
  try {
    await disableToken(req.params.address);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post("/api/scan", async (req, res, next) => {
  try {
    const address = String(req.body?.address || "").trim();
    const chain = String(req.body?.chain || config.chain).toLowerCase();
    if (!address) return res.status(400).json({ ok: false, error: "address required" });

    await upsertToken(address, chain);
    res.json({ ok: true, result: await scanToken(address, chain) });
  } catch (e) { next(e); }
});

app.post("/api/scan-all", async (_req, res, next) => {
  try {
    const tokens = await listTokens(true);
    const results = [];

    for (const t of tokens) {
      try {
        results.push(await scanToken(t.address, t.chain));
      } catch (e) {
        results.push({
          address: t.address,
          chain: t.chain,
          decision: "ERROR",
          signal: "SCAN_FAILED",
          reason: e?.message || String(e)
        });
      }
    }

    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err?.message || "Internal error" });
});

await initDb();

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Crypto Hunter Railway listening on ${config.port}`);
});
