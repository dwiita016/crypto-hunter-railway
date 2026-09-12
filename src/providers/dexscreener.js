import { config } from "../config.js";

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function nullable(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function txCount(pair, tf) {
  const t = pair?.txns?.[tf];
  return n(t?.buys) + n(t?.sells);
}

export function ratio(pair, tf) {
  const t = pair?.txns?.[tf];
  const buys = n(t?.buys);
  const sells = n(t?.sells);
  if (buys === 0 && sells === 0) return null;
  if (sells === 0) return buys > 0 ? buys : null;
  return buys / sells;
}

function ageHours(pair) {
  const created = n(pair?.pairCreatedAt);
  if (!created) return null;
  return Math.max(0, (Date.now() - created) / 3600000);
}

export function isTradable(pair) {
  const lp = n(pair?.liquidity?.usd);
  if (lp < config.minTradableLpUsd) return false;

  const age = ageHours(pair);
  const tx5 = txCount(pair, "m5");
  const tx1 = txCount(pair, "h1");
  const vol5 = n(pair?.volume?.m5);
  const vol1 = n(pair?.volume?.h1);

  if (age !== null && age <= config.youngPairHours) {
    return tx5 > 0 && (vol5 > 0 || tx5 >= 2);
  }

  return (
    (tx5 > 0 && (vol5 > 0 || tx5 >= 2)) ||
    (tx1 >= 2 && vol1 > 0)
  );
}

function rank(pair) {
  const lp = n(pair?.liquidity?.usd);
  const v24 = n(pair?.volume?.h24);
  const v1 = n(pair?.volume?.h1);
  const tx5 = txCount(pair, "m5");
  const tx1 = txCount(pair, "h1");

  return (
    Math.log10(Math.max(lp, 1)) * 50 +
    Math.log10(Math.max(v24, 1)) * 12 +
    Math.log10(Math.max(v1, 1)) * 18 +
    Math.log10(Math.max(tx5 + tx1, 1)) * 20
  );
}

function diagnosticRank(pair) {
  return (
    Math.log10(Math.max(n(pair?.liquidity?.usd), 1)) * 20 +
    Math.log10(Math.max(n(pair?.volume?.m5), 1)) * 30 +
    Math.log10(Math.max(txCount(pair, "m5"), 1)) * 30
  );
}

export async function fetchDexPairs(tokenAddress) {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), config.requestTimeoutMs);

  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`;
    const res = await fetch(url, {
      headers: { "accept": "application/json" },
      signal: ctl.signal
    });
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    const json = await res.json();
    return Array.isArray(json?.pairs) ? json.pairs : [];
  } finally {
    clearTimeout(timeout);
  }
}

export function selectCanonicalPair(pairs, chain = "solana") {
  const sameChain = pairs.filter(p =>
    String(p?.chainId || "").toLowerCase() === String(chain).toLowerCase()
  );

  const pool = sameChain.length ? sameChain : pairs;
  const tradable = pool.filter(isTradable);

  if (!tradable.length) {
    const diagnostic = [...pool].sort((a, b) => diagnosticRank(b) - diagnosticRank(a))[0] || null;
    return {
      pair: diagnostic,
      tradablePairCount: 0,
      pairCount: pool.length,
      noTradablePair: true,
      reason: "NO_TRADABLE_PAIR"
    };
  }

  const selected = [...tradable].sort((a, b) => rank(b) - rank(a))[0];

  return {
    pair: selected,
    tradablePairCount: tradable.length,
    pairCount: pool.length,
    noTradablePair: false,
    reason: "BEST_LIVE_TRADABLE_PAIR"
  };
}

export function normalizePair(tokenAddress, chain, selection, pairs) {
  const p = selection.pair;
  if (!p) {
    return {
      address: tokenAddress,
      chain,
      symbol: tokenAddress.slice(0, 6),
      name: "",
      pairAddress: null,
      pairCount: 0,
      tradablePairCount: 0,
      pairLpUsd: 0,
      totalLpUsd: 0,
      marketCapUsd: 0,
      volume24hUsd: 0,
      buyRatio5m: null,
      buyRatio1h: null,
      buyRatio6h: null,
      buyRatio24h: null,
      priceChange5m: null,
      priceChange1h: null,
      priceChange6h: null,
      priceChange24h: null,
      noTradablePair: true,
      pairSelectionReason: "PAIR_NOT_FOUND",
      source: "DEXSCREENER",
      rawPair: null
    };
  }

  const totalLp = pairs.reduce((s, x) => s + n(x?.liquidity?.usd), 0);

  return {
    address: tokenAddress,
    chain,
    symbol: p?.baseToken?.symbol || p?.quoteToken?.symbol || tokenAddress.slice(0, 6),
    name: p?.baseToken?.name || "",
    pairAddress: p?.pairAddress || null,
    pairCount: selection.pairCount,
    tradablePairCount: selection.tradablePairCount,
    pairLpUsd: n(p?.liquidity?.usd),
    totalLpUsd: totalLp,
    marketCapUsd: n(p?.marketCap || p?.fdv),
    volume24hUsd: n(p?.volume?.h24),
    buyRatio5m: ratio(p, "m5"),
    buyRatio1h: ratio(p, "h1"),
    buyRatio6h: ratio(p, "h6"),
    buyRatio24h: ratio(p, "h24"),
    priceChange5m: nullable(p?.priceChange?.m5),
    priceChange1h: nullable(p?.priceChange?.h1),
    priceChange6h: nullable(p?.priceChange?.h6),
    priceChange24h: nullable(p?.priceChange?.h24),
    noTradablePair: selection.noTradablePair,
    pairSelectionReason: selection.reason,
    source: "DEXSCREENER",
    rawPair: p
  };
}
