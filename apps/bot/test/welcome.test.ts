import assert from "node:assert/strict";
import { test } from "node:test";
import { SPECIALISTS, startWelcomeCopy } from "../src/handlers/welcome.ts";

test("welcome copy names the troop and stays on-brand", () => {
  const text = startWelcomeCopy();
  for (const name of ["Sniper", "Scout", "Guard", "Arbiter", "Router"]) {
    assert.match(text, new RegExp(name));
  }
  assert.equal(SPECIALISTS.length, 5);
  assert.match(text, /not live yet/i);
  assert.match(text, /MemeCoin Sniper/);
  assert.doesNotMatch(text, /Clawd|OpenClaw|clawd/i);
});
