import { Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret } from "./crypto.js";

export interface GeneratedWallet {
  evmAddress: `0x${string}`;
  solAddress: string;
  evmPrivateKeyEnc: string;
  solPrivateKeyEnc: string;
}

export function generateUserWallet(): GeneratedWallet {
  const evmPk = generatePrivateKey();
  const account = privateKeyToAccount(evmPk);
  const sol = Keypair.generate();

  return {
    evmAddress: account.address,
    solAddress: sol.publicKey.toBase58(),
    evmPrivateKeyEnc: encryptSecret(evmPk),
    solPrivateKeyEnc: encryptSecret(
      Buffer.from(sol.secretKey).toString("hex"),
    ),
  };
}
