/**
 * Mix-specific prompt + negative for each catalog clip.
 * Written from watching template frames so Select fills both textareas.
 * Every prompt forces the uploaded reference face and solid (non-melted) props.
 */

export const MIX_CLIP_NEGATIVE =
  "melted props, morphing objects, dissolving body parts, rubber plastic fake penis, warped hands, fused anatomy, identity drift, face not matching reference photo, wrong person, blurry face, distorted face, deformed, bad anatomy, extra limbs, extra fingers, watermark, text, low quality, jpeg artifacts, static frame, flickering identity";

const FACE =
  "Replace every marked person with the exact face, skin tone, and identity from the uploaded reference photo — same person, not a lookalike.";
const SOLID =
  "Keep every body, hand, mouth, tongue, and genital contact sharp and solid — no melting, morphing, rubber, or plastic textures.";

/** @type {Record<string, { prompt: string, negative_prompt?: string }>} */
export const MIX_CLIP_PROMPTS = {
  "demo-wave": {
    prompt: `${FACE} Upper-body shot of a woman smiling and waving both hands with palms toward camera, pink blazer over a light tee, solid green studio backdrop, natural motion, high detail. ${SOLID}`,
  },
  "my-clip-1": {
    prompt: `${FACE} POV close-up oral sex: marked woman kneeling, mouth on a solid real penis held in the foreground, intimate lighting, natural sucking motion. ${SOLID}`,
  },
  "tongue-tease": {
    prompt: `${FACE} POV close-up: marked woman on her back looking up into camera, tongue tip teasing a solid real erect penis in the foreground, white bedding, freckles and earrings stay crisp. ${SOLID}`,
  },
  "scissor-sisters": {
    prompt: `${FACE} Two marked women on the floor in a scissoring pose, legs intertwined, mutual genital contact, both faces visible and matching their reference photos left to right, carpeted room. Keep each body separate and anatomically clear. ${SOLID}`,
  },
  "reverse-cowgirl": {
    prompt: `${FACE} Low-angle reverse cowgirl: marked woman straddling and facing the camera, long dark hair, clear vaginal penetration with a solid real penis, dark background, natural riding motion. ${SOLID}`,
  },
  "blowjob-new": {
    prompt: `${FACE} POV fellatio: marked woman looking up with dark eye makeup and hoop earrings, mouth on the tip of a solid real penis, soft indoor light. ${SOLID}`,
  },
  "taste-your-pussy": {
    prompt: `${FACE} Close-up cunnilingus: marked person's mouth and tongue on a woman's vulva, clear face identity from the reference photo, intimate lighting, no melted anatomy. ${SOLID}`,
  },
  "blowbang-double-cumshot": {
    prompt: `${FACE} POV oral: marked woman looking upward with eyes open, penis in mouth, close-up face and shaft, solid real anatomy, natural motion. ${SOLID}`,
  },
  "slow-blowjob": {
    prompt: `${FACE} Slow sensual POV blowjob from above: marked woman licking a solid real penis, relaxed pace, face and upper body clear, sharp contact between tongue and shaft. ${SOLID}`,
  },
  "fingering-her-pussy": {
    prompt: `${FACE} Solo: marked blonde woman sitting on a bed, legs spread, fingering her vulva, septum ring visible, clear hands and fingers (no melt), grey bedding. ${SOLID}`,
  },
  "custom-1": {
    prompt: `${FACE} Close-up facial cumshot climax: marked woman receiving semen on her face, mouth open, intense expression, solid real penis and fluid with real physics — not melted strings. ${SOLID}`,
  },
  blowjob: {
    prompt: `${FACE} POV oral from above: marked woman licking and holding a solid real penis, face and upper body visible, sharp hand grip, natural motion. ${SOLID}`,
  },
  "facial-cumshot": {
    prompt: `${FACE} High-angle close-up: marked blonde woman in pigtails kneeling on a white shag rug, mouth open with tongue out, facial ejaculation, gold necklace stays crisp, solid real penis held near her face. ${SOLID}`,
  },
  "intense-orgasm": {
    prompt: `${FACE} Two marked people plus partner: one woman on her back in pleasure, second marked woman stimulating her, clear penetration with a solid real penis, bright room with balcony behind them, left-to-right face order matches the green marks. ${SOLID}`,
  },
  "dick-in-ass-clit-rub": {
    prompt: `${FACE} Two marked faces visible: oral and manual stimulation with legs spread, clear separate bodies, solid real anatomy, no fused limbs. ${SOLID}`,
  },
  "monicas-cumshot-throat-fuck": {
    prompt: `${FACE} Intense POV deepthroat / face-fuck: marked woman's face fills the frame, vigorous motion on a solid real penis, ejaculation moment stays sharp and physical. ${SOLID}`,
  },
  "ass-to-ass": {
    prompt: `${FACE} Close-up penetration with legs spread: marked person visible where marked, solid real genitals and hands near the action, no melted contact. ${SOLID}`,
  },
  "ass-to-throat-pie": {
    prompt: `${FACE} Close-up oral on a solid real erect penis near the marked person's mouth, intimate lighting, sharp mouth and shaft boundary. ${SOLID}`,
  },
  "eating-pussy": {
    prompt: `${FACE} Close-up cunnilingus: marked person in profile with tongue on vulva, gold hoop earring and manicure stay solid and unmelted, couch background. ${SOLID}`,
  },
  "messy-face-fuck": {
    prompt: `${FACE} Outdoor daylight messy face-fuck: marked blonde woman in profile, mouth on a solid real penis, hand in hair, real fluid (not melted wire strands), trees softly blurred behind. ${SOLID}`,
  },
};

/** Merge Mix rewrites onto a Hugging Face catalog array (mutates copies, not HF). */
export function applyMixCatalogPrompts(catalog) {
  if (!Array.isArray(catalog)) return [];
  return catalog.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const mix = MIX_CLIP_PROMPTS[entry.id];
    if (!mix) {
      return {
        ...entry,
        negative_prompt: String(entry.negative_prompt || "").trim() || MIX_CLIP_NEGATIVE,
      };
    }
    return {
      ...entry,
      prompt: mix.prompt,
      negative_prompt: mix.negative_prompt || MIX_CLIP_NEGATIVE,
    };
  });
}
