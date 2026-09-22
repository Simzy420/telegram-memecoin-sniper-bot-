import { config } from "../config.js";
import { SPECIALISTS } from "../team/personas.js";

export { SPECIALISTS };

function productTitle(): string {
  if (/memecoin sniper/i.test(config.botName)) return config.botName;
  return `${config.botName} The MemeCoin Sniper`;
}

export function startWelcomeCopy(): string {
  const troop = SPECIALISTS.map((s) => `${s.mark} *${s.name}* — ${s.role}`).join(
    "\n",
  );

  return (
    `🦍 *${productTitle()}*\n` +
    `${config.botTagline}\n\n` +
    `One Telegram chat. Big Brain Ape is the boss. Five specialists answer in this same chat.\n\n` +
    `*The troop*\n` +
    `${troop}\n\n` +
    `*Menus*\n` +
    `• *Hire Team* — seat Scout, Sniper, Pulse, Ledger, and Shield\n` +
    `• *Watch Tape* — Scout surfaces names, Shield runs a checklist, Pulse reads the print\n` +
    `• *Desk Status* — who is on the desk, and the paper book\n\n` +
    `Say "scout", "shield check SLEEPAPE", "snipe SLEEPAPE", or "ledger".\n\n` +
    `The memecoin trading engine is *not live yet*. The desk defaults to paper. ` +
    `LIVE_TRADING stays off unless you set it, and this build never broadcasts a transaction.\n\n` +
    `*When you want a wallet*\n` +
    `1. Open the chat (done)\n` +
    `2. Generate a wallet and fund it\n` +
    `3. Activate once the portfolio clears the minimum\n` +
    `4. The troop still papers until a later live engine ships\n`
  );
}
