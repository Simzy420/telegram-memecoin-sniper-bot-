import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Bot } from "grammy";
import { pool } from "../src/db/users.ts";
import { registerHandlers } from "../src/handlers/commands.ts";

process.env.SKIP_DATABASE = "1";
process.env.PAPER_DESK_PATH = "";

const sent: { chatId: number; text: string; markup: string }[] = [];

const bot = new Bot("123456789:AAFakeTokenForTestsOnly", {
  botInfo: {
    id: 123456789,
    is_bot: true,
    first_name: "Big Brain Ape",
    username: "Big_Brain_Ape_Bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  },
});
bot.api.config.use(async (_prev, method, payload) => {
  if (method === "sendMessage") {
    const body = payload as {
      chat_id?: number;
      text?: string;
      reply_markup?: unknown;
    };
    sent.push({
      chatId: Number(body.chat_id),
      text: body.text ?? "",
      markup: JSON.stringify(body.reply_markup ?? {}),
    });
  }
  return {
    ok: true,
    result: {
      message_id: 1,
      date: 1,
      chat: { id: Number((payload as { chat_id?: number }).chat_id ?? 1), type: "private" },
      text: "ok",
    },
  };
});
registerHandlers(bot);

after(async () => {
  await pool.end();
});

test("/start introduces the boss, the five specialists, and the desk menu", async () => {
  const chatId = 7101;
  await bot.handleUpdate(update(chatId, "/start"));
  const replies = sent.filter((row) => row.chatId === chatId);
  assert.equal(replies.length, 1);
  const text = replies[0]!.text;
  for (const name of ["Scout", "Sniper", "Pulse", "Ledger", "Shield"]) {
    assert.match(text, new RegExp(name));
  }
  assert.match(text, /Big Brain Ape/);
  assert.match(text, /MemeCoin Sniper/);
  assert.match(text, /not live yet/i);
  assert.match(replies[0]!.markup, /Hire Team/);
  assert.match(replies[0]!.markup, /Watch Tape/);
  assert.match(replies[0]!.markup, /Desk Status/);
  assert.doesNotMatch(text, /Clawd|OpenClaw/i);
});

test("hire and a paper snipe stay in one chat and do not broadcast", async () => {
  const chatId = 7102;
  await bot.handleUpdate(update(chatId, "/hire"));
  await bot.handleUpdate(update(chatId, "snipe SLEEPAPE"));
  const replies = sent.filter((row) => row.chatId === chatId);
  assert.equal(replies.length, 2);
  assert.match(replies[0]!.text, /Big Brain Ape/);
  assert.match(replies[0]!.text, /Scout/);
  assert.match(replies[1]!.text, /Shield/);
  assert.match(replies[1]!.text, /Sniper/);
  assert.match(replies[1]!.text, /Ledger/);
  assert.match(replies[1]!.text, /Paper entry SLEEPAPE/);
  assert.match(replies[1]!.text, /Paper mode/);
  assert.match(replies[1]!.text, /No wallet signatures/);
  assert.doesNotMatch(replies[1]!.text, /tx hash|transaction sent|broadcasted/i);
});

test("the Hire Team button seats the troop", async () => {
  const chatId = 7104;
  await bot.handleUpdate(update(chatId, "🦍 Hire Team"));
  const replies = sent.filter((row) => row.chatId === chatId);
  assert.equal(replies.length, 1);
  assert.match(replies[0]!.text, /Troop is hired/);
  assert.match(replies[0]!.text, /Shield/);
});

test("an unhired snipe is refused", async () => {
  const chatId = 7103;
  await bot.handleUpdate(update(chatId, "snipe SLEEPAPE"));
  const replies = sent.filter((row) => row.chatId === chatId);
  assert.equal(replies.length, 1);
  assert.match(replies[0]!.text, /Hire the troop/);
});

function update(chatId: number, text: string) {
  const command = text.startsWith("/") ? text.split(/\s/)[0]! : "";
  return {
    update_id: chatId,
    message: {
      message_id: chatId,
      date: 1_700_000_000,
      chat: { id: chatId, type: "private" as const },
      from: { id: chatId, is_bot: false, first_name: "Casey" },
      text,
      entities: command
        ? [{ type: "bot_command" as const, offset: 0, length: command.length }]
        : undefined,
    },
  };
}
