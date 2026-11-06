import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GENERATE_EXPECTED_MS,
  formatRemaining,
  generateProgress,
  progressLabel,
} from "../server/generateProgress.js";
import { SWAPR_TEMPLATE_PROMPT, templatePromptText } from "../server/templatePrompt.js";

describe("generate progress", () => {
  it("starts full and counts down to the estimate", () => {
    const start = generateProgress(0, GENERATE_EXPECTED_MS);
    assert.equal(start.percent, 0);
    assert.equal(start.over, false);
    assert.equal(progressLabel(start), "About 5:00 left");
    const mid = generateProgress(GENERATE_EXPECTED_MS / 2, GENERATE_EXPECTED_MS);
    assert.equal(mid.percent, 48);
    assert.equal(formatRemaining(mid.remainingMs), "2:30");
  });

  it("stays under 100% and says it is still working after the estimate", () => {
    const over = generateProgress(GENERATE_EXPECTED_MS + 30_000, GENERATE_EXPECTED_MS);
    assert.equal(over.over, true);
    assert.equal(over.remainingMs, 0);
    assert.ok(over.percent >= 95 && over.percent < 100);
    assert.match(progressLabel(over), /longer than usual/);
  });
});

describe("template prompt", () => {
  it("uses the catalog prompt, matching Swapr", () => {
    assert.equal(templatePromptText({ prompt: "  wave hello  " }), "wave hello");
    assert.equal(templatePromptText({}), SWAPR_TEMPLATE_PROMPT);
    assert.equal(templatePromptText(null), SWAPR_TEMPLATE_PROMPT);
  });
});
