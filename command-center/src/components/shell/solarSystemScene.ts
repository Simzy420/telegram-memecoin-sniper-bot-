import {
  PLANETS,
  cometState,
  earthMoonAngle,
  jupiterMoonAngles,
  projectAu,
  projectBody,
  stageFor,
  type OrbitPoint,
} from '@/components/shell/solarSystemModel';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

const RADIUS_FRAC: Record<string, number> = {
  sun: 0.068,
  mercury: 0.016,
  venus: 0.036,
  earth: 0.044,
  mars: 0.03,
  jupiter: 0.078,
  saturn: 0.066,
  uranus: 0.044,
  neptune: 0.042,
  moon: 0.017,
};

const SPIN: Record<string, number> = {
  mercury: 0.05,
  venus: -0.025,
  earth: 0.08,
  mars: 0.07,
  jupiter: 0.2,
  saturn: 0.17,
  uranus: 0.06,
  neptune: 0.15,
};

const SHINE: Record<string, number> = {
  mercury: 0.22,
  venus: 0.32,
  earth: 0.55,
  mars: 0.2,
  jupiter: 0.16,
  saturn: 0.14,
  uranus: 0.26,
  neptune: 0.22,
  moon: 0.18,
};

interface Star {
  u: number;
  v: number;
  layer: 0 | 1 | 2;
  size: number;
  phase: number;
  twinkle: number;
  color: string;
  spike: boolean;
}

interface Textures {
  strips: Record<string, HTMLCanvasElement>;
  clouds: HTMLCanvasElement;
  moon: HTMLCanvasElement;
  sun: HTMLCanvasElement;
  stars: Star[];
}

type Body =
  | { kind: 'sun'; depth: number; x: number; y: number; r: number }
  | { kind: 'planet'; id: string; depth: number; x: number; y: number; r: number; spin: number }
  | { kind: 'luna'; depth: number; x: number; y: number; r: number }
  | { kind: 'speck'; depth: number; x: number; y: number; r: number; color: string }
  | { kind: 'comet'; depth: number; x: number; y: number; au: number; sunX: number; sunY: number };

function clampByte(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fade(fx);
  const uy = fade(fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.07, y * 2.07) * 0.3 + vnoise(x * 4.21, y * 4.21) * 0.15;
}

/** Noise that wraps on u so a spinning planet has no texture seam. */
function tileNoise(u: number, v: number, seed: number): number {
  const angle = u * Math.PI * 2;
  const x = Math.cos(angle) * 1.35 + seed;
  const y = Math.sin(angle) * 1.35;
  return fbm(x + 2.2, y + v * 3.1 + seed);
}

function wrapDist(u: number, center: number): number {
  let d = Math.abs(u - center);
  if (d > 0.5) d = 1 - d;
  return d;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStrip(shader: (u: number, v: number) => RGBA): HTMLCanvasElement {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = shader(x / w, y / h);
      const i = (y * w + x) * 4;
      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
      data[i + 3] = clampByte(a);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

interface Crater {
  u: number;
  v: number;
  r: number;
}

function makeCraters(seed: number, count: number): Crater[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    u: rand(),
    v: 0.12 + rand() * 0.76,
    r: 0.012 + rand() * 0.045,
  }));
}

function craterShade(u: number, v: number, craters: Crater[], base: RGB): RGB {
  let shade = 1;
  const n = (tileNoise(u, v, 8) - 0.5) * 0.12;
  for (const crater of craters) {
    const du = wrapDist(u, crater.u);
    const dv = v - crater.v;
    const d = Math.hypot(du, dv * 0.9);
    if (d < crater.r) {
      const rim = d > crater.r * 0.72;
      shade *= rim ? 1.22 : 0.62;
    }
  }
  return [base[0] * (shade + n), base[1] * (shade + n), base[2] * (shade + n)];
}

const MERCURY_CRATERS = makeCraters(11, 42);
const MOON_CRATERS = makeCraters(29, 36);

const LAND = [
  { u: 0.16, v: 0.38, rx: 0.07, ry: 0.14 },
  { u: 0.2, v: 0.62, rx: 0.045, ry: 0.12 },
  { u: 0.46, v: 0.34, rx: 0.05, ry: 0.07 },
  { u: 0.5, v: 0.52, rx: 0.055, ry: 0.13 },
  { u: 0.66, v: 0.4, rx: 0.11, ry: 0.1 },
  { u: 0.78, v: 0.7, rx: 0.05, ry: 0.045 },
];

