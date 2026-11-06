import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateBlockReason, slotLabel } from "../server/markPairing.js";

const face = { name: "a.jpg" };
const prop = { name: "cup.jpg" };

describe("mark pairing", () => {
  it("labels slots in tap order", () => {
    assert.equal(slotLabel("person", 0), "Person 1");
    assert.equal(slotLabel("person", 1), "Person 2");
    assert.equal(slotLabel("prop", 0), "Prop 1");
  });

  it("requires a face for every green mark", () => {
    assert.match(generateBlockReason({ hasMotion: false, personFiles: [] }), /Pick a motion/);
    assert.match(generateBlockReason({ hasMotion: true, personFiles: [] }), /every green mark/);
    assert.match(generateBlockReason({ hasMotion: true, personFiles: [face, null] }), /Person 2/);
    assert.equal(generateBlockReason({ hasMotion: true, personFiles: [face] }), "");
    assert.equal(generateBlockReason({ hasMotion: true, personFiles: [face, face], propFiles: [] }), "");
  });

  it("requires a still for every red mark and allows person-only", () => {
    assert.match(generateBlockReason({ hasMotion: true, personFiles: [face], propFiles: [null] }), /Prop 1/);
    assert.match(
      generateBlockReason({ hasMotion: true, personFiles: [face, face], propFiles: [prop, null] }),
      /Prop 2/,
    );
    assert.equal(
      generateBlockReason({ hasMotion: true, personFiles: [face, face], propFiles: [prop, prop] }),
      "",
    );
  });
});
