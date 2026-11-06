/**
 * The Wan Animate Runpod handler has one reference image (image_base64).
 * Several faces are already one JPEG by the time they get here: the phone
 * places Person 1, Person 2, … left to right. This module only insets the
 * prop still into the corner of that image so the worker sees the prop too.
 * prop_image_base64 is still sent alongside the composite. One face is
 * letterboxed alone, then the prop is inset the same way.
 */
import { decode, encode } from "jpeg-js";

export function propInsetRect(frameW, frameH, propW, propH) {
  const border = 3;
  const margin = Math.max(4, Math.round(frameW * 0.04));
  const maxW = Math.max(1, Math.round(frameW * 0.34) - border * 2);
  const maxH = Math.max(1, Math.round(frameH * 0.28) - border * 2);
  const scale = Math.min(maxW / propW, maxH / propH);
  const dw = Math.max(1, Math.round(propW * scale));
  const dh = Math.max(1, Math.round(propH * scale));
  const x = frameW - margin - border - dw;
  const y = frameH - margin - border - dh;
  return { x, y, dw, dh, border, margin };
}

function fillRect(out, frameW, frameH, x, y, w, h, r, g, b) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(frameW, x + w);
  const y1 = Math.min(frameH, y + h);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * frameW + px) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
}

function blit(out, frameW, frameH, srcImg, dx, dy, dw, dh) {
  const sw = srcImg.width;
  const sh = srcImg.height;
  const src = srcImg.data;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    const py = dy + y;
    if (py < 0 || py >= frameH) continue;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      const px = dx + x;
      if (px < 0 || px >= frameW) continue;
      const si = (sy * sw + sx) * 4;
      const di = (py * frameW + px) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = 255;
    }
  }
}

function decodeJpeg(bytes) {
  if (!bytes || bytes.length < 32) return null;
  try {
    const image = decode(bytes, { useTArray: true, formatAsRGBA: true });
    if (!image?.width || !image?.height || !image.data) return null;
    return image;
  } catch {
    return null;
  }
}

/** Returns a JPEG buffer, or null when either still is not a JPEG. */
export function compositeReferenceStill(personBytes, propBytes) {
  const person = decodeJpeg(personBytes);
  const prop = decodeJpeg(propBytes);
  if (!person || !prop) return null;
  const width = person.width;
  const height = person.height;
  const out = new Uint8Array(person.data.length);
  out.set(person.data);
  const rect = propInsetRect(width, height, prop.width, prop.height);
  fillRect(out, width, height, rect.x - rect.border, rect.y - rect.border, rect.dw + rect.border * 2, rect.dh + rect.border * 2, 255, 255, 255);
  blit(out, width, height, prop, rect.x, rect.y, rect.dw, rect.dh);
  const encoded = encode({ data: out, width, height }, 92);
  return Buffer.from(encoded.data);
}

export function compositeReferenceBase64(personB64, propB64) {
  try {
    const person = Buffer.from(String(personB64 || ""), "base64");
    const prop = Buffer.from(String(propB64 || ""), "base64");
    const composed = compositeReferenceStill(person, prop);
    return composed ? composed.toString("base64") : null;
  } catch {
    return null;
  }
}