function earthColor(u: number, v: number): RGBA {
  const iceNorth = v < 0.1 ? (0.1 - v) / 0.1 : 0;
  const iceSouth = v > 0.9 ? (v - 0.9) / 0.1 : 0;
  const ice = Math.min(1, Math.max(iceNorth, iceSouth));
  const coast = tileNoise(u, v, 2) - 0.5;
  let land = 0;
  for (const blob of LAND) {
    const d = Math.hypot(wrapDist(u, blob.u) / blob.rx, (v - blob.v) / blob.ry);
    const edge = d + coast * 0.35;
    if (edge < 1) land = Math.max(land, 1 - edge);
  }
  const deep: RGB = [10, 58, 128];
  const shallow: RGB = [24, 110, 176];
  const ocean = mix(deep, shallow, tileNoise(u, v, 4));
  const forest: RGB = [42, 122, 64];
  const dry: RGB = [176, 146, 88];
  const ground = tileNoise(u + 0.31, v, 6) > 0.58 ? dry : forest;
  let color = land > 0.12 ? mix(ocean, ground, Math.min(1, land)) : ocean;
  if (ice > 0) color = mix(color, [232, 240, 244], ice);
  const grain = (tileNoise(u, v, 9) - 0.5) * 16;
  return [color[0] + grain, color[1] + grain, color[2] + grain, 255];
}

function cloudColor(u: number, v: number): RGBA {
  const n = tileNoise(u, v, 3.4);
  const band = Math.sin(v * Math.PI);
  const coverage = n * 0.75 + band * 0.12;
  if (coverage < 0.58) return [255, 255, 255, 0];
  const alpha = Math.min(168, (coverage - 0.58) * 520);
  return [248, 250, 255, alpha];
}

function gasColor(u: number, v: number, seed: number, palette: RGB[], spot?: { u: number; v: number; color: RGB }): RGBA {
  const n = tileNoise(u, v, seed);
  const bands = Math.sin((v * 16 + (n - 0.5) * 0.55) * Math.PI);
  const idx = Math.min(palette.length - 1, Math.max(0, Math.floor(((bands + 1) / 2) * palette.length)));
  let color = mix(palette[idx], palette[Math.min(palette.length - 1, idx + 1)], 0.35);
  color = mix(color, [255, 246, 230], n * 0.08);
  if (spot) {
    const ellipse = (wrapDist(u, spot.u) / 0.055) ** 2 + ((v - spot.v) / 0.045) ** 2;
    if (ellipse < 1) color = mix(spot.color, color, ellipse);
  }
  return [color[0], color[1], color[2], 255];
}

