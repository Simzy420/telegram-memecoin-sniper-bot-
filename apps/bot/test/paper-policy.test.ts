import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_CANDIDATES } from "../src/team/candidates.ts";
import { handleDeskTurn } from "../src/team/desk.ts";
import { executionGate } from "../src/team/gate.ts";
import { submitLiveOrder } from "../src/team/live.ts";
import {
  freshDesk,
  PAPER_CAUTION_USD,
  PAPER_POLICY_LINE,
  PAPER_SIZE_USD,
  paperClipUsd,
} from "../src/team/paper.ts";
import { renderDesk } from "../src/team/render.ts";
import { runShield } from "../src/team/safety.ts";

const quiet = { env: {} as Record<string, string | undefined> };

test("paper clip dollars follow the shield verdict", () => {
  assert.equal(paperClipUsd("pass"), PAPER_SIZE_USD);
  assert.equal(paperClipUsd("pass"), 50);
  assert.equal(paperClipUsd("caution"), PAPER_CAUTION_USD);
  assert.equal(paperClipUsd("caution"), 25);
  assert.equal(paperClipUsd("block"), null);
});

test("PASS fills $50, CAUTION fills $25, BLOCK and an unknown card do not fill", async () => {
  const pass = EXAMPLE_CANDIDATES.find((c) => c.symbol === "SLEEPAPE")!;
  const caution = EXAMPLE_CANDIDATES.find((c) => c.symbol === "PAPERPEPE")!;
  const block = EXAMPLE_CANDIDATES.find((c) => c.symbol === "RUGPUP")!;
  assert.equal(runShield(pass).verdict, "pass");
  assert.equal(runShield(caution).verdict, "caution");
  assert.equal(runShield(block).verdict, "block");

  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), ...quiet });
  assert.match(renderDesk(hired.lines), /PASS is a \$50 paper clip/);
  assert.match(renderDesk(hired.lines), /CAUTION is a \$25 paper clip/);
  assert.match(renderDesk(hired.lines), /do not fill/);

  const passed = await handleDeskTurn({
    text: "snipe SLEEPAPE",
    state: hired.state,
    ...quiet,
  });
  assert.equal(passed.state.positions.length, 1);
  assert.equal(passed.state.positions[0]?.sizeUsd, 50);
  assert.equal(passed.state.cashUsd, 950);
  assert.equal(passed.events.find((event) => event.action === "paper_fill")?.size, 50);
  assert.match(renderDesk(passed.lines), /\$50\.00/);
  assert.match(renderDesk(passed.lines), /Shield/);
  assert.match(renderDesk(passed.lines), /No transaction broadcast|no transaction broadcaster/i);

  const cautious = await handleDeskTurn({
    text: "snipe PAPERPEPE",
    state: hired.state,
    ...quiet,
  });
  assert.equal(cautious.state.positions.length, 1);
  assert.equal(cautious.state.positions[0]?.symbol, "PAPERPEPE");
  assert.equal(cautious.state.positions[0]?.sizeUsd, 25);
  assert.equal(cautious.state.cashUsd, 975);
  assert.match(cautious.state.positions[0]?.note ?? "", /Caution clip/);
  assert.equal(cautious.events.find((event) => event.action === "paper_fill")?.size, 25);
  assert.ok(
    cautious.events
      .find((event) => event.action === "paper_fill")
      ?.tags?.includes("strategy:caution-clip"),
  );
  const cautionText = renderDesk(cautious.lines);
  assert.match(cautionText, /\$25\.00/);
  assert.match(cautionText, /Caution clip is \$25 paper/);
  assert.match(cautionText, /Not a live buy/);
  assert.doesNotMatch(cautionText, /broadcast: true|transaction sent/i);

  const blocked = await handleDeskTurn({
    text: "snipe RUGPUP",
    state: hired.state,
    ...quiet,
  });
  assert.equal(blocked.state.positions.length, 0);
  assert.equal(blocked.state.cashUsd, 1000);
  assert.equal(blocked.events.some((event) => event.action === "paper_fill"), false);
  const blockedText = renderDesk(blocked.lines);
  assert.match(blockedText, /BLOCK/);
  assert.match(blockedText, /No paper fill/);
  assert.doesNotMatch(blockedText, /Paper entry/);

  const unknown = await handleDeskTurn({
    text: "snipe NOTATOKEN",
    state: hired.state,
    ...quiet,
  });
  assert.equal(unknown.state.positions.length, 0);
  assert.equal(unknown.state.cashUsd, 1000);
  const unknownText = renderDesk(unknown.lines);
  assert.match(unknownText, /Unknown card/);
  assert.match(unknownText, /NEEDS DATA/);
  assert.match(unknownText, /No paper fill/);
  assert.equal(unknown.events.some((event) => event.action === "paper_fill"), false);
});

test("help and status show the caution clip is $25 paper only", async () => {
  const help = await handleDeskTurn({ text: "/help", state: freshDesk(), ...quiet });
  const helpText = renderDesk(help.lines);
  assert.match(helpText, new RegExp(escapeReg(PAPER_POLICY_LINE)));
  assert.match(helpText, /CAUTION \$25/);
  assert.match(helpText, /paper only/);
  assert.match(helpText, /Entry waits on Shield/);
  assert.match(helpText, /does not broadcast/);
  assert.match(helpText, /Still UNKNOWN/);
  assert.match(helpText, /RugCheck down/);

  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), ...quiet });
  const status = await handleDeskTurn({
    text: "/status",
    state: hired.state,
    env: {},
  });
  const statusText = renderDesk(status.lines);
  assert.match(statusText, /CAUTION \$25/);
  assert.match(statusText, /paper only/);
  assert.match(statusText, /Paper mode/);
  assert.match(statusText, /No wallet signatures and no broadcasts/);
});

test("an armed live gate still never broadcasts a caution clip", async () => {
  const hired = await handleDeskTurn({ text: "/hire", state: freshDesk(), ...quiet });
  const env = {
    LIVE_TRADING: "true",
    LIVE_TRADING_CONFIRM: "I_UNDERSTAND",
    WALLET_ENCRYPTION_KEY: "c".repeat(32),
  };
  const gate = executionGate(env);
  assert.equal(gate.liveEnabled, true);
  assert.equal(gate.broadcast, false);

  const armed = await handleDeskTurn({
    text: "snipe PAPERPEPE",
    state: hired.state,
    env,
  });
  assert.equal(armed.state.positions.length, 0);
  assert.equal(armed.state.cashUsd, 1000);
  assert.equal(armed.events.some((event) => event.action === "paper_fill"), false);
  const refused = armed.events.find((event) => event.action === "live_refused");
  assert.equal(refused?.mode, "live");
  assert.equal(refused?.size, 25);
  assert.ok(refused?.tags?.includes("no-broadcast"));
  const text = renderDesk(armed.lines);
  assert.match(text, /not sent|no signer|no transaction broadcaster/i);
  assert.match(text, /Caution clip is \$25 paper|CAUTION/);

  const order = submitLiveOrder(
    {
      symbol: "PAPERPEPE",
      chain: "solana",
      side: "buy",
      sizeUsd: 25,
      shieldVerdict: "caution",
    },
    env,
  );
  assert.equal(order.accepted, false);
  assert.equal(order.signed, false);
  assert.equal(order.broadcast, false);
  assert.equal(order.txId, null);
});

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
