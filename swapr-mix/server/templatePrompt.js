/** Same fallback Swapr writes when a template has no prompt of its own. */
export const SWAPR_TEMPLATE_PROMPT = "a person, natural motion, cinematic, high quality";

/** Prompt text for the textarea when a template is selected. */
export function templatePromptText(template) {
  const written = String(template && template.prompt ? template.prompt : "").trim();
  return written || SWAPR_TEMPLATE_PROMPT;
}