function buildTextures(): Textures {
  const strips: Record<string, HTMLCanvasElement> = {
    mercury: makeStrip((u, v) => {
      const base: RGB = [148, 142, 136];
      const c = craterShade(u, v, MERCURY_CRATERS, base);
      return [c[0], c[1], c[2], 255];
    }),
    venus: makeStrip((u, v) => {
      const n = tileNoise(u, v, 2.2);
      const swirl = tileNoise(u + v * 0.2, v * 1.4, 5.5);
      const color = mix([214, 170, 96], [246, 228, 186], n * 0.65 + swirl * 0.35);
      return [color[0], color[1], color[2], 255];
    }),
    earth: makeStrip(earthColor),
    mars: makeStrip((u, v) => {
      const n = tileNoise(u, v, 4.2);
      let color = mix([186, 84, 52], [112, 48, 34], n);
      if (wrapDist(u, 0.4) < 0.07 && Math.abs(v - 0.46) < 0.1) color = [86, 40, 32];
      const ice = v < 0.08 ? (0.08 - v) / 0.08 : v > 0.92 ? (v - 0.92) / 0.08 : 0;
      if (ice > 0) color = mix(color, [236, 230, 224], ice);
      return [color[0], color[1], color[2], 255];
    }),
    jupiter: makeStrip((u, v) =>
      gasColor(u, v, 1.1, [
        [236, 224, 198],
        [206, 168, 124],
        [156, 108, 74],
        [112, 74, 56],
        [188, 150, 114],
      ], { u: 0.64, v: 0.58, color: [186, 68, 46] }),
    ),
    saturn: makeStrip((u, v) =>
      gasColor(u, v, 2.8, [
        [244, 228, 196],
        [220, 196, 150],
        [186, 160, 112],
        [214, 188, 142],
      ]),
    ),
    uranus: makeStrip((u, v) => {
      const n = tileNoise(u, v, 6.1);
      const band = 0.5 + Math.sin(v * 10) * 0.04;
      const color = mix([186, 230, 228], [214, 244, 240], n * 0.4 + band);
      return [color[0], color[1], color[2], 255];
    }),
    neptune: makeStrip((u, v) => {
      const n = tileNoise(u, v, 7.7);
      let color = mix([28, 70, 168], [52, 112, 206], n);
      const storm = (wrapDist(u, 0.32) / 0.04) ** 2 + ((v - 0.42) / 0.035) ** 2;
      if (storm < 1) color = mix([220, 230, 240], color, storm);
      return [color[0], color[1], color[2], 255];
    }),
    moon: makeStrip((u, v) => {
      const c = craterShade(u, v, MOON_CRATERS, [168, 166, 160]);
      return [c[0], c[1], c[2], 255];
    }),
  };

  const sun = document.createElement('canvas');
  sun.width = 256;
  sun.height = 256;
  const sunCtx = sun.getContext('2d');
  if (sunCtx) {
    const image = sunCtx.createImageData(256, 256);
    const data = image.data;
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        const dx = x - 128;
        const dy = y - 128;
        const d = Math.hypot(dx, dy) / 112;
        const i = (y * 256 + x) * 4;
        if (d <= 1) {
          const n = fbm(x * 0.09, y * 0.09);
          const limb = d * d;
          data[i] = 255;
          data[i + 1] = clampByte(248 - limb * 80 + n * 18);
          data[i + 2] = clampByte(214 - limb * 150 + n * 10);
          data[i + 3] = 255;
        }
      }
    }
    sunCtx.putImageData(image, 0, 0);
  }

  const rand = mulberry32(2026);
  const colors = ['#f7f8ff', '#f7f8ff', '#f7f8ff', '#d5e4ff', '#ffe3bf', '#ffc7b0'];
  const stars: Star[] = Array.from({ length: 128 }, (_, i) => {
    const layer = (i % 7 === 0 ? 0 : i % 3 === 0 ? 1 : 2) as 0 | 1 | 2;
    return {
      u: rand(),
      v: rand(),
      layer,
      size: layer === 0 ? 1.6 + rand() * 1.4 : rand() > 0.85 ? 1.5 : 1,
      phase: rand() * Math.PI * 2,
      twinkle: layer === 2 ? 0 : 0.6 + rand() * 1.6,
      color: colors[Math.floor(rand() * colors.length)] ?? '#f7f8ff',
      spike: layer === 0 && rand() > 0.72,
    };
  });

  return { strips, clouds: makeStrip(cloudColor), moon: strips.moon, sun, stars };
}

function pointToPixel(point: OrbitPoint, pixelW: number, pixelH: number) {
  return {
    x: (point.x / 100) * pixelW,
    y: (point.y / 100) * pixelH,
    depth: point.depth,
  };
}

/**
 * Procedural solar-system painter. Textures are built once; each frame only
 * blits, shades, and composites so a phone can keep a steady frame rate.
 */
