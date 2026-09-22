import type { Bot, Context } from "grammy";
import { handleDeskTurn, looksLikeSecret } from "../team/desk.js";
import { renderDesk } from "../team/render.js";
import { loadSession, saveSession } from "../team/session.js";
import { BTN, startKeyboard } from "./keyboards.js";

async function replyTurn(ctx: Context, text: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const id = String(from.id);
  if (looksLikeSecret(text)) {
    const turn = await handleDeskTurn({ text, state: loadSession(id) });
    await ctx.reply(renderDesk(turn.lines), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  const turn = await handleDeskTurn({ text, state: loadSession(id) });
  saveSession(id, turn.state);
  await ctx.reply(renderDesk(turn.lines), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: startKeyboard(false),
  });
}

export function registerTeamHandlers(bot: Bot): void {
  bot.command("hire", (ctx) => replyTurn(ctx, "/hire"));
  bot.command("watch", (ctx) => replyTurn(ctx, "/watch"));
  bot.command("status", (ctx) => replyTurn(ctx, "/status"));
  bot.command("paper", (ctx) => replyTurn(ctx, "/paper"));
  bot.command("help", (ctx) => replyTurn(ctx, "/help"));
  bot.command("scout", (ctx) => replyTurn(ctx, "/scout"));
  bot.command("sniper", (ctx) => replyTurn(ctx, "/sniper"));
  bot.command("pulse", (ctx) => replyTurn(ctx, "/pulse"));
  bot.command("ledger", (ctx) => replyTurn(ctx, "/ledger"));
  bot.command("shield", (ctx) => replyTurn(ctx, "/shield"));

  bot.hears(BTN.hire, (ctx) => replyTurn(ctx, "/hire"));
  bot.hears(BTN.watch, (ctx) => replyTurn(ctx, "/watch"));
  bot.hears(BTN.status, (ctx) => replyTurn(ctx, "/status"));
  bot.hears(BTN.paper, (ctx) => replyTurn(ctx, "/paper"));

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. Try /help, /hire, /watch, or /status.", {
        reply_markup: startKeyboard(false),
      });
      return;
    }
    await replyTurn(ctx, text);
  });
}
