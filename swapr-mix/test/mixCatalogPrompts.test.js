import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIX_CLIP_NEGATIVE,
  MIX_CLIP_PROMPTS,
  applyMixCatalogPrompts,
} from "../server/mixCatalogPrompts.js";

describe("mixCatalogPrompts", () => {
  it("rewrites known clips with Mix face-lock prompts", () => {
    const out = applyMixCatalogPrompts([
      { id: "demo-wave", title: "Wave Hello", prompt: "old scene text", negative_prompt: "old neg" },
      { id: "unknown-clip", prompt: "keep me", negative_prompt: "" },
    ]);
    assert.match(out[0].prompt, /exact face|uploaded reference photo/i);
    assert.match(out[0].prompt, /waving|palms/i);
    assert.equal(out[0].negative_prompt, MIX_CLIP_NEGATIVE);
    assert.equal(out[1].prompt, "keep me");
    assert.equal(out[1].negative_prompt, MIX_CLIP_NEGATIVE);
  });

  it("covers every current catalog id we ship prompts for", () => {
    assert.ok(Object.keys(MIX_CLIP_PROMPTS).length >= 20);
    assert.match(MIX_CLIP_PROMPTS["tongue-tease"].prompt, /tongue/i);
    assert.match(MIX_CLIP_PROMPTS["scissor-sisters"].prompt, /two marked women/i);
    assert.match(MIX_CLIP_NEGATIVE, /melted props/i);
  });
});
