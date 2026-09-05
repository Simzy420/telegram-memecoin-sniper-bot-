import { Bot, type Context } from "grammy";
import { config } from "../config.js";
import {
  getUser,
  saveGeneratedWallet,
  setAgentStatus,
  upsertUser,
  type UserRow,
} from "../db/users.js";
import {
  formatPortfolioLines,
  loadPortfolio,
} from "../services/balances.js";
import { decryptSecret } from "../services/crypto.js";
import { generateUserWallet } from "../services/wallet.js";
import {
  BTN,
  confirmExportKeyboard,
  linksLine,
  mainWalletKeyboard,
  startKeyboard,
} from "./keyboards.js";

function promoLine(): string {
  if (!config.promoEnabled) return "";
  return `\n🔥 Promo Active — ${config.promoHours} Hours No Fees\n`;
}

async function portfolioMessage(user: UserRow): Promise<string> {
  if (!user.evm_address || !user.sol_address) {
    return (
      `*${config.botName}*\n\n` +
      `No wallet yet. Tap *${BTN.generate}* to create one inside Telegram.\n` +
      `You hold the keys — export anytime.`
    );
  }

  const { balances, totalUsd } = await loadPortfolio(
    user.evm_address,
    user.sol_address,
  );

  const funded = totalUsd >= config.minFundUsd;
  let status: string;
  if (user.agent_status === "armed") {
    status = "✅ Agent armed. Memecoin trading engine activates in Phase 2.";
  } else if (funded) {
    status = `✅ Portfolio funded. ${config.botName} Agent is ready to activate.`;
  } else {
    status = `⏳ Fund at least *$${config.minFundUsd}* to unlock Activate.`;
  }

  const total = totalUsd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });

  return (
    `*${config.botName} Trading Bot*\n\n` +
    `${formatPortfolioLines(balances)}\n\n` +
    `💰 Total: ${total}\n\n` +
    `EVM: \`${user.evm_address}\`\n` +
    `SOL: \`${user.sol_address}\`\n` +
    promoLine() +
    `\n${linksLine()}\n\n` +
    status
  );
}

async function ensureUser(ctx: Context): Promise<UserRow> {
  const id = String(ctx.from!.id);
  return upsertUser(id, ctx.from?.username ?? null);
}

