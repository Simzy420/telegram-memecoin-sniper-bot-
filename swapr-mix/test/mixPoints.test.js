import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIX_DEFAULT_NEGATIVE,
  MIX_DEFAULT_PROMPT,
  buildMaskPointFields,
  normalizePoints,
  scalePoints,
} from "../server/mixPoints.js";

describe("mixPoints", () => {
  it("normalizes finite x/y pairs only", () => {
    assert.deepEqual(
      normalizePoints([
        { x: 10, y: 20 },
        { x: "bad", y: 1 },
        null,
        { x: 3, y: 4 },
      ]),
      [
        { x: 10, y: 20 },
        { x: 3, y: 4 },
      ],
    );
  });

  it("scales points from the frame into the worker size", () => {
    const scaled = scalePoints([{ x: 100, y: 200 }], 200, 400, 480, 832);
    assert.equal(scaled[0].x, 240);
    assert.equal(scaled[0].y, 416);
  });

  it("requires at least one positive point for SAM fields", () => {
    assert.deepEqual(buildMaskPointFields({ positive_points: [], negative_points: [{ x: 1, y: 1 }] }), {});
  });

  it("builds hub points_store / coordinates / neg_coordinates", () => {
    const fields = buildMaskPointFields({
      positive_points: [{ x: 50, y: 80 }],
      negative_points: [{ x: 120, y: 90 }],
      frame_width: 100,
      frame_height: 100,
      width: 200,
      height: 200,
    });
    assert.ok(fields.points_store);
    assert.deepEqual(JSON.parse(fields.coordinates), [{ x: 100, y: 160 }]);
    assert.deepEqual(JSON.parse(fields.neg_coordinates), [{ x: 240, y: 180 }]);
    const store = JSON.parse(fields.points_store);
    assert.equal(store.positive.length, 1);
    assert.equal(store.negative.length, 1);
  });

  it("adds a dummy negative point when none are marked", () => {
    const fields = buildMaskPointFields({ positive_points: [{ x: 1, y: 2 }] });
    assert.deepEqual(JSON.parse(fields.neg_coordinates), [{ x: 0, y: 0 }]);
  });

  it("exports Mix prompt defaults that mention props", () => {
    assert.match(MIX_DEFAULT_PROMPT, /handheld object|prop/i);
    assert.match(MIX_DEFAULT_NEGATIVE, /最差质量|畸形的/);
  });
});
