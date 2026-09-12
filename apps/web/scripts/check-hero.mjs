import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const web = resolve(root, "apps/web");
const failures = [];

function fail(msg) {
  failures.push(msg);
}

function read(rel) {
  return readFileSync(resolve(web, rel), "utf8");
}

if (!existsSync(resolve(web, "public/mascot-hero-full.jpeg"))) {
  fail("public/mascot-hero-full.jpeg is missing");
}
if (!existsSync(resolve(web, "public/mascot-cutout.jpg"))) {
  fail("public/mascot-cutout.jpg is missing");
}
if (existsSync(resolve(web, "public/mascot.jpg"))) {
  fail("public/mascot.jpg must stay deleted — do not reuse a cropped stand-in");
}

const index = read("src/pages/index.astro");
const layout = read("src/layouts/BaseLayout.astro");
const docs = read("src/pages/docs.astro");
const css = read("src/styles/global.css");

if (!index.includes('src="/mascot-hero-full.jpeg"')) {
  fail("homepage must use /mascot-hero-full.jpeg as the hero");
}
if (index.includes('src="/mascot-cutout.jpg"')) {
  fail("homepage must not use the cutout as the hero");
}
for (const name of ["Scout", "Sniper", "Pulse", "Ledger", "Shield"]) {
  if (!index.includes(name) || !docs.includes(name)) {
    fail(`${name} must appear on the homepage and docs`);
  }
}
if (!index.toLowerCase().includes("not live")) {
  fail("homepage must say the trading engine is not live");
}

if (!layout.includes("/mascot-cutout.jpg")) {
  fail("layout must use the cutout for header/favicon");
}
if (layout.includes("mascot-hero-full.jpeg") && !layout.includes('og:image')) {
  fail("layout should not use the hero file for chrome");
}
if (layout.includes('href="/mascot-hero-full.jpeg"') || layout.includes('src="/mascot-hero-full.jpeg"')) {
  fail("layout header/favicon must not use the hero file");
}
if (!docs.includes("/mascot-cutout.jpg")) {
  fail("docs avatar must use the cutout");
}

if (!css.includes("object-fit: contain")) {
  fail("CSS must contain object-fit: contain for the uncropped hero");
}
if (/hero-mascot[\s\S]{0,200}object-fit:\s*cover/.test(css)) {
  fail("hero-mascot must not use object-fit: cover");
}
if (/hero-scene[\s\S]{0,200}object-fit:\s*cover/.test(css)) {
  fail("hero-scene must not use object-fit: cover");
}

const branded = index + layout + docs;
if (/Clawd|OpenClaw/i.test(branded)) {
  fail("site copy must not mention Clawd or OpenClaw");
}
for (const retired of ["Guard", "Arbiter", "Router"]) {
  if (new RegExp(`\\b${retired}\\b`).test(branded)) {
    fail(`${retired} must not appear in user-facing site copy`);
  }
}

if (failures.length) {
  console.error("hero/brand checks failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("hero/brand checks passed");