export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const user = await ensureUser(ctx);
    const welcome =
      `*${config.botName}* — ${config.botTagline}\n\n` +
      `🚀 Always-on agent for memecoin opportunities\n` +
      `🛡 Continuous risk protection\n` +
      `📈 Trailing profit locks (Phase 2)\n` +
      `🔔 Real-time Telegram trade alerts (Phase 2)\n\n` +
      `No subscription. No API key. Withdraw anytime.\n` +
      (config.promoEnabled
        ? `🎁 0% fees for new users during the first ${config.promoHours} hours.\n\n`
        : "\n") +
      `*4 steps:*\n` +
      `1. Start (done)\n` +
      `2. Generate wallet\n` +
      `3. Fund ≥ $${config.minFundUsd}\n` +
      `4. Activate\n`;

    const { totalUsd } = user.evm_address
      ? await loadPortfolio(user.evm_address, user.sol_address)
      : { totalUsd: 0 };

    await ctx.reply(welcome, {
      parse_mode: "Markdown",
      reply_markup: startKeyboard(totalUsd >= config.minFundUsd),
    });
  });

  bot.hears(BTN.generate, async (ctx) => {
    const user = await ensureUser(ctx);
    if (user.evm_address) {
      await ctx.reply(
        "You already have a wallet. Use Export Private Key to back it up, or Import to replace (Phase 1: replace not fully wired).",
        { reply_markup: mainWalletKeyboard() },
      );
      await ctx.reply(await portfolioMessage(user), {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    const wallet = generateUserWallet();
    const saved = await saveGeneratedWallet(String(ctx.from!.id), wallet);
    await ctx.reply(
      "✅ Wallet generated.\n\n" +
        `EVM: \`${wallet.evmAddress}\`\n` +
        `SOL: \`${wallet.solAddress}\`\n\n` +
        "Back up with *Export Private Key* before depositing large amounts.",
      { parse_mode: "Markdown", reply_markup: mainWalletKeyboard() },
    );
    await ctx.reply(await portfolioMessage(saved), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.hears(BTN.portfolio, async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.reply(await portfolioMessage(user), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
      reply_markup: mainWalletKeyboard(),
    });
  });

  bot.hears(BTN.deposit, async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user.evm_address || !user.sol_address) {
      await ctx.reply(`Generate a wallet first: ${BTN.generate}`);
      return;
    }
    await ctx.reply(
      `*Deposit*\n\n` +
        `Send *Base / Ethereum / Binance / Monad / Robinhood* assets to:\n\`${user.evm_address}\`\n\n` +
        `Send *Solana (SOL)* to:\n\`${user.sol_address}\`\n\n` +
        `Minimum total value: *$${config.minFundUsd}*`,
      { parse_mode: "Markdown", reply_markup: mainWalletKeyboard() },
    );
  });

  bot.hears(BTN.transfer, async (ctx) => {
    await ctx.reply(
      "Transfer is stubbed in Phase 1. Phase 2 will send native assets to an address you provide.",
      { reply_markup: mainWalletKeyboard() },
    );
  });

  bot.hears(BTN.importWallet, async (ctx) => {
    await ctx.reply(
      "Import wallet is stubbed in Phase 1. You will paste an EVM and/or SOL private key in a private chat flow.",
      { reply_markup: mainWalletKeyboard() },
    );
  });

  bot.hears(BTN.exportKey, async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user.evm_pk_enc || !user.sol_pk_enc) {
      await ctx.reply(`Generate a wallet first: ${BTN.generate}`);
      return;
    }
    await ctx.reply(
      "⚠️ Anyone with these keys can take your funds. Only export in a private chat. Continue?",
      { reply_markup: confirmExportKeyboard() },
    );
  });

  bot.callbackQuery("export_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Export cancelled.");
  });

  bot.callbackQuery("export_confirm", async (ctx) => {
    const user = await getUser(String(ctx.from.id));
    if (!user?.evm_pk_enc || !user.sol_pk_enc) {
      await ctx.answerCallbackQuery({ text: "No wallet" });
      return;
    }
    const evmPk = decryptSecret(user.evm_pk_enc);
    const solPk = decryptSecret(user.sol_pk_enc);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*EVM private key:*\n\`${evmPk}\`\n\n` +
        `*SOL secret (hex):*\n\`${solPk}\`\n\n` +
        "Delete this message after saving offline.",
      { parse_mode: "Markdown" },
    );
  });

  bot.hears([BTN.activate, BTN.deploy], async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user.evm_address) {
      await ctx.reply(`Generate a wallet first: ${BTN.generate}`);
      return;
    }
    const { totalUsd } = await loadPortfolio(
      user.evm_address,
      user.sol_address,
    );
    if (totalUsd < config.minFundUsd) {
      await ctx.reply(
        `Portfolio is $${totalUsd.toFixed(2)}. Deposit at least $${config.minFundUsd} first.`,
        { reply_markup: mainWalletKeyboard() },
      );
      return;
    }
    await setAgentStatus(String(ctx.from!.id), "armed");
    await ctx.reply(
      `✅ *${config.botName} Agent activated.*\n\n` +
        "Phase 1 complete: you are armed.\n" +
        "Phase 2 will add automatic memecoin entries with dynamic stop-loss and trailing take-profit.",
      { parse_mode: "Markdown", reply_markup: mainWalletKeyboard() },
    );
  });

  bot.hears(BTN.claimBonus, async (ctx) => {
    await ensureUser(ctx);
    await ctx.reply(
      config.promoEnabled
        ? `🎁 New-user promo: 0% fees for ${config.promoHours} hours after wallet creation. (Fee engine ships in Phase 2.)`
        : "No active promo right now.",
      { reply_markup: mainWalletKeyboard() },
    );
  });
}
