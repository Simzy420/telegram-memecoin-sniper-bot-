import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const PUBLIC_ETH_RPC = "https://ethereum.publicnode.com";
const PUBLIC_BASE_RPC = "https://base.publicnode.com";
const PUBLIC_SOL_RPC = "https://api.mainnet-beta.solana.com";

function pickRpc(
  explicit: string | undefined,
  publicDefault: string,
  dedicated: string | null,
): string {
  if (explicit && explicit !== publicDefault) return explicit;
  if (dedicated) return dedicated;
  return explicit || publicDefault;
}

function dedicatedRpcs(): { ethereum: string | null; base: string | null; solana: string | null } {
  const alchemy = process.env.ALCHEMY_API_KEY ?? "";
  const helius = process.env.HELIUS_API_KEY ?? "";
  return {
    ethereum: alchemy ? `https://eth-mainnet.g.alchemy.com/v2/${alchemy}` : null,
    base: alchemy ? `https://base-mainnet.g.alchemy.com/v2/${alchemy}` : null,
    solana: helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : null,
  };
}

const dedicated = dedicatedRpcs();

export const config = {
  botName: process.env.BOT_NAME ?? "Big Brain Ape The MemeCoin Sniper",
  botTagline:
    process.env.BOT_TAGLINE ?? "The head ape hunts while you sleep.",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  /** Optional. Richer desk lines. The paper book does not depend on it. */
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  heliusApiKey: process.env.HELIUS_API_KEY ?? "",
  alchemyApiKey: process.env.ALCHEMY_API_KEY ?? "",
  /** Exact string "true" opts into the live flag. This build still does not broadcast. */
  liveTrading: process.env.LIVE_TRADING === "true",
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
    ethereum: pickRpc(process.env.RPC_ETHEREUM, PUBLIC_ETH_RPC, dedicated.ethereum),
    base: pickRpc(process.env.RPC_BASE, PUBLIC_BASE_RPC, dedicated.base),
    binance: process.env.RPC_BSC ?? "https://bsc.publicnode.com",
    monad: process.env.RPC_MONAD ?? "",
    robinhood: process.env.RPC_ROBINHOOD ?? "",
    solana: pickRpc(process.env.RPC_SOLANA, PUBLIC_SOL_RPC, dedicated.solana),
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
  if (config.liveTrading) {
    console.warn(
      "[bba] LIVE_TRADING=true but this build has no broadcaster. Desk stays on paper.",
    );
  } else {
    console.log("[bba] paper mode (LIVE_TRADING is not true).");
  }
}

// Keep required() available for stricter boot later
void required;
