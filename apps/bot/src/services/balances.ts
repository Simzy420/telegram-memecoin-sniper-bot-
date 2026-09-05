import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createPublicClient, formatEther, http, type Chain } from "viem";
import { mainnet, base, bsc } from "viem/chains";
import { CHAINS, type ChainId } from "@snipr/shared";
import { config } from "../config.js";

export interface ChainBalance {
  chainId: ChainId;
  label: string;
  symbol: string;
  amount: number;
  usd: number;
}

const evmChainMap: Partial<Record<ChainId, Chain>> = {
  ethereum: mainnet,
  base,
  binance: bsc,
};

function rpcFor(chainId: ChainId): string {
  switch (chainId) {
    case "ethereum":
      return config.rpc.ethereum;
    case "base":
      return config.rpc.base;
    case "binance":
      return config.rpc.binance;
    case "monad":
      return config.rpc.monad;
    case "robinhood":
      return config.rpc.robinhood;
    case "solana":
      return config.rpc.solana;
  }
}

async function fetchUsdPrices(): Promise<Record<string, number>> {
  const ids = [...new Set(CHAINS.map((c) => c.coingeckoId))].join(",");
  try {
    const res = await fetch(
      `${config.coingeckoApiUrl}/simple/price?ids=${ids}&vs_currencies=usd`,
    );
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(data)) {
      out[id] = v.usd ?? 0;
    }
    return out;
  } catch {
    return {};
  }
}

async function evmBalance(
  chainId: ChainId,
  address: `0x${string}`,
): Promise<number> {
  const rpc = rpcFor(chainId);
  if (!rpc) return 0;
  const chain = evmChainMap[chainId] ?? mainnet;
  try {
    const client = createPublicClient({
      chain,
      transport: http(rpc),
    });
    const wei = await client.getBalance({ address });
    return Number(formatEther(wei));
  } catch {
    return 0;
  }
}

async function solBalance(address: string): Promise<number> {
  try {
    const conn = new Connection(config.rpc.solana, "confirmed");
    const lamports = await conn.getBalance(new PublicKey(address));
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

export async function loadPortfolio(
  evmAddress: string | null,
  solAddress: string | null,
): Promise<{ balances: ChainBalance[]; totalUsd: number }> {
  const prices = await fetchUsdPrices();
  const balances: ChainBalance[] = [];

  for (const chain of CHAINS) {
    let amount = 0;
    if (chain.family === "evm" && evmAddress) {
      amount = await evmBalance(chain.id, evmAddress as `0x${string}`);
    } else if (chain.family === "solana" && solAddress) {
      amount = await solBalance(solAddress);
    }
    const usd = amount * (prices[chain.coingeckoId] ?? 0);
    balances.push({
      chainId: chain.id,
      label: chain.label,
      symbol: chain.symbol,
      amount,
      usd,
    });
  }

  const totalUsd = balances.reduce((s, b) => s + b.usd, 0);
  return { balances, totalUsd };
}

export function formatPortfolioLines(balances: ChainBalance[]): string {
  return balances
    .map((b) => {
      const amt =
        b.amount === 0
          ? "0"
          : b.amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
      const usd = b.usd.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      });
      return `${b.label}: ${amt} ${b.symbol} (${usd})`;
    })
    .join("\n");
}