export class SolarSystemScene {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D | null;
  private textures: Textures | null = null;
  private background: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private cssW = 0;
  private cssH = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scratch = document.createElement('canvas');
    this.scratch.width = 192;
    this.scratch.height = 192;
    this.scratchCtx = this.scratch.getContext('2d');
  }

  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    this.cssW = rect.width;
    this.cssH = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.background = null;
      this.vignette = null;
    }
    return true;
  }

  render(timeSec: number, tiltX: number, tiltY: number, still = false): void {
    const ctx = this.ctx;
    if (!ctx || this.cssW < 2 || this.cssH < 2) return;
    if (!this.textures) this.textures = buildTextures();
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = w / this.cssW;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.drawBackground(ctx, w, h);
    this.drawStars(ctx, w, h, timeSec, tiltX, tiltY, still);
    this.drawOrbits(ctx, dpr, tiltY);
    const sun = this.sunPixel(dpr, tiltY);
    this.drawSunGlow(ctx, sun.x, sun.y, sun.r, timeSec, still);

    const bodies = this.collect(timeSec, dpr, tiltY, sun);
    bodies.sort((a, b) => a.depth - b.depth);
    for (const body of bodies) this.drawBody(ctx, body, sun.x, sun.y, dpr);

    if (!still) this.drawMeteors(ctx, timeSec, w, h);
    this.drawVignette(ctx, w, h);
  }

  destroy(): void {
    this.textures = null;
    this.background = null;
    this.vignette = null;
  }

  private radius(id: string, dpr: number): number {
    return (RADIUS_FRAC[id] ?? 0.02) * this.cssW * dpr;
  }

  private sunPixel(dpr: number, tiltY: number): { x: number; y: number; r: number } {
    const point = projectAu(0, 0, this.cssW, this.cssH, tiltY);
    const pixel = pointToPixel(point, this.canvas.width, this.canvas.height);
    return { x: pixel.x, y: pixel.y, r: this.radius('sun', dpr) };
  }

  private collect(
    timeSec: number,
    dpr: number,
    tiltY: number,
    sun: { x: number; y: number; r: number },
  ): Body[] {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const stage = stageFor(this.cssW, this.cssH, tiltY);
    const bodies: Body[] = [{ kind: 'sun', depth: 0, x: sun.x, y: sun.y, r: sun.r }];

    for (const planet of PLANETS) {
      const point = projectBody(planet, timeSec, this.cssW, this.cssH, tiltY);
      const pixel = pointToPixel(point, w, h);
      const r = this.radius(planet.id, dpr);
      bodies.push({
        kind: 'planet',
        id: planet.id,
        depth: point.depth,
        x: pixel.x,
        y: pixel.y,
        r,
        spin: timeSec * (SPIN[planet.id] ?? 0.05),
      });

      if (planet.id === 'earth') {
        const ang = earthMoonAngle(timeSec);
        const dist = r + this.radius('moon', dpr) + 8 * dpr;
        bodies.push({
          kind: 'luna',
          depth: point.depth + -Math.sin(ang) * 0.08,
          x: pixel.x + Math.cos(ang) * dist,
          y: pixel.y - Math.sin(ang) * dist * 0.62,
          r: this.radius('moon', dpr),
        });
      }

      if (planet.id === 'jupiter') {
        const angles = jupiterMoonAngles(timeSec);
        const specks = [
          { factor: 1.28, radius: 3.1, color: '#f2ddb0' },
          { factor: 1.62, radius: 2.6, color: '#f4f1ea' },
          { factor: 2.05, radius: 3.4, color: '#d7c2a4' },
          { factor: 2.48, radius: 2.5, color: '#cfc8c0' },
        ];
        angles.forEach((ang, index) => {
          const speck = specks[index];
          const dist = r * speck.factor;
          bodies.push({
            kind: 'speck',
            depth: point.depth + -Math.sin(ang) * 0.06,
            x: pixel.x + Math.cos(ang) * dist,
            y: pixel.y - Math.sin(ang) * dist * (0.42 + stage.flatten),
            r: speck.radius * dpr,
            color: speck.color,
          });
        });
      }
    }

    const comet = cometState(timeSec, this.cssW, this.cssH, tiltY);
    const cometPixel = pointToPixel(comet, w, h);
    bodies.push({
      kind: 'comet',
      depth: comet.depth + 0.02,
      x: cometPixel.x,
      y: cometPixel.y,
      au: comet.au,
      sunX: sun.x,
      sunY: sun.y,
    });

    return bodies;
  }

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.background) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const bg = canvas.getContext('2d');
      if (!bg) return;
      const sky = bg.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#070b16');
      sky.addColorStop(0.55, '#050814');
      sky.addColorStop(1, '#04060e');
      bg.fillStyle = sky;
      bg.fillRect(0, 0, w, h);

      const violet = bg.createRadialGradient(w * 0.18, h * 0.22, 8, w * 0.18, h * 0.22, w * 0.55);
      violet.addColorStop(0, 'rgba(92, 36, 140, 0.22)');
      violet.addColorStop(1, 'rgba(92, 36, 140, 0)');
      bg.fillStyle = violet;
      bg.fillRect(0, 0, w, h);

      const teal = bg.createRadialGradient(w * 0.86, h * 0.78, 8, w * 0.86, h * 0.78, w * 0.48);
      teal.addColorStop(0, 'rgba(10, 90, 120, 0.18)');
      teal.addColorStop(1, 'rgba(10, 90, 120, 0)');
      bg.fillStyle = teal;
      bg.fillRect(0, 0, w, h);

      bg.save();
      bg.translate(w * 0.5, h * 0.48);
      bg.rotate(-0.55);
      const band = bg.createLinearGradient(0, -h * 0.18, 0, h * 0.18);
      band.addColorStop(0, 'rgba(186, 204, 255, 0)');
      band.addColorStop(0.5, 'rgba(196, 208, 230, 0.09)');
      band.addColorStop(1, 'rgba(186, 204, 255, 0)');
      bg.fillStyle = band;
      bg.fillRect(-w, -h * 0.2, w * 2, h * 0.4);
      bg.restore();
      this.background = canvas;
    }
    ctx.drawImage(this.background, 0, 0);
  }

  private drawStars(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    timeSec: number,
    tiltX: number,
    tiltY: number,
    still: boolean,
  ): void {
    const stars = this.textures?.stars;
    if (!stars) return;
    const speeds = [18, 8, 2.5];
    const parallax = [16, 8, 3];
    for (const star of stars) {
      const drift = still ? 0 : timeSec * speeds[star.layer];
      const shiftX = tiltX * parallax[star.layer];
      const shiftY = tiltY * parallax[star.layer] * 0.45;
      const x = (((star.u * w + drift + shiftX) % w) + w) % w;
      const y = (((star.v * h + shiftY) % h) + h) % h;
      const twinkle = still || star.twinkle === 0 ? 0.85 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(timeSec * star.twinkle + star.phase));
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = star.color;
      ctx.fillRect(x, y, star.size, star.size);
      if (star.spike) {
        ctx.globalAlpha = twinkle * 0.45;
        ctx.fillRect(x - 2.5, y + star.size / 2, star.size + 5, 0.7);
        ctx.fillRect(x + star.size / 2, y - 2.5, 0.7, star.size + 5);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawOrbits(ctx: CanvasRenderingContext2D, dpr: number, tiltY: number): void {
    const stage = stageFor(this.cssW, this.cssH, tiltY);
    const cx = stage.cx * dpr;
    const cy = stage.cy * dpr;
    const scale = stage.scale * dpr;
    ctx.save();
    ctx.lineWidth = Math.max(1, dpr * 0.6);
    for (const planet of PLANETS) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, planet.au * scale, planet.au * scale * stage.flatten, 0, 0, Math.PI * 2);
      ctx.strokeStyle = planet.id === 'earth' ? 'rgba(140, 196, 255, 0.14)' : 'rgba(255, 244, 220, 0.055)';
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSunGlow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    timeSec: number,
    still: boolean,
  ): void {
    const pulse = still ? 1 : 1 + Math.sin(timeSec * 1.35) * 0.035;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(still ? 0.4 : timeSec * 0.12);
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const len = r * (2.15 + Math.sin(timeSec * 0.9 + i) * (still ? 0 : 0.28)) * pulse;
      ctx.strokeStyle = `rgba(255, ${168 + (i % 4) * 16}, 70, 0.07)`;
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * r * 0.9, Math.sin(angle) * r * 0.9);
      ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.restore();

    const glowR = r * 3.3 * pulse;
    const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, glowR);
    glow.addColorStop(0, 'rgba(255, 214, 120, 0.42)');
    glow.addColorStop(0.35, 'rgba(255, 140, 40, 0.16)');
    glow.addColorStop(1, 'rgba(255, 120, 20, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBody(ctx: CanvasRenderingContext2D, body: Body, sunX: number, sunY: number, dpr: number): void {
    if (body.kind === 'sun') {
      const sun = this.textures?.sun;
      if (!sun) return;
      ctx.drawImage(sun, body.x - body.r, body.y - body.r, body.r * 2, body.r * 2);
      return;
    }
    if (body.kind === 'planet') {
      const strip = this.textures?.strips[body.id];
      if (!strip) return;
      if (body.id === 'saturn') this.drawRings(ctx, body.x, body.y, body.r, false);
      this.drawHalo(ctx, body.id, body.x, body.y, body.r);
      const clouds = body.id === 'earth' ? this.textures?.clouds : undefined;
      this.drawSphere(ctx, strip, clouds ?? null, body.x, body.y, body.r, body.spin, sunX, sunY, SHINE[body.id] ?? 0.2);
      this.drawAtmosphere(ctx, body.id, body.x, body.y, body.r, dpr);
      if (body.id === 'saturn') {
        this.drawRingShadow(ctx, body.x, body.y, body.r);
        this.drawRings(ctx, body.x, body.y, body.r, true);
      }
      return;
    }
    if (body.kind === 'luna') {
      const strip = this.textures?.moon;
      if (!strip) return;
      this.drawSphere(ctx, strip, null, body.x, body.y, body.r, 0.15, sunX, sunY, SHINE.moon);
      return;
    }
    if (body.kind === 'speck') {
      ctx.beginPath();
      ctx.fillStyle = body.color;
      ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    this.drawComet(ctx, body);
  }

  private drawSphere(
    ctx: CanvasRenderingContext2D,
    strip: HTMLCanvasElement,
    clouds: HTMLCanvasElement | null,
    x: number,
    y: number,
    radius: number,
    rotation: number,
    sunX: number,
    sunY: number,
    shine: number,
  ): void {
    const sctx = this.scratchCtx;
    if (!sctx || radius < 0.75) return;
    const size = 192;
    sctx.clearRect(0, 0, size, size);
    sctx.save();
    sctx.beginPath();
    sctx.arc(size / 2, size / 2, size / 2 - 0.75, 0, Math.PI * 2);
    sctx.clip();
    const drawW = size * (strip.width / strip.height);
    const shift = (((rotation % 1) + 1) % 1) * drawW;
    sctx.drawImage(strip, -shift, 0, drawW, size);
    sctx.drawImage(strip, -shift + drawW, 0, drawW, size);
    if (clouds) {
      const cloudShift = ((((rotation * 1.35) % 1) + 1) % 1) * drawW;
      sctx.drawImage(clouds, -cloudShift, 0, drawW, size);
      sctx.drawImage(clouds, -cloudShift + drawW, 0, drawW, size);
    }

    const dx = sunX - x;
    const dy = sunY - y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const hx = size / 2 + ux * size * 0.28;
    const hy = size / 2 + uy * size * 0.28;
    const spec = sctx.createRadialGradient(hx, hy, size * 0.02, size / 2, size / 2, size * 0.55);
    spec.addColorStop(0, `rgba(255,255,255,${0.12 + shine * 0.5})`);
    spec.addColorStop(0.2, `rgba(255,255,255,${shine * 0.14})`);
    spec.addColorStop(0.48, 'rgba(0,0,0,0)');
    spec.addColorStop(1, 'rgba(0,0,0,0.5)');
    sctx.fillStyle = spec;
    sctx.fillRect(0, 0, size, size);

    const term = sctx.createLinearGradient(
      size / 2 + ux * size,
      size / 2 + uy * size,
      size / 2 - ux * size,
      size / 2 - uy * size,
    );
    term.addColorStop(0, 'rgba(0,0,0,0)');
    term.addColorStop(0.45, 'rgba(0,0,0,0)');
    term.addColorStop(0.7, 'rgba(0,0,0,0.38)');
    term.addColorStop(1, 'rgba(0,0,0,0.78)');
    sctx.fillStyle = term;
    sctx.fillRect(0, 0, size, size);

    const limb = sctx.createRadialGradient(size / 2, size / 2, size * 0.42, size / 2, size / 2, size * 0.5);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(0,0,0,0.5)');
    sctx.fillStyle = limb;
    sctx.fillRect(0, 0, size, size);
    sctx.restore();

    ctx.drawImage(this.scratch, x - radius, y - radius, radius * 2, radius * 2);
  }

  private drawAtmosphere(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, radius: number, dpr: number): void {
    const atmos: Record<string, { color: string; width: number }> = {
      venus: { color: 'rgba(255, 214, 150, 0.45)', width: 2.4 },
      earth: { color: 'rgba(132, 196, 255, 0.6)', width: 2.2 },
      mars: { color: 'rgba(255, 140, 90, 0.28)', width: 1.6 },
    };
    const style = atmos[id];
    if (!style) return;
    ctx.beginPath();
    ctx.arc(x, y, radius + style.width * dpr * 0.35, 0, Math.PI * 2);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width * dpr;
    ctx.stroke();
  }

  private drawHalo(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, radius: number): void {
    const halos: Record<string, string> = {
      earth: 'rgba(90, 170, 255, 0.22)',
      venus: 'rgba(255, 196, 120, 0.16)',
      mars: 'rgba(255, 120, 70, 0.12)',
    };
    const color = halos[id];
    if (!color) return;
    const glow = ctx.createRadialGradient(x, y, radius * 0.9, x, y, radius * 1.85);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.85, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRings(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, front: boolean): void {
    const tilt = 0.46;
    const bands = [
      { r: 2.2, width: 0.14, color: 'rgba(196, 164, 112, 0.35)' },
      { r: 1.95, width: 0.2, color: 'rgba(250, 228, 190, 0.88)' },
      { r: 1.72, width: 0.07, color: 'rgba(36, 24, 14, 0.8)' },
      { r: 1.52, width: 0.22, color: 'rgba(236, 206, 154, 0.92)' },
      { r: 1.28, width: 0.1, color: 'rgba(154, 122, 78, 0.6)' },
    ];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.48);
    ctx.scale(1, tilt);
    ctx.beginPath();
    ctx.rect(-radius * 4, front ? 0 : -radius * 4, radius * 8, radius * 4);
    ctx.clip();
    ctx.lineCap = 'butt';
    for (const band of bands) {
      ctx.beginPath();
      ctx.arc(0, 0, radius * band.r, 0, Math.PI * 2);
      ctx.strokeStyle = band.color;
      ctx.lineWidth = (radius * band.width) / tilt;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRingShadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(-0.42);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(-radius, -radius * 0.08, radius * 2, radius * 0.16);
    ctx.restore();
  }

  private drawComet(ctx: CanvasRenderingContext2D, body: Extract<Body, { kind: 'comet' }>): void {
    const dx = body.x - body.sunX;
    const dy = body.y - body.sunY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tail = (1.15 - Math.min(body.au, 1.1)) * this.cssW * (this.canvas.width / this.cssW) * 0.22;
    const steps = 14;
    for (let i = steps; i >= 1; i -= 1) {
      const t = i / steps;
      ctx.beginPath();
      ctx.fillStyle = `rgba(186, 214, 255, ${0.22 * (1 - t)})`;
      ctx.arc(body.x + ux * tail * t, body.y + uy * tail * t, 1.2 + t * tail * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.fillStyle = '#f4fbff';
    ctx.arc(body.x, body.y, Math.max(1.6, tail * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMeteors(ctx: CanvasRenderingContext2D, timeSec: number, w: number, h: number): void {
    this.strokeMeteor(ctx, timeSec, w, h, 3.6, 17);
    this.strokeMeteor(ctx, timeSec + 1.7, w, h, 4.4, 41);
  }

  private strokeMeteor(
    ctx: CanvasRenderingContext2D,
    timeSec: number,
    w: number,
    h: number,
    period: number,
    seed: number,
  ): void {
    const local = ((timeSec % period) + period) % period;
    const duration = 0.72;
    if (local > duration) return;
    const slot = Math.floor(timeSec / period);
    const rand = mulberry32(seed + slot * 13);
    const angle = 0.35 + rand() * 0.7;
    const x0 = rand() * w * 0.8;
    const y0 = rand() * h * 0.55;
    const travel = local * w * 0.55;
    const x = x0 + Math.cos(angle) * travel;
    const y = y0 + Math.sin(angle) * travel;
    const tail = 24 + rand() * 36;
    const fadeIn = local < 0.08 ? local / 0.08 : 1;
    const fadeOut = 1 - Math.max(0, local - 0.45) / (duration - 0.45);
    const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut));
    const x2 = x - Math.cos(angle) * tail;
    const y2 = y - Math.sin(angle) * tail;
    const grad = ctx.createLinearGradient(x2, y2, x, y);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, `rgba(255, 244, 220, ${0.9 * alpha})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.vignette) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const gtx = canvas.getContext('2d');
      if (!gtx) return;
      const vignette = gtx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h * 0.55, w * 0.72);
      vignette.addColorStop(0, 'rgba(5, 8, 22, 0)');
      vignette.addColorStop(1, 'rgba(5, 8, 22, 0.78)');
      gtx.fillStyle = vignette;
      gtx.fillRect(0, 0, w, h);
      this.vignette = canvas;
    }
    ctx.drawImage(this.vignette, 0, 0);
  }
}
