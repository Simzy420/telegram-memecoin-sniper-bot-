/**
 * Swapr Mix — SAM control points for Wan Animate replace.
 *
 * The Runpod hub loads newWanAnimate_point_api.json only when points_store
 * is set. Sam2Segmentation uses the positive coordinates. Green marks are
 * the person to replace. Red marks are the prop to replace. Both are sent
 * as positive points so the replace mask covers the chosen person and the
 * chosen prop. neg_coordinates stays a dummy point because the hub workflow
 * always expects that field. It is not a "keep this prop" mark.
 */

export function normalizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x, y });
  }
  return out;
}

/** Scale points from the displayed frame into the worker width/height. */
export function scalePoints(points, fromWidth, fromHeight, toWidth, toHeight) {
  const list = normalizePoints(points);
  const fw = Number(fromWidth);
  const fh = Number(fromHeight);
  const tw = Number(toWidth);
  const th = Number(toHeight);
  if (!list.length || !(fw > 0) || !(fh > 0) || !(tw > 0) || !(th > 0)) return list;
  return list.map((p) => ({
    x: (p.x / fw) * tw,
    y: (p.y / fh) * th,
  }));
}

/**
 * Build the three fields the Wan Animate Runpod handler expects.
 * Returns {} when there is no person point (caller should error).
 * Prop points are appended to the positive set.
 */
export function buildMaskPointFields(fields = {}) {
  let person = normalizePoints(fields.positive_points);
  let prop = normalizePoints(fields.prop_points);

  if (!person.length && typeof fields.coordinates === "string") {
    try {
      person = normalizePoints(JSON.parse(fields.coordinates));
    } catch {
      person = [];
    }
  }

  const fromW = Number(fields.frame_width || fields.template_width);
  const fromH = Number(fields.frame_height || fields.template_height);
  const toW = Number(fields.width);
  const toH = Number(fields.height);
  if (fromW > 0 && fromH > 0 && toW > 0 && toH > 0) {
    person = scalePoints(person, fromW, fromH, toW, toH);
    prop = scalePoints(prop, fromW, fromH, toW, toH);
  }

  if (!person.length) return {};

  const positive = person.concat(prop);
  // Hub examples always send at least one negative slot. SAM does not use it
  // as a region to keep, and Mix does not put prop marks here.
  const neg = [{ x: 0, y: 0 }];
  return {
    points_store: JSON.stringify({ positive, negative: neg }),
    coordinates: JSON.stringify(positive),
    neg_coordinates: JSON.stringify(neg),
  };
}

export const MIX_DEFAULT_PROMPT =
  "replace the marked person with the person in the reference photo, natural motion, cinematic";

export const MIX_PROP_PROMPT =
  "replace the marked person with the person in the reference photo, and replace the marked handheld prop with the object in the corner of the reference photo, natural motion, cinematic";

export const LEGACY_KEEP_PROMPTS = [
  "the person in the reference photo, replace only that person, keep every handheld object from the template unchanged and real",
  "the person in the reference photo, replace only that person, keep every handheld object prop food drink popsicle stick utensil and item from the template video unchanged and real, natural motion, cinematic",
];

export function mixPrompt(userPrompt, hasProp) {
  const trimmed = String(userPrompt || "").trim();
  const bare =
    !trimmed ||
    LEGACY_KEEP_PROMPTS.includes(trimmed) ||
    trimmed === MIX_DEFAULT_PROMPT ||
    trimmed === MIX_PROP_PROMPT;
  if (hasProp) {
    if (bare) return MIX_PROP_PROMPT;
    if (/marked handheld prop|object in the corner of the reference photo/i.test(trimmed)) return trimmed;
    return `${MIX_PROP_PROMPT}. ${trimmed}`;
  }
  if (bare) return MIX_DEFAULT_PROMPT;
  if (/keep every handheld|props to keep|objects to keep/i.test(trimmed)) {
    return `${MIX_DEFAULT_PROMPT}. ${trimmed}`;
  }
  if (/replace the marked person|person in the reference photo/i.test(trimmed)) return trimmed;
  return `${MIX_DEFAULT_PROMPT}. ${trimmed}`;
}

export const MIX_DEFAULT_NEGATIVE =
  "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走";
