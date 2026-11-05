import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode } from "jpeg-js";
import { buildRunpodInput } from "../server/runpod.js";
import { compositeReferenceStill, propInsetRect } from "../server/referenceStill.js";

const MOTION =
  "https://huggingface.co/datasets/Simzy/wan22-template-clips/resolve/main/templates/demo-dance.mp4";

function solidJpeg(width, height, rgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(encode({ data, width, height }, 95).data);
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

describe("reference still composite", () => {
  it("insets the prop still into the corner of the person still", () => {
    const person = solidJpeg(80, 120, [220, 20, 20]);
    const prop = solidJpeg(40, 30, [20, 20, 220]);
    const composed = compositeReferenceStill(person, prop);
    assert.ok(composed);
    const image = decode(composed, { useTArray: true, formatAsRGBA: true });
    const corner = pixel(image, 4, 4);
    assert.ok(corner[0] > corner[2] + 40, `top-left stayed the person color, got ${corner}`);
    const rect = propInsetRect(80, 120, 40, 30);
    const inset = pixel(image, rect.x + Math.floor(rect.dw / 2), rect.y + Math.floor(rect.dh / 2));
    assert.ok(inset[2] > inset[0] + 40, `prop inset is visible, got ${inset}`);
  });

  it("leaves non-JPEG bytes alone", () => {
    assert.equal(compositeReferenceStill(Buffer.from("not-a-jpeg"), Buffer.from("also-not")), null);
  });

  it("sends both stills and both replace marks to Runpod", () => {
    const person = solidJpeg(80, 120, [220, 20, 20]);
    const prop = solidJpeg(40, 30, [20, 20, 220]);
    const input = buildRunpodInput({
      image_base64: person.toString("base64"),
      prop_image_base64: prop.toString("base64"),
      video_url: MOTION,
      prompt: "a person",
      positive_points: [{ x: 10, y: 20 }],
      prop_points: [{ x: 30, y: 40 }],
    });
    assert.equal(input.prop_image_base64, prop.toString("base64"));
    assert.notEqual(input.image_base64, person.toString("base64"));
    assert.match(input.prompt, /marked handheld prop/);
    assert.doesNotMatch(input.prompt, /keep every handheld|props to keep/i);
    assert.deepEqual(JSON.parse(input.coordinates), [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    assert.deepEqual(JSON.parse(input.neg_coordinates), [{ x: 0, y: 0 }]);
    const image = decode(Buffer.from(input.image_base64, "base64"), { useTArray: true, formatAsRGBA: true });
    const rect = propInsetRect(image.width, image.height, 40, 30);
    const inset = pixel(image, rect.x + Math.floor(rect.dw / 2), rect.y + Math.floor(rect.dh / 2));
    assert.ok(inset[2] > inset[0] + 40);
  });
});
