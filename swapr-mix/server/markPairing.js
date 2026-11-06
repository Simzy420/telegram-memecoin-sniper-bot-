/**
 * Pair Mix marks with replacement stills.
 * Slot i is mark i in tap order: Person 1 is the first green dot.
 * Generate needs a still in every slot. No red marks means person-only is enough.
 */

export function slotLabel(kind, index) {
  const n = Number(index) + 1;
  return kind === "prop" ? `Prop ${n}` : `Person ${n}`;
}

export function generateBlockReason({ hasMotion = false, personFiles = [], propFiles = [] } = {}) {
  if (!hasMotion) return "Pick a motion first.";
  if (!personFiles.length) {
    return "Tap each person to replace (green). A face slot appears for every green mark.";
  }
  const missingPerson = personFiles.findIndex((file) => !file);
  if (missingPerson >= 0) return `Upload a face for ${slotLabel("person", missingPerson)}.`;
  const missingProp = propFiles.findIndex((file) => !file);
  if (missingProp >= 0) return `Upload a still for ${slotLabel("prop", missingProp)}.`;
  return "";
}
