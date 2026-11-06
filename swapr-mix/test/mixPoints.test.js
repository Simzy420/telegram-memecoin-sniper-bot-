import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEGACY_KEEP_PROMPTS,
  MIX_DEFAULT_NEGATIVE,
  MIX_DEFAULT_PROMPT,
  MIX_MULTI_PROMPT,
  MIX_MULTI_PROP_PROMPT,
  MIX_PROP_PROMPT,
  buildMaskPointFields,
  mixPrompt,
  mixStockPrompt,
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

  it("puts person and prop marks in the positive SAM set", () => {
    const fields = buildMaskPointFields({
      positive_points: [{ x: 50, y: 80 }],
      prop_points: [{ x: 120, y: 90 }],
      negative_points: [{ x: 5, y: 5 }],
      frame_width: 100,
      frame_height: 100,
      width: 200,
      height: 200,
    });
    assert.ok(fields.points_store);
    assert.deepEqual(JSON.parse(fields.coordinates), [
      { x: 100, y: 160 },
      { x: 240, y: 180 },
    ]);
    assert.deepEqual(JSON.parse(fields.neg_coordinates), [{ x: 0, y: 0 }]);
    const store = JSON.parse(fields.points_store);
    assert.equal(store.positive.length, 2);
    assert.equal(store.negative.length, 1);
    assert.deepEqual(store.negative, [{ x: 0, y: 0 }]);
  });

  it("adds a dummy negative point when no prop is marked", () => {
    const fields = buildMaskPointFields({ positive_points: [{ x: 1, y: 2 }] });
    assert.deepEqual(JSON.parse(fields.neg_coordinates), [{ x: 0, y: 0 }]);
    assert.equal(JSON.parse(fields.coordinates).length, 1);
  });

  it("exports replace-person and replace-prop prompts", () => {
    assert.match(MIX_DEFAULT_PROMPT, /marked person/i);
    assert.doesNotMatch(MIX_DEFAULT_PROMPT, /keep every handheld|props to keep/i);
    assert.match(MIX_PROP_PROMPT, /marked handheld prop/i);
    assert.match(MIX_PROP_PROMPT, /corner of the reference photo/i);
    assert.match(MIX_DEFAULT_NEGATIVE, /最差质量|畸形的/);
    assert.equal(mixPrompt(LEGACY_KEEP_PROMPTS[0], false), MIX_DEFAULT_PROMPT);
    assert.equal(mixPrompt(MIX_PROP_PROMPT, false), MIX_DEFAULT_PROMPT);
    assert.equal(mixPrompt(MIX_DEFAULT_PROMPT, true), MIX_PROP_PROMPT);
    assert.match(mixPrompt("a person", true), /marked handheld prop/);
    assert.equal(mixStockPrompt(false, 1), MIX_DEFAULT_PROMPT);
    assert.equal(mixStockPrompt(true, 1), MIX_PROP_PROMPT);
    assert.equal(mixPrompt(MIX_DEFAULT_PROMPT, false, 2), MIX_MULTI_PROMPT);
    assert.equal(mixPrompt(MIX_PROP_PROMPT, true, 2), MIX_MULTI_PROP_PROMPT);
    assert.match(MIX_MULTI_PROMPT, /left to right/);
    assert.match(MIX_MULTI_PROP_PROMPT, /each marked handheld prop/);
    assert.doesNotMatch(MIX_MULTI_PROMPT, /keep every handheld|props to keep/i);
    assert.match(mixPrompt("a person", false, 2), /each marked person/);
    assert.doesNotMatch(mixPrompt("a person", false, 1), /each marked person/);
  });
});
