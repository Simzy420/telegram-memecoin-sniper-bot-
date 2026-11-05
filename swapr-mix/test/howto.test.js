import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

const dialog = sliceBetween(html, '<dialog id="howto-dialog"', "</dialog>");
const header = sliceBetween(html, '<header class="top">', "</header>");

describe("How to Use panel", () => {
  it("puts a prominent dialog button in the header", () => {
    assert.match(header, /id="btn-howto"/);
    assert.match(header, /class="howto-launch"/);
    assert.match(header, /aria-haspopup="dialog"/);
    assert.match(header, /aria-controls="howto-dialog"/);
    assert.match(header, />\s*How to Use\s*</);
    assert.match(css, /\.howto-launch\s*\{[^}]*min-height:\s*52px/s);
    assert.match(css, /\.howto-launch\s*\{[^}]*width:\s*100%/s);
  });

  it("opens a closeable panel from the same controls", () => {
    assert.match(dialog, /aria-labelledby="howto-title"/);
    assert.match(dialog, /id="howto-title">How to Use</);
    assert.match(dialog, /id="btn-howto-close"/);
    assert.match(dialog, />\s*Close\s*</);
    assert.match(main, /howtoDialog\.showModal/);
    assert.match(main, /howtoDialog\.close/);
    assert.match(main, /addEventListener\("close"/);
    assert.match(main, /howtoBtn\.focus\(\)/);
  });

  it("explains the real non-explicit flow, startup wait, result, and Extend limit", () => {
    assert.match(dialog, /dancing/);
    assert.match(dialog, /walking/);
    assert.match(dialog, /cup/);
    assert.match(dialog, /phone/);
    assert.match(dialog, /Mark person/);
    assert.match(dialog, /Mark keep/);
    assert.match(dialog, /Generate Mix/);
    assert.match(dialog, /at least one green person mark/);
    assert.match(dialog, /several minutes while the Runpod worker starts/);
    assert.match(dialog, /Leave this tab open/);
    assert.match(dialog, /Stop GPU/);
    assert.match(dialog, /<strong>Download<\/strong> saves the file/);
    assert.match(dialog, /Save to Photos/);
    assert.match(dialog, /share sheet/);
    assert.match(dialog, /8 to 22 seconds/);
    assert.match(dialog, /Extend once/);
    assert.match(dialog, /Auto-extend/);
    assert.match(dialog, /cannot continue a Runpod clip/);
    assert.match(dialog, /Generate on this page runs on Runpod/);
    assert.doesNotMatch(dialog, /genital|sexual|explicit|nsfw/i);
  });
});
