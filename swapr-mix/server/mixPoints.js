/**
 * Swapr Mix — SAM control points for Wan Animate replace.
 *
 * The Runpod hub loads newWanAnimate_point_api.json only when points_store
 * is set. Positive points mark the person to replace. Negative points mark
 * props / objects that must stay from the template (e.g. a popsicle).
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
 * Returns {} when there is no positive point (caller should error).
 */
export function buildMaskPointFields(fields = {}) {
  let positive = normalizePoints(fields.positive_points);
  let negative = normalizePoints(fields.negative_points);

  if (!positive.length && typeof fields.coordinates === "string") {
    try {
      positive = normalizePoints(JSON.parse(fields.coordinates));
    } catch {
      positive = [];
    }
  }
  if (!negative.length && typeof fields.neg_coordinates === "string") {
    try {
      negative = normalizePoints(JSON.parse(fields.neg_coordinates));
    } catch {
      negative = [];
    }
  }

  const fromW = Number(fields.frame_width || fields.template_width);
  const fromH = Number(fields.frame_height || fields.template_height);
  const toW = Number(fields.width);
  const toH = Number(fields.height);
  if (fromW > 0 && fromH > 0 && toW > 0 && toH > 0) {
    positive = scalePoints(positive, fromW, fromH, toW, toH);
    negative = scalePoints(negative, fromW, fromH, toW, toH);
  }

  if (!positive.length) return {};

  // Hub examples always send at least one negative slot.
  const neg = negative.length ? negative : [{ x: 0, y: 0 }];
  return {
    points_store: JSON.stringify({ positive, negative: neg }),
    coordinates: JSON.stringify(positive),
    neg_coordinates: JSON.stringify(neg),
  };
}

export const MIX_DEFAULT_PROMPT =
  "the person in the reference photo, replace only that person, keep every handheld object prop food drink popsicle stick utensil and item from the template video unchanged and real, natural motion, cinematic";

export const MIX_DEFAULT_NEGATIVE =
  "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走";
