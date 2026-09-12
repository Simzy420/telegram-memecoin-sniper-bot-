import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  botName: process.env.BOT_NAME ?? "Big Brain Ape",
  botTagline:
    process.env.BOT_TAGLINE ?? "The head ape hunts while you sleep.",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramUsername: process.env.TELEGRAM_BOT_USERNAME ?? "",
  websiteUrl: process.env.WEBSITE_URL ?? "http://localhost:4321",
  docsUrl: process.env.DOCS_URL ?? "http://localhost:4321/docs",
  channelUrl: process.env.CHANNEL_URL ?? "",
  walletEncryptionKey:
    process.env.WALLET_ENCRYPTION_KEY ?? "dev-only-change-me-now-32chars!!",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://snipr:snipr@localhost:5432/snipr",
  minFundUsd: Number(process.env.MIN_FUND_USD ?? "100"),
  promoHours: Number(process.env.PROMO_HOURS ?? "48"),
  promoEnabled: (process.env.PROMO_ENABLED ?? "true") === "true",
  coingeckoApiUrl:
    process.env.COINGECKO_API_URL ?? "https://api.coingecko.com/api/v3",
  rpc: {
    ethereum: process.env.RPC_ETHEREUM ?? "https://ethereum.publicnode.com",
    base: process.env.RPC_BASE ?? "https://base.publicnode.com",
    binance: process.env.RPC_BSC ?? "https://bsc.publicnode.com",
    monad: process.env.RPC_MONAD ?? "",
    robinhood: process.env.RPC_ROBINHOOD ?? "",
    solana: process.env.RPC_SOLANA ?? "https://api.mainnet-beta.solana.com",
  },
};

export function assertRuntimeConfig(): void {
  if (!config.telegramToken) {
    console.warn(
      "[snipr] TELEGRAM_BOT_TOKEN is empty — bot will not poll until set.",
    );
  }
  if (config.walletEncryptionKey.includes("change-me")) {
    console.warn(
      "[snipr] WALLET_ENCRYPTION_KEY is still a placeholder. Do not use with real funds.",
    );
  }
}

// Keep required() available for stricter boot later
void required;
