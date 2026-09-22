import { InputFile, type Bot, type Context } from "grammy";
import { handleDeskTurn, looksLikeSecret } from "../team/desk.js";
import { writeJournalExport } from "../team/export.js";
import { executionGate } from "../team/gate.js";
import { appendJournalRows, loadJournalRows, stampDrafts } from "../team/journal.js";
import { formatLearnSummary, summarizeJournal } from "../team/learn.js";
import { exportDir, shouldPersistJournal } from "../team/paths.js";
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
  persistTurn(ctx, id, turn.events);
  await ctx.reply(renderDesk(turn.lines), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: startKeyboard(false),
  });
}

function persistTurn(ctx: Context, userId: string, events: Parameters<typeof stampDrafts>[0]): void {
  if (!shouldPersistJournal() || events.length === 0) return;
  try {
    const gate = executionGate(process.env);
    appendJournalRows(
      stampDrafts(events, {
        sessionId: String(ctx.chat?.id ?? userId),
        userId,
        mode: gate.mode,
      }),
    );
  } catch (err) {
    console.warn(
      "[bba] journal append failed",
      err instanceof Error ? err.message : "error",
    );
  }
}

async function replyLearn(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id ?? "");
  const rows = shouldPersistJournal() ? loadJournalRows({ userId }) : [];
  const text = formatLearnSummary(summarizeJournal(rows));
  await ctx.reply(renderDesk([{ speaker: "ledger", text }]), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: startKeyboard(false),
  });
}

async function replyExport(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id ?? "");
  const rows = shouldPersistJournal() ? loadJournalRows({ userId }) : [];
  if (rows.length === 0) {
    await ctx.reply("Journal has no rows for this chat. Nothing to export.", {
      reply_markup: startKeyboard(false),
    });
    return;
  }
  const written = writeJournalExport(rows, exportDir(), new Date());
  await ctx.reply(
    `Exported ${written.count} journal rows for a backtest.\nCSV and JSONL are attached.`,
    { reply_markup: startKeyboard(false) },
  );
  await ctx.replyWithDocument(new InputFile(written.csvPath));
  await ctx.replyWithDocument(new InputFile(written.jsonlPath));
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
  bot.command("learn", (ctx) => replyLearn(ctx));
  bot.command("export", (ctx) => replyExport(ctx));

  bot.hears(BTN.hire, (ctx) => replyTurn(ctx, "/hire"));
  bot.hears(BTN.watch, (ctx) => replyTurn(ctx, "/watch"));
  bot.hears(BTN.status, (ctx) => replyTurn(ctx, "/status"));
  bot.hears(BTN.paper, (ctx) => replyTurn(ctx, "/paper"));

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (/^learn\b/i.test(text)) {
      await replyLearn(ctx);
      return;
    }
    if (/^export\b/i.test(text)) {
      await replyExport(ctx);
      return;
    }
    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. Try /help, /hire, /watch, /status, /learn, or /export.", {
        reply_markup: startKeyboard(false),
      });
      return;
    }
    await replyTurn(ctx, text);
  });
}
