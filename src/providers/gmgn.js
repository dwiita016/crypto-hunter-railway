import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function nullable(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function safeRatio(buy, sell) {
  const b = n(buy), s = n(sell);
  if (b === 0 && s === 0) return null;
  if (s === 0) return b > 0 ? b : null;
  return b / s;
}

function chainForGmgn(chain) {
  const x = String(chain || "solana").toLowerCase();
  if (x === "solana") return "sol";
  if (x === "ethereum") return "eth";
  return x;
}

function parseRaw(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("GMGN returned empty output.");
  try { return JSON.parse(text); } catch {}

  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  throw new Error("GMGN output is not valid JSON.");
}

function quickScreen(x) {
  let score = 20;
  const reasons = [];

  if (x.liquidityUsd < 5000) {
    return {
      score: 0,
      verdict: "SKIP_QUICK",
      reason: "Liquidity GMGN < $5K; tidak layak masuk review singkat."
    };
  }

  if (x.liquidityUsd >= 50000) { score += 20; reasons.push("LP≥50K"); }
  else if (x.liquidityUsd >= 20000) { score += 15; reasons.push("LP≥20K"); }
  else if (x.liquidityUsd >= 10000) { score += 8; reasons.push("LP≥10K"); }

  if (x.holderCount >= 500) { score += 12; reasons.push("holders≥500"); }
  else if (x.holderCount >= 100) { score += 8; reasons.push("holders≥100"); }
  else if (x.holderCount >= 30) score += 3;

  if (x.smartWallets >= 3) { score += 15; reasons.push("SM≥3"); }
  else if (x.smartWallets >= 1) { score += 8; reasons.push("SM present"); }

  if (x.kolWallets >= 1) { score += 5; reasons.push("KOL present"); }

  if ((x.buyRatio5m ?? 0) >= 1.5) { score += 10; reasons.push("Cnt5M strong"); }
  else if ((x.buyRatio5m ?? 0) >= 1.15) score += 5;

  if ((x.buyUsdRatio5m ?? 0) >= 2.0) { score += 10; reasons.push("USD5M strong"); }
  else if ((x.buyUsdRatio5m ?? 0) >= 1.2) score += 5;

  if (x.top10Rate !== null) {
    if (x.top10Rate < 0.20) { score += 8; reasons.push("Top10<20%"); }
    else if (x.top10Rate > 0.50) { score -= 15; reasons.push("Top10>50%"); }
  }

  if (x.bundlerRate !== null) {
    if (x.bundlerRate <= 0.10) score += 5;
    else if (x.bundlerRate > 0.30) { score -= 10; reasons.push("bundler>30%"); }
  }

  if (String(x.devStatus || "").toLowerCase() === "sell") score += 4;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = "SKIP_QUICK";
  if (score >= 70) verdict = "REVIEW_NOW";
  else if (score >= 55) verdict = "REVIEW";
  else if (score >= 35) verdict = "LOW_PRIORITY";

  return {
    score,
    verdict,
    reason: reasons.length ? reasons.join(" · ") : "Belum ada sinyal basic-info yang cukup kuat."
  };
}

export async function fetchGmgnBasic(address, chain = "solana") {
  if (!config.gmgnApiKey) {
    throw new Error("GMGN_API_KEY belum di-set di Railway Variables.");
  }

  const bin = path.resolve(__dirname, "../../node_modules/.bin/gmgn-cli");
  const args = [
    "token", "info",
    "--chain", chainForGmgn(chain),
    "--address", String(address),
    "--raw"
  ];

  let stdout;
  try {
    ({ stdout } = await execFileAsync(bin, args, {
      env: { ...process.env, GMGN_API_KEY: config.gmgnApiKey },
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    }));
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err);
    if (/\b(401|403)\b/.test(detail)) {
      throw new Error("GMGN 401/403. Cek GMGN_API_KEY; jika key benar, outbound IPv6 dapat menjadi penyebab karena GMGN CLI mensyaratkan IPv4.");
    }
    throw new Error(`GMGN token info gagal: ${detail.slice(0, 500)}`);
  }

  const d = parseRaw(stdout);
  const p = d?.price || {};
  const stat = d?.stat || {};
  const tags = d?.wallet_tags_stat || {};
  const dev = d?.dev || {};
  const link = d?.link || {};

  const priceUsd = nullable(p.price);
  const supply = nullable(d.circulating_supply);
  const marketCapUsd =
    priceUsd !== null && supply !== null ? priceUsd * supply : null;

  const created = n(d.creation_timestamp, 0);
  const ageHours = created > 0 ? Math.max(0, Date.now()/1000 - created) / 3600 : null;

  const x = {
    address: String(d.address || address),
    chain: chainForGmgn(chain),
    symbol: String(d.symbol || ""),
    name: String(d.name || ""),
    priceUsd,
    marketCapUsd,
    liquidityUsd: nullable(d.liquidity ?? d?.pool?.liquidity),
    holderCount: Math.round(n(d.holder_count ?? stat.holder_count, 0)),
    smartWallets: Math.round(n(tags.smart_wallets, 0)),
    kolWallets: Math.round(n(tags.renowned_wallets, 0)),
    top10Rate: nullable(stat.top_10_holder_rate ?? dev.top_10_holder_rate),
    bundlerRate: nullable(stat.top_bundler_trader_percentage),
    ratRate: nullable(stat.top_rat_trader_percentage),
    devStatus: String(dev.creator_token_status || ""),
    buyRatio5m: safeRatio(p.buys_5m, p.sells_5m),
    buyRatio1h: safeRatio(p.buys_1h, p.sells_1h),
    buyUsdRatio5m: safeRatio(p.buy_volume_5m, p.sell_volume_5m),
    buyUsdRatio1h: safeRatio(p.buy_volume_1h, p.sell_volume_1h),
    volume5mUsd: nullable(p.volume_5m),
    volume1hUsd: nullable(p.volume_1h),
    ageHours,
    twitter: link.twitter_username ? `https://x.com/${String(link.twitter_username).replace(/^@/, "")}` : null,
    website: link.website || null,
    telegram: link.telegram || null,
    gmgnUrl: link.gmgn || null,
    raw: d
  };

  const q = quickScreen(x);
  return {
    ...x,
    quickScore: q.score,
    quickVerdict: q.verdict,
    quickReason: q.reason
  };
}

function asBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(s)) return true;
  if (["false", "0", "no"].includes(s)) return false;
  return null;
}

function securityVerdict(x) {
  const hard = [];
  const cautions = [];
  const chain = String(x.chain || "").toLowerCase();

  if (["bsc", "base"].includes(chain) && x.isHoneypot === true) {
    hard.push("HONEYPOT");
  }
  if (x.rugRatio !== null && x.rugRatio > 0.30) {
    hard.push(`RUG_RATIO>${(x.rugRatio * 100).toFixed(0)}%`);
  }
  if (x.sellTax !== null && x.sellTax > 0.10) {
    hard.push(`SELL_TAX>${(x.sellTax * 100).toFixed(0)}%`);
  }
  if (x.top10HolderRate !== null && x.top10HolderRate > 0.60) {
    hard.push(`TOP10>${(x.top10HolderRate * 100).toFixed(0)}%`);
  }

  // Strict automatic-entry gate for Solana.
  if (chain === "sol") {
    if (x.renouncedMint === false) hard.push("MINT_AUTHORITY_ACTIVE");
    if (x.renouncedFreeze === false) hard.push("FREEZE_AUTHORITY_ACTIVE");
  }

  if (x.isWashTrading === true) cautions.push("WASH_TRADING");
  if (x.creatorTokenStatus === "creator_hold") cautions.push("CREATOR_STILL_HOLDS");
  if (x.devTeamHoldRate !== null && x.devTeamHoldRate > 0.20) cautions.push("DEV_TEAM>20%");
  if (x.creatorBalanceRate !== null && x.creatorBalanceRate > 0.10) cautions.push("CREATOR>10%");
  if (x.suspectedInsiderHoldRate !== null && x.suspectedInsiderHoldRate > 0.20) cautions.push("INSIDER>20%");
  if (x.bundlerTraderAmountRate !== null && x.bundlerTraderAmountRate > 0.30) cautions.push("BUNDLER>30%");
  if (x.ratTraderAmountRate !== null && x.ratTraderAmountRate > 0.30) cautions.push("RAT_TRADER>30%");
  if (x.sniperCount !== null && x.sniperCount >= 5) cautions.push("SNIPERS>=5");

  if (hard.length) {
    return {
      status: "BLOCK",
      autoAddAllowed: false,
      reason: hard.join(" · "),
      warnings: cautions
    };
  }

  if (cautions.length) {
    return {
      status: "CAUTION",
      autoAddAllowed: false,
      reason: cautions.join(" · "),
      warnings: cautions
    };
  }

  return {
    status: "SECURE",
    autoAddAllowed: true,
    reason: "Tidak ada hard-stop / warning security GMGN yang terdeteksi.",
    warnings: []
  };
}

