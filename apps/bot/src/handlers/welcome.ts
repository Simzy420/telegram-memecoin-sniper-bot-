import { config } from "../config.js";

export const SPECIALISTS = [
  { mark: "◈", name: "Scout", role: "finds pairs and setups" },
  { mark: "◎", name: "Sniper", role: "memecoin entries" },
  { mark: "▹", name: "Pulse", role: "rapid day trader / tape" },
  { mark: "▤", name: "Ledger", role: "positions, fills, day log" },
  { mark: "▣", name: "Shield", role: "risk filters before entry" },
] as const;

export function startWelcomeCopy(): string {
  const troop = SPECIALISTS.map((s) => `${s.mark} *${s.name}* — ${s.role}`).join(
    "\n",
  );

  return (
    `🦍 *${config.botName} The MemeCoin Sniper*\n` +
    `${config.botTagline}\n\n` +
    `One Telegram chat. The head ape plus five specialists.\n` +
    `The boss picks who handles the tape.\n\n` +
    `*The troop*\n` +
    `${troop}\n\n` +
    `2% on winning trades only. No subscription. Export your keys anytime.\n` +
    `The memecoin trading engine is *not live yet* — Phase 1 is wallet, fund, and activate.\n` +
    (config.promoEnabled
      ? `🎁 0% fees for new users during the first ${config.promoHours} hours (fee engine is Phase 2).\n\n`
      : "\n") +
    `*4 steps:*\n` +
    `1. Open the chat (done)\n` +
    `2. Fund the wallets\n` +
    `3. 1-click trading\n` +
    `4. Profit while asleep\n`
  );
}
