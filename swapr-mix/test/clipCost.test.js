import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clipCompute, formatClipCost } from "../server/clipCost.js";

describe("clip compute cost", () => {
  it("turns worker milliseconds and an hourly rate into a dollar estimate", () => {
    const compute = clipCompute(90_000, 2);
    assert.equal(compute.seconds, 90);
    assert.equal(compute.dollars, 0.05);
    assert.equal(formatClipCost(compute), "GPU time 1 min 30 sec · about $0.05 at $2.00/hr.");
  });

  it("reports GPU time when the hourly rate is missing", () => {
    const compute = clipCompute(12_000, null);
    assert.equal(formatClipCost(compute), "GPU time 12 sec.");
  });

  it("says under a cent for a very short clip", () => {
    assert.match(formatClipCost(clipCompute(1_000, 0.5)), /under \$0\.01/);
  });
});