export async function fetchGmgnSecurity(address, chain = "solana") {
  if (!config.gmgnApiKey) {
    throw new Error("GMGN_API_KEY belum di-set di Railway Variables.");
  }

  const gmgnChain = chainForGmgn(chain);
  const bin = path.resolve(__dirname, "../../node_modules/.bin/gmgn-cli");
  const args = [
    "token", "security",
    "--chain", gmgnChain,
    "--address", String(address),
    "--raw"
  ];

  let stdout;
  try {
    ({ stdout } = await execFileAsync(bin, args, {
      env: { ...process.env, GMGN_API_KEY: config.gmgnApiKey },
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    }));
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err);

    if (/\b(401|403)\b/.test(detail)) {
      throw new Error(
        "GMGN Security 401/403. Cek GMGN_API_KEY; jika key benar, cek outbound IPv4/IPv6 Railway."
      );
    }
    if (/\b429\b/.test(detail)) {
      throw new Error(
        "GMGN Security rate limit (429). Tunggu cooldown GMGN; jangan retry berulang."
      );
    }

    throw new Error(`GMGN token security gagal: ${detail.slice(0, 500)}`);
  }

  const d = parseRaw(stdout);

  const x = {
    address: String(address),
    chain: gmgnChain,
    isHoneypot: asBool(d.is_honeypot),
    openSource: String(d.open_source ?? "unknown"),
    ownerRenounced: String(d.owner_renounced ?? "unknown"),
    renouncedMint: asBool(d.renounced_mint),
    renouncedFreeze: asBool(d.renounced_freeze_account),
    buyTax: nullable(d.buy_tax),
    sellTax: nullable(d.sell_tax),
    top10HolderRate: nullable(d.top_10_holder_rate),
    devTeamHoldRate: nullable(d.dev_team_hold_rate),
    creatorBalanceRate: nullable(d.creator_balance_rate),
    creatorTokenStatus: String(d.creator_token_status ?? ""),
    suspectedInsiderHoldRate: nullable(d.suspected_insider_hold_rate),
    rugRatio: nullable(d.rug_ratio),
    isWashTrading: asBool(d.is_wash_trading),
    ratTraderAmountRate: nullable(d.rat_trader_amount_rate),
    bundlerTraderAmountRate: nullable(d.bundler_trader_amount_rate),
    sniperCount:
      d.sniper_count === null || d.sniper_count === undefined
        ? null
        : Math.round(n(d.sniper_count)),
    burnStatus: String(d.burn_status ?? ""),
    raw: d
  };

  const verdict = securityVerdict(x);

  return {
    ...x,
    securityStatus: verdict.status,
    securityAutoAddAllowed: verdict.autoAddAllowed,
    securityReason: verdict.reason,
    securityWarnings: verdict.warnings
  };
}

