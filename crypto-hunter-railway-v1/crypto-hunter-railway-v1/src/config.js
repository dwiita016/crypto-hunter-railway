export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  chain: String(process.env.CHAIN || "solana").toLowerCase(),
  minTradableLpUsd: Number(process.env.MIN_TRADABLE_LP_USD || 5000),
  youngPairHours: Number(process.env.YOUNG_PAIR_HOURS || 6),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 12000)
};
